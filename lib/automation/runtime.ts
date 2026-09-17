import { getAIActivityRepository } from "@/lib/repositories/ai-activity-repository";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { isTransientError } from "./guards";
import { getAutomationLimits } from "./limits";
import { emitEvent } from "./events";
import { AutomationQueue } from "./queue";
import { getAutomationRepository } from "./repositories";
import type { AutomationQueueItem, AutomationRun } from "./types";

/**
 * AutomationRuntime (productie, Masterconfig "Automation Runtime") — de
 * productie-drain LAAG OP de bestaande engine. Bouwt NIET voort met eigen
 * uitvoerlogica: elk item wordt via de bestaende AutomationOrchestrator
 * (capability matrix, cost guard, loop protection, idempotency, rate
 * limits, human gates) uitgevoerd. De runtime doet alléén:
 *
 *   claim → run (bestaande orchestrator) → queue-uitkomst + audit.
 *
 * HARDE GRENSen (onveranderd):
 *   - Prijs-, betaal-, website-goedkeuring, levering en Shopify-transfer
 *     blijven menselijke acties; de capability matrix blokkeert die steps
 *     vóór enige uitvoer en de runtime heeft daar geen override op.
 *   - Lead discovery is NIET autonoom: de runtime claimt alléén bestaande
 *     queue-items (owner-actie). Hij enqueued zelf nooit iets en start
 *     nooit automations spontaan.
 *   - Outreach-verzending blijft geblokkeerd totdat Gmail expliciet is
 *     geconfigureerd EN verbonden (send_outreach = human_required in de
 *     matrix; generate_outreach maakt alléén drafts).
 */

/** Minimaal interface dat de echte orchestrator ook vervult (testbaar). */
export interface AutomationRunner {
  runAutomation(
    automationId: string,
    entityId: string | null,
    entityType?: AutomationRun["entityType"]
  ): Promise<AutomationRun>;
}

export interface RuntimeConfig {
  /** Kill-switch (menselijke configuratie, NOOIT automation/AI-bepaald). */
  enabled: boolean;
  /** Max items per drain (batchbegrenzing). */
  maxItemsPerDrain: number;
  /** Tijdsbudget per drain in ms (serverless function-limiet). */
  timeBudgetMs: number;
  /** Max pogingen per queue-item vóór definitief faal. */
  maxQueueAttempts: number;
  /** 'processing'-items ouder dan dit zijn vastgelopen → reclaim. */
  staleAfterMs: number;
}

function readIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getRuntimeConfig(): RuntimeConfig {
  return {
    enabled: (process.env.AUTOMATION_RUNTIME_ENABLED ?? "true").trim().toLowerCase() !== "false",
    maxItemsPerDrain: readIntEnv("AUTOMATION_MAX_ITEMS_PER_DRAIN", 5),
    timeBudgetMs: readIntEnv("AUTOMATION_DRAIN_TIME_BUDGET_MS", 8 * 60 * 1000),
    maxQueueAttempts: readIntEnv("AUTOMATION_MAX_QUEUE_ATTEMPTS", 3),
    staleAfterMs: readIntEnv("AUTOMATION_QUEUE_STALE_MS", 30 * 60 * 1000),
  };
}

export interface QueueItemOutcome {
  queueItemId: string;
  automationId: string;
  entityId: string | null;
  outcome: "completed" | "retried" | "failed";
  runId: string | null;
  runStatus: AutomationRun["status"] | null;
  attempts: number;
  error: string | null;
  detail: string;
}

export interface DrainResult {
  ok: true;
  disabled?: boolean;
  reclaimed: number;
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
  queueEmpty: boolean;
  timeBudgetExceeded: boolean;
  items: QueueItemOutcome[];
}

/**
 * FAIL-LOUD productiecheck: de runtime draait nooit op mock-repositories.
 * (In dev/test is memory prima; daar is dit de bedoelde werkmodus.)
 */
export function assertProductionRuntimeConfigured(): void {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    isSupabaseConfigured(); // gooit AIConfigurationError bij ontbrekende config
  }
}

export class AutomationRuntime {
  private readonly limits = getAutomationLimits();

  constructor(
    private readonly runner: AutomationRunner,
    private readonly queue: AutomationQueue = new AutomationQueue()
  ) {}

  /**
   * Verwerkt de bestaande queue: reclaim stale items, claim dan items
   * één voor één tot de queue leeg is óf het budget op is. Elk item
   * krijgt een typed audit-event; niets wordt stil gedropt.
   */
  async drain(config: RuntimeConfig = getRuntimeConfig()): Promise<DrainResult> {
    const result: DrainResult = {
      ok: true,
      reclaimed: 0,
      claimed: 0,
      completed: 0,
      retried: 0,
      failed: 0,
      queueEmpty: false,
      timeBudgetExceeded: false,
      items: [],
    };
    if (!config.enabled) {
      return { ...result, disabled: true, queueEmpty: true };
    }

    const deadline = Date.now() + config.timeBudgetMs;

    // 1. Vastgelopen items terugwinnen (crash/cold-stop herstel).
    result.reclaimed = await this.queue.reclaimStale(config.staleAfterMs, config.maxQueueAttempts);
    if (result.reclaimed > 0) {
      await emitEvent({
        type: "queue_item_reclaimed",
        entityType: "none",
        entityId: null,
        payload: { reclaimed: result.reclaimed },
        source: "runtime",
      });
    }

    // 2. Queue batchsgewijs leegwerken. Items die in DEZE drain al een
    // herkansing kregen worden uitgesloten: een tijdelijke fout krijgt
    // uitstel tot de volgende drain (natuurlijke backoff) in plaats van
    // alle pogingen in één drain te verbranden.
    const retriedThisDrain = new Set<string>();
    while (result.claimed < config.maxItemsPerDrain) {
      if (Date.now() >= deadline) {
        result.timeBudgetExceeded = true;
        break;
      }

      const item = await this.queue.claimNext([...retriedThisDrain]);
      if (!item) {
        result.queueEmpty = true;
        break;
      }
      result.claimed += 1;

      const outcome = await this.processItem(item, config);
      result.items.push(outcome);
      if (outcome.outcome === "completed") result.completed += 1;
      else if (outcome.outcome === "retried") {
        result.retried += 1;
        retriedThisDrain.add(item.id);
      } else result.failed += 1;
    }

    await this.logRuntime(
      `Runtime-drain: ${result.claimed} verwerkt, ${result.completed} voltooid, ` +
        `${result.retried} herkans, ${result.failed} gefaald, ${result.reclaimed} teruggewonnen.`
    );
    return result;
  }

  /** Eén geclaimd item → bestaande orchestrator → queue-uitkomst. */
  private async processItem(item: AutomationQueueItem, config: RuntimeConfig): Promise<QueueItemOutcome> {
    await emitEvent({
      type: "queue_item_claimed",
      entityType: item.entityType,
      entityId: item.entityId,
      payload: { queueItemId: item.id, automationId: item.automationId, attempts: item.attempts },
      source: "runtime",
    });

    const automationRepo = getAutomationRepository();
    const automation = await automationRepo.getById(item.automationId);

    // Automation weg/gepauzeerd/uitgeschakeld → item definitief faal.
    // De runtime zet nooit zelf automations aan om dit te omzeilen.
    if (!automation || !automation.enabled || automation.status !== "active") {
      const reason = !automation
        ? `Automation "${item.automationId}" bestaat niet (meer) — queue-item definitief gefaald.`
        : `Automation "${automation.name}" is niet actief (status ${automation.status}, enabled ${automation.enabled}) — queue-item definitief gefaald.`;
      await this.queue.fail(item, reason);
      await this.emitOutcome(item, "failed", null, null, reason, reason);
      return {
        queueItemId: item.id,
        automationId: item.automationId,
        entityId: item.entityId,
        outcome: "failed",
        runId: null,
        runStatus: null,
        attempts: item.attempts,
        error: reason,
        detail: reason,
      };
    }

    try {
      const run = await this.runner.runAutomation(item.automationId, item.entityId, item.entityType);

      // Run gestart én in een eindstatus zonder verdere automation-werk:
      // completed / paused (human gate!) / blocked → queue-item is klaar.
      // paused betekent NOOIT een retry: het vervolg is een menselijke
      // actie (resume), niet opnieuw enqueuen.
      if (run.status === "completed" || run.status === "paused" || run.status === "blocked" || run.status === "cancelled") {
        await this.queue.complete(item);
        const detail =
          run.status === "paused"
            ? `Run ${run.id} gepauzeerd bij een human gate — vervolg is een expliciete menselijke actie. Queue-item afgerond.`
            : `Run ${run.id} eindigde als "${run.status}". Queue-item afgerond.`;
        await this.emitOutcome(item, "completed", run.id, run.status, null, detail);
        return {
          queueItemId: item.id,
          automationId: item.automationId,
          entityId: item.entityId,
          outcome: "completed",
          runId: run.id,
          runStatus: run.status,
          attempts: item.attempts,
          error: null,
          detail,
        };
      }

      // run.status === "failed" → tijdelijke fout herkansen, permanente faal.
      const error = run.error ?? "onbekende fout";
      return await this.settleFailure(item, error, run.id, config);
    } catch (error) {
      // runAutomation gooide (guard: rate limit, lock, duplicate, …).
      const message = error instanceof Error ? error.message : String(error);
      return await this.settleFailure(item, message, null, config);
    }
  }

  /** Herstelbeleid voor een mislukte verwerking van één item. */
  private async settleFailure(
    item: AutomationQueueItem,
    message: string,
    runId: string | null,
    config: RuntimeConfig
  ): Promise<QueueItemOutcome> {
    const transient = isTransientError(message) && item.attempts + 1 < config.maxQueueAttempts;

    if (transient) {
      const updated = await this.queue.retry(item, message, config.maxQueueAttempts);
      const attempts = updated?.attempts ?? item.attempts + 1;
      const detail = `Tijdelijke fout (poging ${attempts}/${config.maxQueueAttempts}): ${message}`;
      await this.emitOutcome(item, "retried", runId, "failed", message, detail);
      return {
        queueItemId: item.id,
        automationId: item.automationId,
        entityId: item.entityId,
        outcome: "retried",
        runId,
        runStatus: "failed",
        attempts,
        error: message,
        detail,
      };
    }

    // Permanente fout (guard/menselijke gate/config) of pogingen op:
    // NOOIT automatisch herkansen — zichtbaar faal met reden.
    await this.queue.fail(item, message);
    const detail = item.attempts + 1 >= config.maxQueueAttempts
      ? `Max pogingen (${config.maxQueueAttempts}) bereikt — definitief gefaald: ${message}`
      : `Permanente fout (geen automatische herkansing): ${message}`;
    await this.emitOutcome(item, "failed", runId, "failed", message, detail);
    return {
      queueItemId: item.id,
      automationId: item.automationId,
      entityId: item.entityId,
      outcome: "failed",
      runId,
      runStatus: "failed",
      attempts: item.attempts + 1,
      error: message,
      detail,
    };
  }

  private async emitOutcome(
    item: AutomationQueueItem,
    outcome: "completed" | "retried" | "failed",
    runId: string | null,
    runStatus: AutomationRun["status"] | null,
    error: string | null,
    detail: string
  ): Promise<void> {
    await emitEvent({
      type:
        outcome === "completed"
          ? "queue_item_completed"
          : outcome === "retried"
            ? "queue_item_retried"
            : "queue_item_failed",
      entityType: item.entityType,
      entityId: item.entityId,
      payload: {
        queueItemId: item.id,
        automationId: item.automationId,
        runId,
        runStatus,
        attempts: item.attempts,
        error,
        detail,
      },
      source: "runtime",
    });
  }

  private async logRuntime(message: string): Promise<void> {
    try {
      await getAIActivityRepository().log({
        leadId: null,
        type: "automation",
        status: "completed",
        message: `[AUTOMATION RUNTIME] ${message}`,
        metadata: { subsystem: "automation-runtime" },
      });
    } catch {
      // Audit-event is al weggeschreven; activiteitenlog mag een run nooit breken.
    }
  }
}

