"use server";

import { requireStudioOwner } from "@/lib/auth/server";
import { revalidatePath } from "next/cache";
import {
  closeQuestionnaire,
  createQuestionnaireForLead,
  linkQuestionnaireProject,
  publishQuestionnaire,
  reopenQuestionnaire,
} from "@/lib/questionnaire/service";

/**
 * Server actions — de enige entree naar questionnaire-management vanuit het
 * interne dashboard. Elke actie is een expliciete menselijke handeling van
 * de studio-eigenaar. Publiceren maakt de publieke URL bereikbaar; sluiten
 * stopt nieuwe antwoorden (bestaande antwoorden blijven behouden).
 */

export async function createQuestionnaireAction(leadId: string, projectId?: string | null) {
  await requireStudioOwner();
  const questionnaire = await createQuestionnaireForLead(leadId, projectId ?? null);
  revalidatePath("/questionnaires");
  revalidatePath(`/leads/${leadId}`);
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return questionnaire;
}

export async function publishQuestionnaireAction(questionnaireId: string) {
  await requireStudioOwner();
  const questionnaire = await publishQuestionnaire(questionnaireId);
  revalidatePath("/questionnaires");
  revalidatePath(`/questionnaires/${questionnaireId}`);
  revalidatePath(`/leads/${questionnaire.leadId}`);
  if (questionnaire.projectId) revalidatePath(`/projects/${questionnaire.projectId}`);
  return questionnaire;
}

export async function closeQuestionnaireAction(questionnaireId: string) {
  await requireStudioOwner();
  const questionnaire = await closeQuestionnaire(questionnaireId);
  revalidatePath("/questionnaires");
  revalidatePath(`/questionnaires/${questionnaireId}`);
  return questionnaire;
}

export async function reopenQuestionnaireAction(questionnaireId: string) {
  await requireStudioOwner();
  const questionnaire = await reopenQuestionnaire(questionnaireId);
  revalidatePath("/questionnaires");
  revalidatePath(`/questionnaires/${questionnaireId}`);
  return questionnaire;
}

export async function linkQuestionnaireProjectAction(questionnaireId: string, projectId: string | null) {
  await requireStudioOwner();
  const questionnaire = await linkQuestionnaireProject(questionnaireId, projectId);
  revalidatePath(`/questionnaires/${questionnaireId}`);
  return questionnaire;
}
