import type { QuestionnaireCompletionStatus } from "./validation";

/**
 * Puure beslissingslogica voor de questionnaire-completion (unit-testbaar,
 * geen server-only): mapt een AI-beoordeling + ronde naar de definitieve
 * status. De AI geeft een advies; deze module dwingt de businessregels af:
 * - ronde 2 krijgt nooit opnieuw follow-upvragen;
 * - zonder follow-upvragen wordt onvoldoende direct een aandachtspunt.
 */

export interface CompletionAssessment {
  sufficient: boolean;
  missingInformation: string[];
  followUpQuestions: unknown[];
}

export interface CompletionDecision {
  status: QuestionnaireCompletionStatus;
  followUpQuestions: unknown[];
}

export function decideCompletion(
  assessment: CompletionAssessment,
  round: 1 | 2
): CompletionDecision {
  if (assessment.sufficient) return { status: "QUESTIONNAIRE_COMPLETE", followUpQuestions: [] };
  if (round === 1 && assessment.followUpQuestions.length > 0) {
    return { status: "QUESTIONNAIRE_FOLLOW_UP", followUpQuestions: assessment.followUpQuestions.slice(0, 3) };
  }
  return { status: "QUESTIONNAIRE_ATTENTION", followUpQuestions: [] };
}
