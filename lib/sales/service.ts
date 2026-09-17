import { getAIActivityRepository } from "@/lib/repositories/ai-activity-repository";
import { getDemoRepository } from "@/lib/repositories/demo-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getOutreachRepository } from "@/lib/outreach/repository";
import { AIService } from "@/lib/ai/service";
import type { Lead } from "@/lib/types";
import { getInboundMessageRepository, getSalesInteractionRepository, type InboundMessageCreateInput } from "./repository";
import { checkSalesResponseQuality } from "./quality-check";
import type {
  InboundMessage,
  SalesAnalysisResult,
  SalesInteraction,
  SalesInteractionStatus,
} from "./types";

/**
 * SalesService (Fase 7) — de AI Sales Agent als EERSTE sales-assistent.
 *
 * Flow: INCOMING RESPONSE → CONTEXT ANALYSIS → INTENT DETECTION →
 * LEAD QUALIFICATION → NEXT ACTION → RESPONSE DRAFT → HUMAN REVIEW.
 *
 * De AI stuurt nooit, zegt nooit iets toe, geeft nooit een prijs. Prijzen,
 * kortingen, contracten en verzenden volgen in latere fases met human approval.
 */

export function getMaxSalesAnalysesPerRun(): number {
  const parsed = Number.parseInt(process.env.MAX_SALES_ANALYSES_PER_RUN ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 25) : 5;
}

export class SalesLimitError extends Error {
  constructor(limit: number) {
    super(`Sales-analyse-limiet bereikt (${limit} per run)`);
    this.name = "SalesLimitError";
  }
}

export class SalesNotFoundError extends Error {
  constructor(message = "Lead, bericht of analyse niet gevonden") {
    super(message);
    this.name = "SalesNotFoundError";
  }
}

/**
 * Conservatieve lead-statusregels (gedocumenteerd in docs/sales-agent.md):
 * - intent=opt_out                      → outreachStatus=opted_out
 * - duidelijke interesse + medium/high  → leadStatus=interested (alleen vanuit new/analyzing)
 * - volledig kwalificatie=qualified      → leadStatus=qualified (alleen vanuit new/analyzing/interested)
 * - not_interested/not_now/objection    → géén automatische statuswijziging (NOOIT lost/won)
 * - onzekerheid                          → status ongewijzigd
 */
function computeLeadStatusUpdate(
  lead: Lead,
  analysis: {
    intent: string;
    interestLevel: string;
    qualificationStatus: string;
  }
): { leadStatus?: Lead["leadStatus"]; outreachStatus?: Lead["outreachStatus"] } {
  const update: { leadStatus?: Lead["leadStatus"]; outreachStatus?: Lead["outreachStatus"] } = {};

  if (analysis.intent === "opt_out") {
    update.outreachStatus = "opted_out";
    update.leadStatus = "opted_out";
    return update;
  }

  const positiveIntents = ["interested", "demo_request", "call_request"];
  const canAdvance = ["new", "analyzing"].includes(lead.leadStatus);
  const canAdvanceToQualified = ["new", "analyzing", "interested"].includes(lead.leadStatus);

  if (
    canAdvance &&
    positiveIntents.includes(analysis.intent) &&
    ["medium", "high"].includes(analysis.interestLevel)
  ) {
    update.leadStatus = "interested";
    return update;
  }

  if (
    canAdvanceToQualified &&
    analysis.qualificationStatus === "qualified" &&
    ["medium", "high"].includes(analysis.interestLevel)
  ) {
    update.leadStatus = "qualified";
  }

  return update;
}

export class SalesService {
  private aiService = new AIService();
  private analysesThisRun = 0;

  /** Registreert een inkomende reactie (mock/dev: handmatig ingevoerd; later: echte provider). */
  async createInboundMessage(input: InboundMessageCreateInput): Promise<InboundMessage> {
    const lead = await getLeadRepository().get(input.leadId);
    if (!lead) throw new SalesNotFoundError("Lead niet gevonden");
    if (!input.body?.trim()) throw new Error("Berichttekst ontbreekt");
    if (!input.sender?.trim()) throw new Error("Afzender ontbreekt");
    return getInboundMessageRepository().create({
      ...input,
      sender: input.sender.trim(),
      subject: input.subject?.trim() || "",
      channel: input.channel ?? "email",
      source: input.source || "manual",
    });
  }

  /**
   * Analyseert een inkomend bericht en draft een antwoord — de enige entree
   * is een expliciete server action. Eén gecontroleerde AI-call per analyse.
   */
  async analyzeInboundMessage(leadId: string, inboundMessageId: string): Promise<SalesAnalysisResult> {
    this.analysesThisRun += 1;
    const max = getMaxSalesAnalysesPerRun();
    if (this.analysesThisRun > max) throw new SalesLimitError(max);

    const leadRepository = getLeadRepository();
    const lead = await leadRepository.get(leadId);
    if (!lead) throw new SalesNotFoundError("Lead niet gevonden");

    const inboundRepository = getInboundMessageRepository();
    const message = await inboundRepository.getById(inboundMessageId);
    if (!message || message.leadId !== leadId) throw new SalesNotFoundError("Inkomend bericht niet gevonden voor deze lead");

    if (!message.replyConfirmed && inboundRepository.source === "supabase") throw new Error("CONFIRMED_PROSPECT_REPLY_REQUIRED");

    // Context: eerdere berichten, analyses, outreach-concepten, demo
    const [previousInbound, previousInteractions, outreachDrafts, demo] = await Promise.all([
      inboundRepository.listByLead(leadId),
      getSalesInteractionRepository().listByLead(leadId),
      getOutreachRepository().listByLead(leadId),
      getDemoRepository().findByLeadId(leadId),
    ]);

    const earlierInbound = previousInbound.filter((m) => m.id !== message.id).slice(-5);

    const result = await this.aiService.generateSalesResponse(
      {
        businessName: lead.businessName,
        industry: lead.industry,
        city: lead.city,
        websiteStatus: lead.websiteStatus,
        website: lead.website,
        leadScore: lead.leadScore,
        demoUrl: demo?.status === "ready" ? demo.previewUrl : null,
        demoHeadline: demo?.status === "ready" ? demo.headline : null,
        outreachHistory: outreachDrafts.slice(0, 3).map((d) => `Concept (${d.status}): "${d.subject}"`),
        previousInbound: earlierInbound.map((m) => ({
          sender: m.sender,
          subject: m.subject,
          body: m.body,
          receivedAt: m.receivedAt,
          channel: m.channel,
        })),
        previousInteractions: previousInteractions.slice(0, 3).map(
          (i) => `Eerdere analyse: intent=${i.intent}, interest=${i.qualification.interestLevel}, status=${i.status}`
        ),
        inbound: {
          sender: message.sender,
          subject: message.subject,
          body: message.body,
          receivedAt: message.receivedAt,
          channel: message.channel,
        },
      },
      leadId
    );

    // Deterministische quality check op het antwoord-concept
    const quality = checkSalesResponseQuality(
      { response: result.data.response, suggestedNextAction: result.data.suggestedNextAction },
      { allowMockMarkers: result.mode === "mock" }
    );

    // Interactie opslaan: escalatie → ready_for_siljijn; anders draft
    const interaction = await getSalesInteractionRepository().create({
      leadId,
      inboundMessageId,
      intent: result.data.intent,
      objectionType: result.data.objectionType,
      qualification: result.data.qualification,
      responseDraft: result.data.response,
      suggestedNextAction: result.data.suggestedNextAction,
      questions: result.data.questions,
      escalationRequired: result.data.escalationRequired,
      escalationReason: result.data.escalationReason,
      status: quality.passed && result.data.escalationRequired ? "ready_for_silvijn" : "draft",
      qualityIssues: quality.issues,
      model: result.model,
      aiRunId: null,
    });

    // Log extra domein-events (bestaande activity-logging)
    const activityRepository = getAIActivityRepository();
    await activityRepository.log({
      leadId,
      type: "qualification",
      status: "completed",
      message: `Kwalificatie bijgewerkt voor ${lead.businessName} (${result.data.qualification.status}, interest: ${result.data.qualification.interestLevel})`,
    });
    if (result.data.escalationRequired) {
      await activityRepository.log({
        leadId,
        type: "human_escalation",
        status: "completed",
        message: `READY FOR SILVIJN — ${lead.businessName}: ${result.data.escalationReason ?? "menselijke beslissing nodig"}`,
      });
    }

    // Conservatieve lead-statussync
    const statusUpdate = computeLeadStatusUpdate(lead, {
      intent: result.data.intent,
      interestLevel: result.data.qualification.interestLevel,
      qualificationStatus: result.data.qualification.status,
    });
    if (statusUpdate.leadStatus || statusUpdate.outreachStatus) {
      await leadRepository.updateStatuses(leadId, statusUpdate);
      await activityRepository.log({
        leadId,
        type: "lead_status_sync",
        status: "completed",
        message: `Lead-status bijgewerkt voor ${lead.businessName}: ${JSON.stringify(statusUpdate)}`,
      });
    }

    return {
      interaction,
      model: result.model,
      mode: result.mode,
      estimatedCost: result.estimatedCost,
      durationMs: result.durationMs,
      qualityPassed: quality.passed,
    };
  }

  async markReadyForSilvijn(interactionId: string): Promise<SalesInteraction> {
    return this.updateInteractionStatus(interactionId, "ready_for_silvijn");
  }

  async markHandled(interactionId: string): Promise<SalesInteraction> {
    return this.updateInteractionStatus(interactionId, "handled");
  }

  private async updateInteractionStatus(interactionId: string, status: SalesInteractionStatus): Promise<SalesInteraction> {
    const repository = getSalesInteractionRepository();
    const interaction = await repository.getById(interactionId);
    if (!interaction) throw new SalesNotFoundError("Analyse niet gevonden");
    const updated = await repository.updateStatus(interactionId, status);
    if (!updated) throw new SalesNotFoundError("Analyse niet gevonden");
    return updated;
  }

  async listInboundByLead(leadId: string): Promise<InboundMessage[]> {
    return getInboundMessageRepository().listByLead(leadId);
  }

  async listInteractionsByLead(leadId: string): Promise<SalesInteraction[]> {
    return getSalesInteractionRepository().listByLead(leadId);
  }

  async listAllInteractions(): Promise<SalesInteraction[]> {
    return getSalesInteractionRepository().list();
  }
}
