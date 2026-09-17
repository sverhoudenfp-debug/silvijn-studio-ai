import { z } from "zod";

/**
 * Puur validatiemodule (geen server-only) — unit-testbaar en gedeeld tussen
 * de public action en de server-side service. Elke vraag in een questionnaire
 * is een gestructureerd object; antwoorden worden uitsluitend tegen de
 * vraagdefinities van dát questionnaire gevalideerd.
 */

export const questionnaireQuestionTypeSchema = z.enum(["text", "textarea", "email", "tel", "select", "upload"]);

export const questionnaireQuestionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(500),
  type: questionnaireQuestionTypeSchema,
  options: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  required: z.boolean().optional(),
  help: z.string().trim().max(200).optional(),
});

export type QuestionnaireQuestion = z.infer<typeof questionnaireQuestionSchema>;

export const questionnaireQuestionsSchema = z
  .array(questionnaireQuestionSchema)
  .min(1, "Een questionnaire heeft minimaal één vraag nodig")
  .max(50);

/** Dashboard-flow: dynamisch gegenereerde vragenlijsten blijven begrensd. */
export const generatedQuestionsSchema = z
  .array(questionnaireQuestionSchema)
  .min(1)
  .max(15, "Een gegenereerde questionnaire heeft maximaal 15 vragen");

export type QuestionnaireCompletionStatus =
  | "QUESTIONNAIRE_FOLLOW_UP" // afwachtende follow-upantwoorden (ronde 2)
  | "QUESTIONNAIRE_COMPLETE" // voldoende betrouwbare informatie
  | "QUESTIONNAIRE_ATTENTION"; // onvoldoende na ronde 2 → aandachtspunt Silvijn

export const questionnaireSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Ongeldige slug")
  .min(1)
  .max(120);

export const MAX_TEXT_ANSWER = 500;
export const MAX_TEXTAREA_ANSWER = 5000;
export const MAX_EMAIL_ANSWER = 320;

export interface ValidatedAnswers {
  answers: Record<string, string>;
}

/**
 * Valideert ruwe antwoorden (Form Data) tegen de vraagdefinities.
 * - alleen gedefinieerde vraag-id's worden geaccepteerd;
 * - verplichte vragen moeten zijn ingevuld;
 * - select-antwoorden moeten uit de opties komen;
 * - e-mailvelden worden gevalideerd; elke tekst heeft een lengtelimiet.
 * Onbekende/extra velden worden genegeerd, niet opgeslagen.
 */
export function validateQuestionnaireAnswers(
  questions: QuestionnaireQuestion[],
  raw: Record<string, string>
): ValidatedAnswers {
  const answers: Record<string, string> = {};
  const errors: string[] = [];

  for (const question of questions) {
    const value = (raw[question.id] ?? "").trim();
    if (!value) {
      if (question.required) errors.push(`"${question.label}" is verplicht`);
      continue;
    }
    if (question.type === "select") {
      if (!question.options?.includes(value)) errors.push(`"${question.label}": ongeldig antwoord`);
      else answers[question.id] = value;
      continue;
    }
    if (question.type === "email") {
      const email = z.email().max(MAX_EMAIL_ANSWER).safeParse(value);
      if (!email.success) errors.push(`"${question.label}": geldig e-mailadres verwacht`);
      else answers[question.id] = value;
      continue;
    }
    if (question.type === "tel") {
      const tel = z.string().min(3).max(30).regex(/^[+0-9 ()-]+$/, "Ongeldig telefoonnummer").safeParse(value);
      if (!tel.success) errors.push(`"${question.label}": geldig telefoonnummer verwacht`);
      else answers[question.id] = value;
      continue;
    }
    const max = question.type === "textarea" ? MAX_TEXTAREA_ANSWER : MAX_TEXT_ANSWER;
    if (value.length > max) errors.push(`"${question.label}": te lang (max ${max} tekens)`);
    else answers[question.id] = value;
  }

  if (errors.length > 0) throw new Error(errors.join(" · "));
  return { answers };
}
