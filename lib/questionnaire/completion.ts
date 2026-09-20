import type { QuestionnaireCompletionStatus } from "./validation";
import {
  assessContentRichness,
  type ContentDimensionKey,
} from "./richness";
import { coreQuestionForTopic } from "./design-core";

/**
 * Puure beslissingslogica voor de questionnaire-completion (unit-testbaar,
 * geen server-only): mapt een AI-beoordeling + ronde naar de definitieve
 * status. De AI geeft een advies; deze module dwingt de businessregels af:
 * - C1 (2026-09-20): "sufficient" geldt ALLEEN als alle content-dimensies
 *   betrouwbaar zijn herleid (of eerlijk expliciet zijn afgezegd) — de AI
 *   kan rijkheid niet zelf declareren zonder bewijs;
 * - ronde 2 krijgt nooit opnieuw follow-upvragen;
 * - zonder follow-upvragen wordt onvoldoende direct een aandachtspunt.
 */

export interface CompletionAssessment {
  sufficient: boolean;
  missingInformation: string[];
  followUpQuestions: unknown[];
  /** C1: de door de AI herleide content-dimensies (verplicht in het AI-contract). */
  contentDimensions?: Partial<Record<ContentDimensionKey, string>> | null;
}

export interface CompletionDecision {
  status: QuestionnaireCompletionStatus;
  followUpQuestions: unknown[];
  /** Verrijkte ontbrekende informatie (incl. C1-dimensies) — voor het dashboard. */
  missingInformation: string[];
}

/** Volgorde waarin ontbrekende dimensies worden nagevraagd (max 3 per ronde). */
const DIMENSION_FOLLOW_UP_TOPICS: Partial<Record<ContentDimensionKey, string>> = {
  offering: "core_aanbod",
  usps: "core_usp",
  proof: "core_bewijs",
  audience: "core_doelgroep",
  toneOfVoice: "core_stijl",
  branding: "core_kleuren",
  media: "core_media",
};

export function decideCompletion(
  assessment: CompletionAssessment,
  round: 1 | 2
): CompletionDecision {
  // C1: rijkheidsafdwing vóór het sufficient-advies wordt geaccepteerd.
  const richness = assessContentRichness(assessment.contentDimensions);
  const sufficient = assessment.sufficient && richness.complete;
  const missingInformation = [
    ...assessment.missingInformation,
    ...(assessment.sufficient && !richness.complete
      ? richness.missing.map((label) => `Content-dimensie onvoldoende: ${label}`)
      : []),
  ];

  if (sufficient) return { status: "QUESTIONNAIRE_COMPLETE", followUpQuestions: [], missingInformation };

  // Ronde 1: AI-volgvragen hebben voorrang. Alleen bij een AI-TEGENSPRAAK
  // (sufficient=true gemeld terwijl dimensies ontbreken, zonder eigen
  // follow-ups) worden de ontbrekende content-dimensies deterministisch
  // nagevraagd — korte kernvragen, nooit feiten verzonnen. Een eerlijk
  // insufficient-oordeel mét lege follow-ups (klant geeft niets meer)
  // blijft een aandachtspunt.
  if (round === 1) {
    let followUps: unknown[] = assessment.followUpQuestions.slice(0, 3);
    if (followUps.length === 0 && assessment.sufficient && !richness.complete) {
      followUps = richness.missingKeys
        .map((key) => DIMENSION_FOLLOW_UP_TOPICS[key])
        .filter((topicId): topicId is string => topicId !== null)
        .map((topicId) => coreQuestionForTopic(topicId))
        .filter((q): q is NonNullable<typeof q> => q !== null)
        .slice(0, 3);
    }
    if (followUps.length > 0) {
      return { status: "QUESTIONNAIRE_FOLLOW_UP", followUpQuestions: followUps, missingInformation };
    }
  }

  return { status: "QUESTIONNAIRE_ATTENTION", followUpQuestions: [], missingInformation };
}
