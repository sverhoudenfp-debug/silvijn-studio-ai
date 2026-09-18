"use server";

import { requireStudioOwner } from "@/lib/auth/server";


import { revalidatePath } from "next/cache";
import { QualityControlService } from "@/lib/qc/service";
import type { QualityControl } from "@/lib/qc/types";
import { WebsiteGenerationService } from "@/lib/websites/service";
import type { GeneratedWebsite } from "@/lib/websites/types";
import { ProductionGateError } from "@/lib/payments/service";
import { AIError } from "@/lib/ai/errors";
import { WebsiteGenerationError, WebsiteLimitError } from "@/lib/websites/service";

/**
 * Server actions voor websitegeneratie (Fase 9) + quality control en
 * menselijke approval (Fase 10). Alle mutaties verlopen server-side.
 *
 * HARDE GRENS: er bestaat GEEN deliver/publish/e-mail/contract/factuur-
 * actie. READY_FOR_SILVIJN → APPROVED is uitsluitend een menselijke
 * actie via approveWebsiteAction (met guards). Er is geen override.
 */

/**
 * Resultaatcontract voor de generate-actie. Een EXPECTED falende generatie
 * (productie-poort dicht: prijs/betaling ontbreken; lead-/projectguard;
 * generatielimiet; AI-/validatiefout met al gepersisteerde failed-status)
 * throwt níet, maar komt terug als { ok: false, error } — in productie
 * maskeert React een geserverde throw tot "Minified React error #441"
 * en ziet de eigenaar geen oorzaak (zelfde productieles als de
 * Design Plan-fix, commit 6390ad5). Onverwachte fouten (infrastructuur)
 * blijven throwen zodat Vercel ze logt.
 */
export type GenerateWebsiteResult =
  | { ok: true; website: GeneratedWebsite }
  | { ok: false; error: string };

export async function generateWebsiteAction(projectId: string): Promise<GenerateWebsiteResult> {
  await requireStudioOwner();
  try {
    const website = await new WebsiteGenerationService().generateWebsite(projectId);
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/generated-websites");
    return { ok: true, website };
  } catch (error) {
    // Óók op het faalpad: de service persisteert een failed
    // website-record vóór de rethrow — de pagina moet dat zien. (Bij een
    // poortweigering bestaat er nog géén record; revalidate is dan gratis.)
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/generated-websites");
    if (
      error instanceof ProductionGateError ||
      error instanceof WebsiteGenerationError ||
      error instanceof WebsiteLimitError ||
      error instanceof AIError
    ) {
      // Onze eigen foutklassen zijn per ontwerp veilig om te tonen: geen
      // keys, geen stack traces, geen providerpayloads.
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

// ============ QUALITY CONTROL + HUMAN APPROVAL (Fase 10) ============

export async function runQualityControlAction(websiteId: string): Promise<QualityControl> {
  await requireStudioOwner();
  const qc = await new QualityControlService().runQualityControl(websiteId);
  revalidatePath("/generated-websites");
  return qc;
}

export async function getLatestQcAction(websiteId: string): Promise<QualityControl | null> {
  await requireStudioOwner();
  return new QualityControlService().getLatestQcForWebsite(websiteId);
}

export async function approveWebsiteAction(websiteId: string): Promise<GeneratedWebsite> {
  await requireStudioOwner();
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
  await requireStudioOwner();
  const { website } = await new QualityControlService().requestWebsiteRevision(websiteId, reason, options);
  revalidatePath("/generated-websites");
  revalidatePath(`/projects/${website.projectId}`);
  return website;
}

export async function archiveWebsiteAction(websiteId: string): Promise<GeneratedWebsite> {
  await requireStudioOwner();
  const website = await new QualityControlService().archiveWebsite(websiteId);
  revalidatePath("/generated-websites");
  revalidatePath(`/projects/${website.projectId}`);
  return website;
}

export async function listWebsitesAction(): Promise<GeneratedWebsite[]> {
  await requireStudioOwner();
  return new WebsiteGenerationService().list();
}

export async function listWebsitesByProjectAction(projectId: string): Promise<GeneratedWebsite[]> {
  await requireStudioOwner();
  return new WebsiteGenerationService().listByProject(projectId);
}
