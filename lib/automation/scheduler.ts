import type { Automation, AutomationRun } from "./types";
import { AutomationOrchestrator } from "./orchestrator";
import { AutomationQueue } from "./queue";
import { getAutomationRepository, getAutomationRunRepository } from "./repositories";

/**
 * AutomationScheduler (Fase 11, spec §20) — abstraction. In deze fase is
 * de concrete implementatie een directe processNow()-aanroep
 * (geen productie-cron); hetzelfde interface kan later door Vercel Cron,
 * een database-queue-worker of een externe scheduler worden vervuld.
 * schedule() noteert nextRunAt als metadata — echte periodieke planning
 * komt met de productie-scheduler (geen scope creep in deze fase).
 */
export class AutomationScheduler {
  constructor(
    private readonly orchestrator: AutomationOrchestrator = new AutomationOrchestrator(),
    private readonly queue: AutomationQueue = new AutomationQueue()
  ) {}

  /** Direct uitvoeren ("run now") — expliciete menselijke actie. */
  async runNow(automationId: string, entityId: string | null = null): Promise<AutomationRun> {
    return this.orchestrator.runAutomation(automationId, entityId, entityId ? "lead" : "none");
  }

  /** Inplannen via de queue; processQueue() verwerkt de items. */
  async schedule(automationId: string, entityId: string | null = null, runAt?: string): Promise<AutomationRun | null> {
    const automation = await getAutomationRepository().getById(automationId);
    if (!automation) throw new Error("Automation bestaat niet.");
    await this.queue.enqueue({
      automationId,
      entityId,
      entityType: entityId ? "lead" : "none",
      triggerEvent: "manual",
    });
    await getAutomationRepository().update(automationId, {
      nextRunAt: runAt ?? new Date(Date.now() + 60_000).toISOString(),
    });
    // In deze fase wordt direct daarna verwerkt (geen achtergrondworker):
    return this.processQueue();
  }

  /** Verwerkt alle queued items (in-test en direct-aanroep in server actions). */
  async processQueue(): Promise<AutomationRun | null> {
    let last: AutomationRun | null = null;
    while (true) {
      const item = await this.queue.dequeue();
      if (!item) break;
      await this.queue.markProcessing(item);
      try {
        last = await this.orchestrator.runAutomation(item.automationId, item.entityId, item.entityType);
        await this.queue.complete(item);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.queue.fail(item, message);
        throw error;
      }
    }
    return last;
  }

  async pause(automationId: string): Promise<Automation | null> {
    const repo = getAutomationRepository();
    const automation = await repo.getById(automationId);
    if (!automation) return null;
    return repo.update(automationId, { status: "paused", enabled: false });
  }

  async resume(automationId: string): Promise<Automation | null> {
    const repo = getAutomationRepository();
    const automation = await repo.getById(automationId);
    if (!automation) return null;
    return repo.update(automationId, { status: "active", enabled: true });
  }

  async cancel(automationId: string): Promise<Automation | null> {
    const repo = getAutomationRepository();
    const automation = await repo.getById(automationId);
    if (!automation) return null;
    // Actieve runs van deze automation annuleren:
    const runRepo = getAutomationRunRepository();
    const active = (await runRepo.listByAutomation(automationId, 100)).filter(
      (r) => r.status === "running" || r.status === "queued"
    );
    for (const run of active) {
      await runRepo.update(run.id, {
        status: "cancelled",
        completedAt: new Date().toISOString(),
        error: "Automation geannuleerd door menselijke actie.",
      });
    }
    return repo.update(automationId, { status: "disabled", enabled: false });
  }
}
