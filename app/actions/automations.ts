"use server";

import { revalidatePath } from "next/cache";
import { AutomationService } from "@/lib/automation/service";
import type { Automation, AutomationRun } from "@/lib/automation/types";

/**
 * Server actions voor de Automation Engine (Fase 11) — manual controls.
 *
 * HARDE GRENS: er bestaat hier GEEN approve/deliver/send-actie. Website-
 * goedkeuring blijft de aparte menselijke actie uit Fase 10
 * (approveWebsiteAction); automation-hervatting is daarvan gescheiden
 * en her-checkt de human gate deterministisch.
 */

export async function listAutomationsAction(): Promise<Automation[]> {
  return new AutomationService().listAutomations();
}

export async function listAutomationRunsAction(limit = 50): Promise<AutomationRun[]> {
  return new AutomationService().listRuns(limit);
}

export async function runAutomationAction(
  automationId: string,
  entityId: string | null = null
): Promise<AutomationRun> {
  const run = await new AutomationService().runNow(automationId, entityId);
  revalidatePath("/automations");
  revalidatePath(`/automations/${automationId}`);
  return run;
}

export async function pauseAutomationAction(automationId: string): Promise<Automation> {
  const automation = await new AutomationService().pause(automationId);
  revalidatePath("/automations");
  revalidatePath(`/automations/${automationId}`);
  return automation;
}

export async function resumeAutomationAction(automationId: string): Promise<Automation> {
  const automation = await new AutomationService().resume(automationId);
  revalidatePath("/automations");
  revalidatePath(`/automations/${automationId}`);
  return automation;
}

export async function resumeAutomationRunAction(runId: string): Promise<AutomationRun> {
  const run = await new AutomationService().resumeRun(runId);
  revalidatePath("/automations");
  revalidatePath(`/automation-runs/${runId}`);
  revalidatePath(`/automations/${run.automationId}`);
  return run;
}

export async function cancelAutomationAction(automationId: string): Promise<Automation> {
  const automation = await new AutomationService().cancel(automationId);
  revalidatePath("/automations");
  revalidatePath(`/automations/${automationId}`);
  return automation;
}
