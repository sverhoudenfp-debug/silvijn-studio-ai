"use server";

import { revalidatePath } from "next/cache";
import { ProjectService } from "@/lib/projects/service";
import type { Project, ProjectRequirements, ProjectStatus } from "@/lib/projects/types";
import type { PriceIndication } from "@/lib/pricing/types";

/**
 * Server actions — de enige entree naar projecten en pricing vanuit de UI.
 * Elke actie is een expliciete menselijke handeling; er bestaat geen
 * verzend-, offerte- of betaalactie in Fase 8. AI zet nooit
 * approved/in_progress/completed.
 */

export async function createProjectAction(leadId: string): Promise<Project> {
  const project = await new ProjectService().createFromLead(leadId);
  revalidatePath("/projects");
  revalidatePath(`/leads/${leadId}`);
  return project;
}

export async function getProjectAction(projectId: string): Promise<Project> {
  return new ProjectService().get(projectId);
}

export async function listProjectsAction(): Promise<Project[]> {
  return new ProjectService().list();
}

export async function updateProjectAction(
  projectId: string,
  input: { name?: string; description?: string; timeline?: string | null; notes?: string }
): Promise<Project> {
  const project = await new ProjectService().update(projectId, input);
  revalidatePath(`/projects/${projectId}`);
  return project;
}

export async function updateRequirementsAction(projectId: string, requirements: ProjectRequirements): Promise<Project> {
  const project = await new ProjectService().updateRequirements(projectId, requirements);
  revalidatePath(`/projects/${projectId}`);
  return project;
}

export async function proposeRequirementsAction(projectId: string) {
  const result = await new ProjectService().proposeRequirements(projectId);
  revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function calculatePriceAction(projectId: string): Promise<{ project: Project; indication: PriceIndication }> {
  const service = new ProjectService();
  const project = await service.calculatePrice(projectId);
  const indications = await service.getIndications(projectId);
  revalidatePath(`/projects/${projectId}`);
  return { project, indication: indications[0] };
}

export async function listIndicationsAction(projectId: string): Promise<PriceIndication[]> {
  return new ProjectService().getIndications(projectId);
}

export async function sendToSilvijnAction(projectId: string, reason?: string): Promise<Project> {
  const project = await new ProjectService().sendToSilvijn(projectId, reason);
  revalidatePath(`/projects/${projectId}`);
  return project;
}

export async function approvePriceAction(projectId: string): Promise<Project> {
  const project = await new ProjectService().approvePrice(projectId);
  revalidatePath(`/projects/${projectId}`);
  return project;
}

export async function rejectPriceAction(projectId: string, reason?: string): Promise<Project> {
  const project = await new ProjectService().rejectPrice(projectId, reason);
  revalidatePath(`/projects/${projectId}`);
  return project;
}

export async function updateProjectStatusAction(projectId: string, status: ProjectStatus): Promise<Project> {
  const project = await new ProjectService().updateStatus(projectId, status);
  revalidatePath(`/projects/${projectId}`);
  return project;
}
