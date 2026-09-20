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
