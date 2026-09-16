import { AutomationOrchestrator } from "./orchestrator";
import { AutomationScheduler } from "./scheduler";
import {
  getAutomationRepository,
  getAutomationRunRepository,
} from "./repositories";
import { listRecentEvents } from "./events";
import { getAutonomyLevel } from "./limits";
import { LEAD_DISCOVERY_STEPS, QUALIFIED_LEAD_TO_WEBSITE_STEPS } from "./workflows";
import type { Automation, AutomationRun } from "./types";

/**
 * AutomationService (Fase 11) — facade voor UI/server actions:
 * - seedt de twee voorbeeldworkflows (idempotent)
 * - leest automations/runs/events voor de dashboards
 * - manual controls: run now / pause / resume / cancel (server actions)
 * BELANGRIJK: deze service bevat GEEN approve/deliver/send-functionaliteit;
 * goedkeuring blijft de aparte menselijke actie uit Fase 10.
 */

export const AUTOMATION_IDS = {
  qualifiedLeadToWebsite: "auto-qualified-lead-website",
  leadDiscovery: "auto-lead-discovery",
} as const;

export class AutomationService {
  constructor(
    private readonly scheduler: AutomationScheduler = new AutomationScheduler(),
    private readonly orchestrator: AutomationOrchestrator = new AutomationOrchestrator()
  ) {}

  /** Voorbeeldworkflows idempotent aanmaken (bestaande blijven ongewijzigd). */
  async ensureWorkflows(): Promise<void> {
    const repo = getAutomationRepository();

    if (!(await repo.getById(AUTOMATION_IDS.qualifiedLeadToWebsite))) {
      await repo.create({
        id: AUTOMATION_IDS.qualifiedLeadToWebsite,
        name: "Qualified Lead → Website Ready",
        description:
          "Van gekwalificeerde lead tot klaargekeurde website: project, requirements-check, prijsindicatie, websitegeneratie, kwaliteitscontrole — en stopt bij de human gate (goedkeuring Silvijn).",
        type: "lead_pipeline",
        status: "active",
        enabled: true,
        trigger: "lead_qualified",
        steps: QUALIFIED_LEAD_TO_WEBSITE_STEPS,
        currentStep: null,
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
        lastRunAt: null,
        nextRunAt: null,
      });
    }

    if (!(await repo.getById(AUTOMATION_IDS.leadDiscovery))) {
      await repo.create({
        id: AUTOMATION_IDS.leadDiscovery,
        name: "Lead Discovery",
        description:
          "Ontdekken, dedupliceren, verrijken, analyseren en scoren van leads via de bestaande discovery-engine. Verstuur nooit automatisch outreach.",
        type: "discovery",
        status: "active",
        enabled: true,
        trigger: "manual",
        steps: LEAD_DISCOVERY_STEPS,
        currentStep: null,
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
        lastRunAt: null,
        nextRunAt: null,
      });
    }
  }

  async listAutomations(): Promise<Automation[]> {
    await this.ensureWorkflows();
    return getAutomationRepository().list();
  }

  async getAutomation(id: string): Promise<Automation | null> {
    return getAutomationRepository().getById(id);
  }

  async getAutomationWithRuns(id: string): Promise<{ automation: Automation | null; runs: AutomationRun[] }> {
    return {
      automation: await getAutomationRepository().getById(id),
      runs: await getAutomationRunRepository().listByAutomation(id, 20),
    };
  }

  async listRuns(limit = 50): Promise<AutomationRun[]> {
    return getAutomationRunRepository().list(limit);
  }

  async getRun(id: string): Promise<AutomationRun | null> {
    return getAutomationRunRepository().getById(id);
  }

  async listEvents(limit = 50) {
    return listRecentEvents(limit);
  }

  getAutonomyLevel(): 0 | 1 | 2 | 3 {
    return getAutonomyLevel();
  }

  // ---- Manual controls (server actions) ----

  async runNow(automationId: string, entityId: string | null = null): Promise<AutomationRun> {
    return this.scheduler.runNow(automationId, entityId);
  }

  async pause(automationId: string): Promise<Automation> {
    const updated = await this.scheduler.pause(automationId);
    if (!updated) throw new Error("Automation niet gevonden.");
    return updated;
  }

  async resume(automationId: string): Promise<Automation> {
    const updated = await this.scheduler.resume(automationId);
    if (!updated) throw new Error("Automation niet gevonden.");
    return updated;
  }

  /** Actieve run hervatten na een vervulde human gate (expliciete menselijke actie). */
  async resumeRun(runId: string): Promise<AutomationRun> {
    return this.orchestrator.resumeRun(runId);
  }

  async cancel(automationId: string): Promise<Automation> {
    const updated = await this.scheduler.cancel(automationId);
    if (!updated) throw new Error("Automation niet gevonden.");
    return updated;
  }
}
