"use server";

import { redirect } from "next/navigation";
import { submitQuestionnaireResponse } from "@/lib/questionnaire/service";
import { questionnaireSlugSchema } from "@/lib/questionnaire/validation";

/**
 * Publieke questionnaire-action — bewust NIET in app/actions (die map bevat
 * uitsluitend owner-beschermde acties). Iedereen mag antwoorden insturen op
 * een actieve questionnaire; validatie en opslag gebeuren server-side.
 */

export interface QuestionnaireSubmitState {
  error: string | null;
}

export async function submitQuestionnaireResponseAction(
  _prev: QuestionnaireSubmitState,
  formData: FormData
): Promise<QuestionnaireSubmitState> {
  const slug = questionnaireSlugSchema.safeParse(String(formData.get("slug") ?? ""));
  if (!slug.success) return { error: "Ongeldige questionnaire-link." };

  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("q_") && typeof value === "string") raw[key.slice(2)] = value;
  }

  try {
    await submitQuestionnaireResponse(slug.data, raw);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Insturen mislukt. Probeer het opnieuw." };
  }
  redirect(`/questionnaire/${slug.data}?submitted=1`);
}
