import "server-only";
import { z } from "zod";
import { isOutreachSuppressed } from "@/lib/leads/lifecycle";
import { automatedLeadTransition } from "@/lib/leads/automated";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SalesService, type SalesAnalysisResult } from "./service";
import { getInboundMessageRepository, getSalesInteractionRepository } from "./repository";
import { getOutreachRepository } from "@/lib/outreach/repository";
import { approveAndSendDraft } from "@/lib/outreach/send";
import { ensureActiveQuestionnaireForLead } from "./questionnaire-step";

/**
 * Reply-pipeline (Fase E) — verwerkt een binnenkomende prospect-reactie
 * en zet het verkoopgesprek voort binnen de expliciete eigenaarsmodus.
 *
 *   inbound (confirmed reply, uit Gmail-ingest of handmatige bevestiging)
 *     → bestaande SalesService.analyzeInboundMessage (AI: intent,
 *       kwalificatie, antwoord-concept; conservatieve lead-sync incl. opt-out)
 *     → escalatie of quality-fail → menselijke rij (ready_for_silvijn), NIET verzonden
 *     → opt-out → direct gestopt (SalesService zette outreachStatus opted_out;
 *       SQL-guard weigert verdere verzending)
 *     → review-modus: antwoord-concept voor menselijke review
 *     → auto-modus: antwoord verzonden via de goedgekeurde provider
 *        (demo_request → purpose demo_offer; anders sales_reply),
 *        met AI-toegestane statusovergang (contacted → interested/demo_offered).
 *
 * Prijzen worden NOOIT zelfstandig aangeboden: een prijsvoorstel vereist
 * altijd een door Silvijn goedgekeurde prijs (SQL-guard 0012).
 */

export interface ReplyPipelineOutcome {
  leadId: string;
  businessName: string;
  outcome: "answered" | "draft_for_review" | "escalated" | "opted_out" | "suppressed" | "error";
  detail: string;
  draftId?: string;
  interactionId?: string;
}

export interface ReplyPipelineResult {
  outcomes: ReplyPipelineOutcome[];
  processedCount: number;
  sentCount: number;
  escalatedCount: number;
  errors: string[];
}

// leadId/inboundMessageId zijn UUIDs in productie (Supabase); memory-mode
// gebruikt legitieme test-IDs (ld-xxx/im-xxx). Strikte UUID-validatie blijft
// op de productieweg zelf (service-role RPC's, injectie-hardening).
const pipelineInput = z.object({
  leadId: z.string().min(1),
  inboundMessageId: z.string().min(1),
  mode: z.enum(["review", "auto"]),
});

export function appendQuestionnaireParagraph(body: string, url: string): string {
  if (body.includes(url)) return body;
  return `${body.trimEnd()}\n\nOm gericht te kunnen adviseren hebben we een korte vragenlijst voor u klaargezet. Invullen duurt een paar minuten:\n${url}`;
}

function buildReplySubject(originalSubject: string): string {
  const stripped = originalSubject.replace(/^((re|fw|fwd):\s*)+/i, "").trim();
  return `Re: ${stripped || "uw bericht"}`.slice(0, 990);
}

/** Positieve intents die een gespreksvoortzetting rechtvaardigen. */
const POSITIVE_INTENTS = ["interested", "demo_request", "call_request"];

/** Positieve intents met voldoende interesse mogen de vragenlijst aangeboden krijgen. */
function questionnaireWarranted(intent: string, interestLevel: string): boolean {
  return POSITIVE_INTENTS.includes(intent) && ["medium", "high"].includes(interestLevel);
}

export async function processInboundReply(input: z.input<typeof pipelineInput>): Promise<ReplyPipelineOutcome> {
  const parsed = pipelineInput.parse(input);
  const leadRepository = getLeadRepository();
  const lead = await leadRepository.get(parsed.leadId);
  if (!lead) throw new Error("Lead niet gevonden");

  if (isOutreachSuppressed(lead.leadStatus, lead.outreachStatus)) {
    return {
      leadId: parsed.leadId,
      businessName: lead.businessName,
      outcome: "suppressed",
      detail: "Lead is onderdrukt (opt-out/not_interested/lost) — geen verdere automatische actie",
    };
  }

  // 1) Bestaande AI-analyse (intent, kwalificatie, antwoord-concept,
  //    conservatieve lead-sync — opt-out wordt hier al verwerkt).
  const salesService = new SalesService();
  const analysis: SalesAnalysisResult = await salesService.analyzeInboundMessage(
    parsed.leadId,
    parsed.inboundMessageId
  );
  const interaction = analysis.interaction;

  if (interaction.intent === "opt_out") {
    return {
      leadId: parsed.leadId,
      businessName: lead.businessName,
      outcome: "opted_out",
      detail: "Prospect heeft zich afgemeld — outreach en follow-ups stoppen direct",
      interactionId: interaction.id,
    };
  }

  if (interaction.escalationRequired || !analysis.qualityPassed) {
    return {
      leadId: parsed.leadId,
      businessName: lead.businessName,
      outcome: "escalated",
      detail: interaction.escalationRequired
        ? `Menselijke beslissing nodig: ${interaction.escalationReason ?? "escalatie"}`
        : `Quality check niet geslaagd: ${interaction.qualityIssues.join("; ")}`,
      interactionId: interaction.id,
    };
  }

  if (parsed.mode === "review") {
    return {
      leadId: parsed.leadId,
      businessName: lead.businessName,
      outcome: "draft_for_review",
      detail: "Antwoord-concept klaar voor menselijke review",
      interactionId: interaction.id,
    };
  }

  // 2) Auto-modus: antwoord als verzendbaar draft (kwaliteitscheck geslaagd).
  const inbound = await getInboundMessageRepository().getById(parsed.inboundMessageId);
  if (!inbound || inbound.leadId !== parsed.leadId) throw new Error("Inbound bericht niet gevonden voor deze lead");

  const isDemoRequest = interaction.intent === "demo_request";
  // Vragenlijst (Masterconfig F): bij echte interesse krijgt de prospect de
  // publieke vragenlijst-link mee, zodat antwoorden op het juiste lead-record
  // landen. Bestaat er al een actieve vragenlijst, dan wordt die hergebruikt;
  // er wordt nooit een tweede aangemaakt. Mislukt de stap, dan gaat het
  // antwoord zonder link (geen verzonnen URL) en wordt dat gelogd.
  let body = interaction.responseDraft;
  let questionnaireNote = "";
  if (questionnaireWarranted(interaction.intent, interaction.qualification.interestLevel)) {
    const questionnaire = await ensureActiveQuestionnaireForLead(parsed.leadId);
    if (questionnaire.url) {
      body = appendQuestionnaireParagraph(body, questionnaire.url);
      questionnaireNote = questionnaire.created ? " (vragenlijst aangemaakt en meegestuurd)" : " (bestaande vragenlijst meegestuurd)";
    } else {
      questionnaireNote = ` (vragenlijst niet meegestuurd: ${questionnaire.reason ?? "onbekend"})`;
    }
  }
  const draft = await getOutreachRepository().create({
    leadId: parsed.leadId,
    channel: "email",
    status: "approved", // expliciete eigenaarsopdracht + geslaagde quality check
    purpose: isDemoRequest ? "demo_offer" : "sales_reply",
    conversationId: inbound.conversationId ?? null,
    subject: buildReplySubject(inbound.subject),
    body,
    personalizationReason: "Antwoord op binnenkomende prospect-reactie (reply-pipeline)",
    callToAction: interaction.suggestedNextAction,
    model: analysis.model,
    qualityIssues: [],
  });

  // 3) Verzenden via de goedgekeurde provider (SQL-guards blijven gelden).
  const sent = await approveAndSendDraft(draft.id);

  // 4) AI-toegestane statusovergang mét verzendbewijs.
  const refreshed = await leadRepository.get(parsed.leadId);
  if (refreshed && refreshed.leadStatus === "contacted") {
    const next = isDemoRequest ? "demo_offered" : "interested";
    const positive = POSITIVE_INTENTS.includes(interaction.intent);
    if (isDemoRequest || (positive && ["medium", "high"].includes(interaction.qualification.interestLevel))) {
      await automatedLeadTransition({
        leadId: parsed.leadId,
        expected: "contacted",
        next,
        reason: `Reply-pipeline (auto): reactie beantwoord (message ${sent.messageId}), intent=${interaction.intent}`,
        messageId: inbound.id,
      });
    }
  }

  return {
    leadId: parsed.leadId,
    businessName: lead.businessName,
    outcome: "answered",
    detail: `Antwoord verzonden via ${sent.accountKey}${isDemoRequest ? " (demo aangeboden)" : ""}${questionnaireNote}`,
    draftId: draft.id,
    interactionId: interaction.id,
  };
}

/**
 * Verwerkt alle nog niet-geanalyseerde confirmed reacties binnen één
 * expliciete eigenaarsronde (na Gmail-sync of vanaf het dashboard).
 */
export async function processPendingReplies(input: {
  /** Eigenaar bij een dashboardronde; null bij de Gmail-ingest-tick (trigger verplicht). */
  ownerUserId: string | null;
  trigger?: "owner_command" | "gmail_ingest";
  mode: "review" | "auto";
  limit?: number;
}): Promise<ReplyPipelineResult> {
  const trigger = input.trigger ?? "owner_command";
  if (trigger === "owner_command" && !input.ownerUserId) throw new Error("OWNER_REQUIRED");
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 10), 1), 25);
  const [inbounds, interactions] = await Promise.all([
    getInboundMessageRepository().list(),
    getSalesInteractionRepository().list(),
  ]);
  const processedInboundIds = new Set(interactions.map((i) => i.inboundMessageId));
  const leadRepository = getLeadRepository();
  const leads = await leadRepository.list();

  const pending = inbounds
    .filter((m) => m.replyConfirmed && !processedInboundIds.has(m.id))
    .slice(0, limit);

  const outcomes: ReplyPipelineOutcome[] = [];
  const errors: string[] = [];
  for (const message of pending) {
    try {
      outcomes.push(await processInboundReply({ leadId: message.leadId, inboundMessageId: message.id, mode: input.mode }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      errors.push(detail);
      const lead = leads.find((l) => l.id === message.leadId);
      outcomes.push({
        leadId: message.leadId,
        businessName: lead?.businessName ?? message.leadId,
        outcome: "error",
        detail,
      });
    }
  }

  if (isSupabaseConfigured() && outcomes.length > 0) {
    try {
      const client = getSupabaseServerClient();
      const { error } = await client.from("audit_events").insert({
        actor_id: input.ownerUserId,
        action: "reply_pipeline_run",
        entity_type: "reply_pipeline",
        entity_id: null,
        details: {
          trigger,
          mode: input.mode,
          processed: outcomes.length,
          answered: outcomes.filter((o) => o.outcome === "answered").length,
          escalated: outcomes.filter((o) => o.outcome === "escalated").length,
          optedOut: outcomes.filter((o) => o.outcome === "opted_out").length,
          errors: errors.length,
        },
      });
      if (error) throw error;
    } catch {
      console.warn("[ReplyPipeline] AUDIT_WRITE_FAILED");
    }
  }

  return {
    outcomes,
    processedCount: outcomes.length,
    sentCount: outcomes.filter((o) => o.outcome === "answered").length,
    escalatedCount: outcomes.filter((o) => o.outcome === "escalated").length,
    errors,
  };
}
