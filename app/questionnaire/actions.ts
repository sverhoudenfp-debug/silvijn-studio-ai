"use server";

import { redirect } from "next/navigation";
import { submitQuestionnaireResponse } from "@/lib/questionnaire/service";
import { questionnaireSlugSchema } from "@/lib/questionnaire/validation";
import { validateUploadFile, type UploadCandidate } from "@/lib/questionnaire/uploads";

/**
 * Publieke questionnaire-action — bewust NIET in app/actions (die map bevat
 * uitsluitend owner-beschermde acties). Iedereen mag antwoorden insturen op
 * een actieve questionnaire; validatie en opslag gebeuren server-side.
 * Bestanden worden pas na validatie privé opgeslagen; foutieve uploads
 * veroorzaken géén antwoordopslag (transactie-achtig: alles of niets).
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
  const files: UploadCandidate[] = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("q_") && typeof value === "string") raw[key.slice(2)] = value;
    if (key.startsWith("f_") && value instanceof File && value.size > 0) {
      files.push({ questionId: key.slice(2), file: value });
    }
  }

  try {
    // Early validatie: een ongeldig bestand mag de server niet raken.
    for (const candidate of files) validateUploadFile(candidate.file);
    const result = await submitQuestionnaireResponse(slug.data, raw, files);
    if (result.next === "follow_up") {
      redirect(`/questionnaire/${slug.data}?follow_up=1`);
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Insturen mislukt. Probeer het opnieuw." };
  }
  redirect(`/questionnaire/${slug.data}?submitted=1`);
}
