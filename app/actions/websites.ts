"use server";

import { revalidatePath } from "next/cache";
import { QualityControlService } from "@/lib/qc/service";
import type { QualityControl } from "@/lib/qc/types";
import { WebsiteGenerationService } from "@/lib/websites/service";
import type { GeneratedWebsite } from "@/lib/websites/types";

/**
 * Server actions voor websitegeneratie (Fase 9) + quality control en
 * menselijke approval (Fase 10). Alle mutaties verlopen server-side.
 *
 * HARDE GRENS: er bestaat GEEN deliver/publish/e-mail/contract/factuur-
 * actie. READY_FOR_SILVIJN → APPROVED is uitsluitend een menselijke
 * actie via approveWebsiteAction (met guards). Er is geen override.
 */

export async function generateWebsiteAction(projectId: string): Promise<GeneratedWebsite> {
  const website = await new WebsiteGenerationService().generateWebsite(projectId);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/generated-websites");
  return website;
}

// ============ QUALITY CONTROL + HUMAN APPROVAL (Fase 10) ============

export async function runQualityControlAction(websiteId: string): Promise<QualityControl> {
  const qc = await new QualityControlService().runQualityControl(websiteId);
  revalidatePath("/generated-websites");
  return qc;
}

export async function getLatestQcAction(websiteId: string): Promise<QualityControl | null> {
  return new QualityControlService().getLatestQcForWebsite(websiteId);
}

export async function approveWebsiteAction(websiteId: string): Promise<GeneratedWebsite> {
  const { website } = await new QualityControlService().approveWebsite(websiteId);
  revalidatePath("/generated-websites");
  revalidatePath(`/projects/${website.projectId}`);
  return website;
}

export async function requestWebsiteRevisionAction(
  websiteId: string,
  reason: string,
  options?: { selectedIssueIds?: string[]; notes?: string }
): Promise<GeneratedWebsite> {
  const { website } = await new QualityControlService().requestWebsiteRevision(websiteId, reason, options);
  revalidatePath("/generated-websites");
  revalidatePath(`/projects/${website.projectId}`);
  return website;
}

export async function archiveWebsiteAction(websiteId: string): Promise<GeneratedWebsite> {
  const website = await new QualityControlService().archiveWebsite(websiteId);
  revalidatePath("/generated-websites");
  revalidatePath(`/projects/${website.projectId}`);
  return website;
}

export async function listWebsitesAction(): Promise<GeneratedWebsite[]> {
  return new WebsiteGenerationService().list();
}

export async function listWebsitesByProjectAction(projectId: string): Promise<GeneratedWebsite[]> {
  return new WebsiteGenerationService().listByProject(projectId);
}
