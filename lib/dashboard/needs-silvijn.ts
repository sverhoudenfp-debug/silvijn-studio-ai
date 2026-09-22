import "server-only";

import type { GeneratedWebsite } from "@/lib/websites/types";
import type { SalesInteraction, InboundMessage } from "@/lib/sales/types";
import type { OutreachDraft } from "@/lib/outreach/types";
import type { Project } from "@/lib/projects/types";
import type { Questionnaire } from "@/lib/questionnaire/repository";
import type { ProductionGate } from "@/lib/payments/service";

/**
 * "Wacht op jou" (G7): één deterministische, read-only verzameling van alles
 * waarvoor een menselijke beslissing van Silvijn nodig is. Er is bewust géén
 * aparte notificatiemodule: de items worden rechtstreeks afgeleid uit de
 * bestaande statussen die de menselijke poorten in de code al markeren.
 *
 * De lijst voert NOOIT iets uit: geen statuswijziging, geen verzending, geen
 * goedkeuring. Elk item verwijst naar de bestaande pagina waar de beslissing
 * via de bestaande (menselijke) server action wordt genomen.
 */
export type NeedsSilvijnKind =
  | "website_review" // website ready_for_silvijn (QC PASS, wacht op beoordeling)
  | "price_approval" // prijsindicatie ready/requires_human, nog niet goedgekeurd
  | "payment_confirmation" // prijs goedgekeurd, vereiste betaling nog niet bevestigd
  | "escalated_conversation" // sales-interactie ready_for_silvijn (escalatie)
  | "conversation_review" // sales-interactie draft (AI-analyse wacht op review)
  | "inbound_unprocessed" // inkomend bericht zonder AI-analyse: reply-pipeline is jouw klik
  | "outreach_review" // outreach-concept ready_for_review (review-modus)
  | "questionnaire_attention"; // questionnaire QUESTIONNAIRE_ATTENTION na ronde 2

export interface NeedsSilvijnItem {
  kind: NeedsSilvijnKind;
  /** Stabiele id: `${kind}:${recordId}` — geschikt als React-key en voor tests. */
  id: string;
  title: string;
  detail: string;
  href: string;
  /** ISO-tijdstip van het onderliggende record (voor sortering; oudste eerst). */
  since: string | null;
}

export interface NeedsSilvijnInput {
  websites: GeneratedWebsite[];
  projects: Project[];
  /** Productiepoort per project-id, uitsluitend voor projecten met priceStatus approved. */
  gates: Record<string, ProductionGate>;
  interactions: SalesInteraction[];
  inbound: InboundMessage[];
  outreach: OutreachDraft[];
  questionnaires: Questionnaire[];
}

const PRICE_APPROVAL_STATUSES = new Set<Project["priceStatus"]>(["ready", "requires_human"]);
const PROJECT_OPEN_STATUSES = new Set<Project["status"]>([
  "quotation_pending",
  "price_ready",
  "awaiting_approval",
  "approved",
  "in_progress",
  "ready_for_review",
]);

function euro(amount: number | null | undefined): string {
  if (amount == null) return "onbekend bedrag";
  return `€ ${amount.toLocaleString("nl-NL")}`;
}

/** Puur en deterministisch: dezelfde invoer geeft altijd dezelfde lijst (oudste eerst). */
export function buildNeedsSilvijnItems(input: NeedsSilvijnInput): NeedsSilvijnItem[] {
  const items: NeedsSilvijnItem[] = [];

  for (const website of input.websites) {
    if (website.status !== "ready_for_silvijn") continue;
    items.push({
      kind: "website_review",
      id: `website_review:${website.id}`,
      title: `Website beoordelen: ${website.businessName}`,
      detail: "QC geslaagd; wacht op jouw goedkeuring of revisieverzoek.",
      href: `/generated-websites/${website.slug}`,
      since: website.updatedAt ?? website.createdAt ?? null,
    });
  }

  for (const project of input.projects) {
    if (!PROJECT_OPEN_STATUSES.has(project.status)) continue;
    if (PRICE_APPROVAL_STATUSES.has(project.priceStatus)) {
      items.push({
        kind: "price_approval",
        id: `price_approval:${project.id}`,
        title: `Prijs goedkeuren: ${project.name}`,
        detail:
          project.priceStatus === "requires_human"
            ? "Prijsindicatie vereist expliciet jouw beoordeling."
            : `Prijsindicatie klaar (${euro(project.estimatedPrice)}); goedkeuren of afwijzen.`,
        href: `/projects/${project.id}/finance`,
        since: project.updatedAt ?? project.createdAt ?? null,
      });
      continue;
    }
    if (project.priceStatus === "approved") {
      const gate = input.gates[project.id];
      if (gate && !gate.allowed && gate.requirementsComplete && !gate.fullyPaid) {
        items.push({
          kind: "payment_confirmation",
          id: `payment_confirmation:${project.id}`,
          title: `Betaling bevestigen: ${project.name}`,
          detail: `Ontvangen ${euro(gate.paid)} van vereist ${euro(gate.required)}; productie start pas na jouw bevestiging.`,
          href: `/projects/${project.id}/finance`,
          since: project.updatedAt ?? project.createdAt ?? null,
        });
      }
    }
  }

  for (const interaction of input.interactions) {
    if (interaction.status === "ready_for_silvijn") {
      items.push({
        kind: "escalated_conversation",
        id: `escalated_conversation:${interaction.id}`,
        title: "Geëscaleerde conversatie",
        detail: interaction.escalationReason?.trim() || "Menselijke beslissing nodig.",
        href: "/sales",
        since: interaction.updatedAt ?? interaction.createdAt ?? null,
      });
    } else if (interaction.status === "draft") {
      items.push({
        kind: "conversation_review",
        id: `conversation_review:${interaction.id}`,
        title: "Antwoordconcept nakijken",
        detail: `${interaction.qualification.status === "needs_human" ? "Kwalificatie vraagt jouw oordeel; " : ""}intentie ${interaction.intent}, voorgestelde actie: ${interaction.suggestedNextAction}.`,
        href: "/sales",
        since: interaction.updatedAt ?? interaction.createdAt ?? null,
      });
    }
  }

  const analysed = new Set(input.interactions.map((interaction) => interaction.inboundMessageId));
  for (const message of input.inbound) {
    if (analysed.has(message.id)) continue;
    items.push({
      kind: "inbound_unprocessed",
      id: `inbound_unprocessed:${message.id}`,
      title: `Nieuw antwoord van ${message.sender}`,
      detail: message.subject?.trim() || "Zonder onderwerp; nog niet verwerkt (reply-pipeline start alleen op jouw klik).",
      href: "/conversations",
      since: message.receivedAt ?? message.createdAt ?? null,
    });
  }

  for (const draft of input.outreach) {
    if (draft.status !== "ready_for_review") continue;
    items.push({
      kind: "outreach_review",
      id: `outreach_review:${draft.id}`,
      title: "Outreach-concept goedkeuren",
      detail: draft.subject?.trim() || `Kanaal ${draft.channel}`,
      href: "/outreach",
      since: draft.updatedAt ?? draft.createdAt ?? null,
    });
  }

  for (const questionnaire of input.questionnaires) {
    if (questionnaire.completionStatus !== "QUESTIONNAIRE_ATTENTION") continue;
    items.push({
      kind: "questionnaire_attention",
      id: `questionnaire_attention:${questionnaire.id}`,
      title: `Vragenlijst onvoldoende: ${questionnaire.title}`,
      detail: "Na twee rondes nog onvoldoende informatie; neem zelf contact op of sluit af.",
      href: `/questionnaires/${questionnaire.id}`,
      since: questionnaire.updatedAt ?? questionnaire.createdAt ?? null,
    });
  }

  return items.sort((a, b) => {
    const ta = a.since ?? "";
    const tb = b.since ?? "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id < b.id ? -1 : a.id === b.id ? 0 : 1;
  });
}

export interface NeedsSilvijnResult {
  items: NeedsSilvijnItem[];
  /** Bronnen die niet geladen konden worden (fail-loud in de UI, nooit stil verbergen). */
  unavailable: string[];
}

/**
 * Laadt alle bronnen via de bestaande repositories (read-only). Een falende
 * bron verbergt de rest niet en wordt expliciet gerapporteerd.
 */
export async function loadNeedsSilvijn(): Promise<NeedsSilvijnResult> {
  const unavailable: string[] = [];
  async function safe<T>(label: string, loader: () => Promise<T[]>): Promise<T[]> {
    try {
      return await loader();
    } catch {
      unavailable.push(label);
      return [];
    }
  }

  const [{ getGeneratedWebsiteRepository }, { getProjectRepository }, { getSalesInteractionRepository, getInboundMessageRepository }, { getOutreachRepository }, { getQuestionnaireRepository }] =
    await Promise.all([
      import("@/lib/websites/repository"),
      import("@/lib/projects/repository"),
      import("@/lib/sales/repository"),
      import("@/lib/outreach/repository"),
      import("@/lib/questionnaire/repository"),
    ]);

  const [websites, projects, interactions, inbound, outreach, questionnaires] = await Promise.all([
    safe("websites", () => getGeneratedWebsiteRepository().list()),
    safe("projecten", () => getProjectRepository().list()),
    safe("conversaties", () => getSalesInteractionRepository().list()),
    safe("inbox", () => getInboundMessageRepository().list()),
    safe("outreach", () => getOutreachRepository().list()),
    safe("vragenlijsten", () => getQuestionnaireRepository().list()),
  ]);

  const gates: Record<string, ProductionGate> = {};
  const approved = projects.filter((p) => p.priceStatus === "approved" && PROJECT_OPEN_STATUSES.has(p.status));
  if (approved.length > 0) {
    const { getProductionGate } = await import("@/lib/payments/service");
    await Promise.all(
      approved.map(async (project) => {
        try {
          gates[project.id] = await getProductionGate(project.id);
        } catch {
          unavailable.push(`betaalstatus ${project.name}`);
        }
      })
    );
  }

  return { items: buildNeedsSilvijnItems({ websites, projects, gates, interactions, inbound, outreach, questionnaires }), unavailable };
}
