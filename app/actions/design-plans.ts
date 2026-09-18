"use server";

import { revalidatePath } from "next/cache";
import { requireStudioOwner } from "@/lib/auth/server";
import { AIError } from "@/lib/ai/errors";
import { DesignPlanService, DesignPlanError, DesignPlanValidationError } from "@/lib/websites/design-plan-service";
import type { DesignPlanRecord } from "@/lib/websites/design-plan";

/**
 * Design Plan server actions (Fase I.1) — de enige UI-entree naar de
 * interne designplanning. Het plan is intern werkdocument: er bestaat hier
 * géén lever-, publiceer- of verzendpad. Generatie is een expliciete,
 * door de eigenaar geïnitieerde actie.
 *
 * Productie foutroute: een EXPECTED falende generatie (AI-timeout, rate
 * limit, consistentierejectie) throwt níet, maar komt terug als
 * { ok: false, error }. Anders maskeert Next/React de serverfout in
 * productie tot "Minified React error #441" en ziet de eigenaar geen oorzaak.
 * Onverwachte fouten (infrastructuur e.d.) blijven wél throwen zodat Vercel
 * ze logt; de service heeft het mislukte plan-record dan al gepersisteerd.
 */

export type GenerateDesignPlanResult =
  | { ok: true; record: DesignPlanRecord }
  | { ok: false; error: string };

export async function generateDesignPlanAction(projectId: string): Promise<GenerateDesignPlanResult> {
  await requireStudioOwner();
  try {
    const record = await new DesignPlanService().generateDesignPlan(projectId);
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, record };
  } catch (error) {
    // Het service-record (status failed, met reden) is vóór de rethrow
    // gepersisteerd — de pagina moet die nieuwe versie wél zien.
    revalidatePath(`/projects/${projectId}`);
    if (error instanceof AIError || error instanceof DesignPlanError || error instanceof DesignPlanValidationError) {
      // Onze eigen foutklassen zijn per ontwerp veilig om te tonen: geen
      // keys, geen stack traces, geen providerpayloads.
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

export async function listDesignPlansAction(projectId: string): Promise<DesignPlanRecord[]> {
  await requireStudioOwner();
  return new DesignPlanService().listByProject(projectId);
}

export async function getDesignPlanAction(planId: string): Promise<DesignPlanRecord> {
  await requireStudioOwner();
  return new DesignPlanService().get(planId);
}
