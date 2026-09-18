"use server";

import { requireStudioOwner } from "@/lib/auth/server";


import { revalidatePath } from "next/cache";
import { ProjectService } from "@/lib/projects/service";
import { humanRpc } from "@/lib/auth/server";
import { getProjectRepository } from "@/lib/projects/repository";
import { evaluateRequirementsCompleteness, type CompletenessEvaluation } from "@/lib/projects/completeness";
import { getQuestionnaireRepository } from "@/lib/questionnaire/repository";
import type { Project, ProjectRequirements, ProjectStatus } from "@/lib/projects/types";
import type { PriceIndication } from "@/lib/pricing/types";

/**
 * Server actions — de enige entree naar projecten en pricing vanuit de UI.
 * Elke actie is een expliciete menselijke handeling; er bestaat geen
 * verzend-, offerte- of betaalactie in Fase 8. AI zet nooit
 * approved/in_progress/completed.
 */

export async function createProjectAction(leadId: string): Promise<Project> {
  await requireStudioOwner();
  const project = await new ProjectService().createFromLead(leadId);
  revalidatePath("/projects");
  revalidatePath(`/leads/${leadId}`);
  return project;
}

export async function getProjectAction(projectId: string): Promise<Project> {
  await requireStudioOwner();
  return new ProjectService().get(projectId);
}

export async function listProjectsAction(): Promise<Project[]> {
  await requireStudioOwner();
  return new ProjectService().list();
}

export async function updateProjectAction(
  projectId: string,
  input: { name?: string; description?: string; timeline?: string | null; notes?: string }
): Promise<Project> {
  await requireStudioOwner();
  const project = await new ProjectService().update(projectId, input);
  revalidatePath(`/projects/${projectId}`);
  return project;
}

export async function updateRequirementsAction(projectId: string, requirements: ProjectRequirements): Promise<Project> {
  await requireStudioOwner();
  const project = await new ProjectService().updateRequirements(projectId, requirements);
  revalidatePath(`/projects/${projectId}`);
  return project;
}

export async function proposeRequirementsAction(projectId: string) {
  await requireStudioOwner();
  const result = await new ProjectService().proposeRequirements(projectId);
  revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function calculatePriceAction(projectId: string): Promise<{ project: Project; indication: PriceIndication }> {
  await requireStudioOwner();
  const service = new ProjectService();
  const project = await service.calculatePrice(projectId);
  const indications = await service.getIndications(projectId);
  revalidatePath(`/projects/${projectId}`);
  return { project, indication: indications[0] };
}

export async function listIndicationsAction(projectId: string): Promise<PriceIndication[]> {
  await requireStudioOwner();
  return new ProjectService().getIndications(projectId);
}

export async function sendToSilvijnAction(projectId: string, reason?: string): Promise<Project> {
  await requireStudioOwner();
  const project = await new ProjectService().sendToSilvijn(projectId, reason);
  revalidatePath(`/projects/${projectId}`);
  return project;
}

export async function approvePriceAction(projectId: string): Promise<Project> {
  await requireStudioOwner();
  const project = await new ProjectService().approvePrice(projectId);
  revalidatePath(`/projects/${projectId}`);
  return project;
}

export async function rejectPriceAction(projectId: string, reason?: string): Promise<Project> {
  await requireStudioOwner();
  const project = await new ProjectService().rejectPrice(projectId, reason);
  revalidatePath(`/projects/${projectId}`);
  return project;
}

export async function updateProjectStatusAction(projectId: string, status: ProjectStatus): Promise<Project> {
  await requireStudioOwner();
  const project = await new ProjectService().updateStatus(projectId, status);
  revalidatePath(`/projects/${projectId}`);
  return project;
}

// ============================================================
// Fase I.1 — DETERMINISTISCHE requirements-completeness
// ============================================================

/**
 * Compleetheid beoordelen (expliciete owner-actie). De app-laag geeft de
 * uitspraak leesbaar weer; requirements_complete wordt uitsluitend gezet
 * door de owner-RPC set_project_requirements_complete, die dezelfde zes
 * blokkerende checks onafhankelijk herverifieert in SQL. Bij onvoldoende
 * informatie wordt de missende lijst getoond — er wordt nooit gegokt en
 * de productie-gate blijft dicht.
 */
export async function evaluateRequirementsCompletenessAction(projectId: string): Promise<{
  evaluation: CompletenessEvaluation;
  requirementsComplete: boolean;
}> {
  await requireStudioOwner();
  const project = await getProjectRepository().getById(projectId);
  if (!project) throw new Error("Project niet gevonden");
  const questionnaires = await getQuestionnaireRepository().findByLeadId(project.leadId);
  const evaluation = evaluateRequirementsCompleteness(project.requirements, questionnaires.map((q) => ({
    status: q.status,
    completionStatus: q.completionStatus,
  })));
  let requirementsComplete = project.requirementsComplete;
  if (evaluation.complete) {
    // Enige weg naar true: de RPC herverifieert in SQL en auditeert.
    await humanRpc("set_project_requirements_complete", { p_project: projectId });
    requirementsComplete = true;
  }
  revalidatePath(`/projects/${projectId}`);
  return { evaluation, requirementsComplete };
}

/** Compleetheid expliciet intrekken (owner-RPC, geauditeerd). */
export async function markRequirementsIncompleteAction(projectId: string, reason: string): Promise<boolean> {
  await requireStudioOwner();
  await humanRpc("set_project_requirements_incomplete", { p_project: projectId, p_reason: reason ?? "" });
  revalidatePath(`/projects/${projectId}`);
  return true;
}
