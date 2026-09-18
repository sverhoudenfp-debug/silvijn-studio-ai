"use server";

import { revalidatePath } from "next/cache";
import { requireStudioOwner } from "@/lib/auth/server";
import { DesignPlanService } from "@/lib/websites/design-plan-service";
import type { DesignPlanRecord } from "@/lib/websites/design-plan";

/**
 * Design Plan server actions (Fase I.1) — de enige UI-entree naar de
 * interne designplanning. Het plan is intern werkdocument: er bestaat hier
 * géén lever-, publiceer- of verzendpad. Generatie is een expliciete,
 * door de eigenaar geïnitieerde actie.
 */

export async function generateDesignPlanAction(projectId: string): Promise<DesignPlanRecord> {
  await requireStudioOwner();
  const record = await new DesignPlanService().generateDesignPlan(projectId);
  revalidatePath(`/projects/${projectId}`);
  return record;
}

export async function listDesignPlansAction(projectId: string): Promise<DesignPlanRecord[]> {
  await requireStudioOwner();
  return new DesignPlanService().listByProject(projectId);
}

export async function getDesignPlanAction(planId: string): Promise<DesignPlanRecord> {
  await requireStudioOwner();
  return new DesignPlanService().get(planId);
}
