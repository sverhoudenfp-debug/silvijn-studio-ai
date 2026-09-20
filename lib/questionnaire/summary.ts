import type { QuestionnaireQuestion } from "./validation";

/**
 * Questionnaire → Design Plan doorvoer (C1/C2-consumptie, 2026-09-20).
 *
 * Puure samenvattingslogica: zet questionnaire-vragen + responsrijen om
 * naar compacte regels voor de Design Planning-prompt. Belangrijk:
 * - antwoorden uit ALLE rondes worden meegenomen (ook de follow-upronde),
 *   met per vraag de nieuwste niet-lege antwoordte;
 * - geüploade bestanden worden als aantallen zichtbaar (de AI weet dan dat
 *   er écht materiaal is zonder de inhoud te zien);
 * - expliciete bevestigingen ("geen reviews beschikbaar") komen er
 *   vanzelf in mee: ze staan in de antwoorden en zijn juist waardevol
 *   voor de A3-trust-disclosure van het blueprint.
 */

export interface QuestionnaireAnswerLine {
  label: string;
  value: string;
}

export interface QuestionnaireResponseLike {
  round: number;
  answers: Record<string, string>;
  uploads?: Array<{ questionId: string }> | null;
}

export const MAX_QUESTIONNAIRE_LINES = 40;

/**
 * Bouwt de antwoordregels: per vraag (ronde 1 + follow-upronde) het
 * nieuwste niet-lege antwoord, plus upload-aantekeningen.
 */
export function buildQuestionnaireAnswerLines(
  questions: QuestionnaireQuestion[],
  followUpQuestions: QuestionnaireQuestion[],
  responses: QuestionnaireResponseLike[]
): QuestionnaireAnswerLine[] {
  const ordered = [...responses].sort((a, b) => a.round - b.round);
  const lines: QuestionnaireAnswerLine[] = [];
  const seen = new Set<string>();

  for (const question of [...questions, ...followUpQuestions]) {
    if (seen.has(question.id)) continue;
    seen.add(question.id);

    let value: string | null = null;
    let uploadCount = 0;
    for (const response of ordered) {
      const answer = response.answers[question.id];
      if (answer != null && answer.trim().length > 0) value = answer.trim();
      const uploads = (response.uploads ?? []).filter((u) => u.questionId === question.id).length;
      if (uploads > 0) uploadCount = uploads;
    }
    if (value == null && uploadCount === 0) continue;

    const uploadNote = uploadCount > 0 ? ` [${uploadCount} bestand(en) geüpload]` : "";
    lines.push({
      label: question.label.slice(0, 120),
      value: (value ?? "(alleen bestanden geüpload)").slice(0, 300) + uploadNote,
    });
    if (lines.length >= MAX_QUESTIONNAIRE_LINES) break;
  }

  return lines;
}

export interface CompletionSummaries {
  /** Genummerde vraaglijst voor de AI (ronde 1: kernvragen; ronde 2: alles). */
  questionsSummary: string;
  /** Antwoordregels uit álle ontvangen rondes (nieuwste antwoord wint). */
  answersSummary: string;
}

/**
 * Bouwt de completionsamenvatting voor de AI-beoordeling.
 *
 * Ronde 2-beoordeling (E2E-bugfix 2026-09-20): de ronde-1-antwoorden zijn
 * ALLEREERST ontvangen data — een ronde-2-beoordeling die ze niet ziet
 * concludeerde ten onrechte dat kernvragen "nog nooit beantwoord" waren en
 * degradeerde complete questionnaires naar QUESTIONNAIRE_ATTENTION met een
 * feitelijk onjuiste analyse. Daarom geldt nu:
 * - ronde 1: alleen de vragen van ronde 1 (er bestaat nog geen ronde 2);
 * - ronde 2: ALLE vragen (kern + follow-up) met antwoorden uit beide rondes,
 *   via exact dezelfde regels als de Design Plan-consumptie
 *   (buildQuestionnaireAnswerLines: nieuwste niet-lege antwoord wint,
 *   uploads zichtbaar als aantallen).
 */
export function buildCompletionSummaries(
  questions: QuestionnaireQuestion[],
  followUpQuestions: QuestionnaireQuestion[],
  responses: QuestionnaireResponseLike[],
  round: 1 | 2
): CompletionSummaries {
  const includeFollowUps = round === 2 && followUpQuestions.length > 0;
  const allQuestions = includeFollowUps ? [...questions, ...followUpQuestions] : questions;
  const lines = buildQuestionnaireAnswerLines(
    questions,
    includeFollowUps ? followUpQuestions : [],
    responses
  );
  return {
    questionsSummary: allQuestions.map((q, i) => `${i + 1}. ${q.label}`).join("\n"),
    answersSummary: lines.map((line) => `- ${line.label}: ${line.value}`).join("\n"),
  };
}
