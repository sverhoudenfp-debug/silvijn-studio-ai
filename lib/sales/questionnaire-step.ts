import "server-only";
import {
  createQuestionnaireForLead,
  findQuestionnairesByLead,
  publicQuestionnaireUrl,
  publishQuestionnaire,
} from "@/lib/questionnaire/service";

/**
 * Vragenlijst-stap van de reply-pipeline. Hergebruikt een bestaande actieve
 * (of publiceert een bestaande draft-) vragenlijst van de lead; alleen als er
 * géén is, wordt er één gegenereerd uit de bekende lead-/klantinformatie
 * (bestaande QuestionnaireService: bekende onderwerpen worden niet opnieuw
 * gevraagd). Faalt de stap, dan is de uitkomst expliciet zonder URL: er wordt
 * nooit een link verzonnen. Geen lead-, prijs- of projectmutatie.
 */
export interface QuestionnaireStepResult {
  url: string | null;
  created: boolean;
  reason?: string;
}

export async function ensureActiveQuestionnaireForLead(leadId: string): Promise<QuestionnaireStepResult> {
  try {
    const existing = await findQuestionnairesByLead(leadId);
    const active = existing.find((q) => q.status === "active");
    if (active) return { url: publicQuestionnaireUrl(active.slug), created: false };
    const draft = existing.find((q) => q.status === "draft");
    if (draft) {
      const published = await publishQuestionnaire(draft.id);
      return { url: publicQuestionnaireUrl(published.slug), created: false };
    }
    const created = await createQuestionnaireForLead(leadId, null);
    const published = await publishQuestionnaire(created.id);
    return { url: publicQuestionnaireUrl(published.slug), created: true };
  } catch (error) {
    return { url: null, created: false, reason: error instanceof Error ? error.message : "QUESTIONNAIRE_STEP_FAILED" };
  }
}
