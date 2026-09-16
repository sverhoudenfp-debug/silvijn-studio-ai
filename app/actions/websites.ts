"use server";

import { revalidatePath } from "next/cache";
import { WebsiteGenerationService } from "@/lib/websites/service";
import type { GeneratedWebsite } from "@/lib/websites/types";

/**
 * Server actions voor websitegeneratie (Fase 9). Generatie is een expliciete
 * interne actie; er bestaat GEEN deliver/publish/e-mail-actie — de output
 * eindigt bij READY_FOR_QC (quality control volgt in Fase 10).
 */

export async function generateWebsiteAction(projectId: string): Promise<GeneratedWebsite> {
  const website = await new WebsiteGenerationService().generateWebsite(projectId);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/generated-websites");
  return website;
}

export async function listWebsitesAction(): Promise<GeneratedWebsite[]> {
  return new WebsiteGenerationService().list();
}

export async function listWebsitesByProjectAction(projectId: string): Promise<GeneratedWebsite[]> {
  return new WebsiteGenerationService().listByProject(projectId);
}
