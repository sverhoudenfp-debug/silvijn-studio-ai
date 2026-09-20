"use server";

import { revalidatePath } from "next/cache";
import { requireStudioOwner } from "@/lib/auth/server";
import { AIError } from "@/lib/ai/errors";
import {
  ContentPlanService,
  ContentPlanError,
  ContentPlanValidationError,
  ContentPlanUpToDateError,
} from "@/lib/websites/content/content-plan-service";
import type { ContentPlanRecord } from "@/lib/websites/content/content-plan-repository";

/**
 * ContentPlan server actions (C3b) — de enige UI-entree naar de interne
 * content-pass. INTERN werkdocument: geen lever-, publiceer-, Shopify- of
 * verzendpad. Generatie is een expliciete, door de eigenaar geïnitieerde
 * actie.
 *
 * Productie foutroute (zelfde patroon als design plans): verwachte falen
 * (AI-timeout, finalizer-rejectie, consistency) komen terug als
 * { ok: false, error } i.p.v. een gemaskeerde React-error; onverwachte
 * fouten blijven throwen zodat Vercel ze logt.
 */

export type GenerateContentPlanResult =
  | { ok: true; record: ContentPlanRecord }
  | { ok: false; error: string; upToDate?: boolean };

export async function generateContentPlanAction(designPlanId: string): Promise<GenerateContentPlanResult> {
  await requireStudioOwner();
  try {
    const record = await new ContentPlanService().generateContentPlan(designPlanId);
    revalidatePath(`/projects/${record.projectId}`);
    return { ok: true, record };
  } catch (error) {
    if (error instanceof ContentPlanUpToDateError) {
      return { ok: false, error: error.message, upToDate: true };
    }
    if (error instanceof AIError || error instanceof ContentPlanError || error instanceof ContentPlanValidationError) {
      // Het failed-record is al gepersisteerd — de pagina moet de nieuwe
      // versie wél zien.
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

export async function listContentPlansAction(designPlanId: string): Promise<ContentPlanRecord[]> {
  await requireStudioOwner();
  return new ContentPlanService().listByDesignPlan(designPlanId);
}

export async function getContentPlanAction(planId: string): Promise<ContentPlanRecord> {
  await requireStudioOwner();
  return new ContentPlanService().get(planId);
}
