import "server-only";
import { getQuestionnaireRepository, type Questionnaire } from "./repository";
import { questionnaireQuestionsSchema, questionnaireSlugSchema, validateQuestionnaireAnswers } from "./validation";

/**
 * QuestionnaireService — de publieke, server-side flow.
 * Een publieke bezoeker kan uitsluitend:
 *  1) een actieve questionnaire via slug lezen (alleen titel/intro/vragen);
 *  2) antwoorden insturen, gevalideerd tegen de vragen van dát questionnaire.
 * Lead-/project-/dashboardgegevens worden nooit naar de publieke kant gestuurd.
 */

export class QuestionnaireNotFoundError extends Error {
  constructor() {
    super("Questionnaire niet gevonden");
    this.name = "QuestionnaireNotFoundError";
  }
}

function parseQuestionsOrThrow(questionnaire: Questionnaire): Questionnaire["questions"] {
  const parsed = questionnaireQuestionsSchema.safeParse(questionnaire.questions);
  if (!parsed.success) throw new Error("BLOCKED_EXTERNAL_CONFIGURATION: questionnaire-definitie is ongeldig");
  return parsed.data;
}

/** Alleen actieve questionnaires zijn publiek zichtbaar; draft/closed → niet gevonden. */
export async function getPublicQuestionnaireBySlug(slug: string): Promise<Questionnaire> {
  const cleanSlug = questionnaireSlugSchema.parse(slug);
  const questionnaire = await getQuestionnaireRepository().findBySlug(cleanSlug);
  if (!questionnaire || questionnaire.status !== "active") throw new QuestionnaireNotFoundError();
  parseQuestionsOrThrow(questionnaire);
  return questionnaire;
}

/** Slaat gevalideerde antwoorden op via de server-side Supabase-flow. */
export async function submitQuestionnaireResponse(slug: string, raw: Record<string, string>): Promise<void> {
  const questionnaire = await getPublicQuestionnaireBySlug(slug);
  const { answers } = validateQuestionnaireAnswers(questionnaire.questions, raw);
  await getQuestionnaireRepository().createResponse(questionnaire.id, answers);
}
