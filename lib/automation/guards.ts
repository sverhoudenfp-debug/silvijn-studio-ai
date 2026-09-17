import { getAutomationLimits, type AutomationLimits } from "./limits";
import { getAutomationRunRepository } from "./repositories";
import type { AutomationRun } from "./types";

/**
 * Automation guards (Fase 11, spec §7/22-26):
 * - Idempotency: zelfde automation + entity + step nooit dubbel uitvoeren
 * - Concurrency: geen twee actieve runs voor zelfde automation + entity
 * - Loop protection: max steps, visited-step-detectie, cycle detection, max runtime
 * - Cost guard: technische cost-limiet per run → BLOCKED, geen nieuwe AI-calls
 * - Rate limits: max runs per uur/dag
 * Al deze checks zijn DETERMINISTISCH en kunnen niet door AI-output
 * worden gewijzigd.
 */

export class AutomationGuardError extends Error {
  constructor(
    message: string,
    public readonly outcome: "blocked" | "failed" | "skipped" = "blocked"
  ) {
    super(message);
    this.name = "AutomationGuardError";
  }
}

/** Concurrency-locks (in-process; Supabase-variant kan later via advisory locks). */
const activeLocks = new Set<string>();

export function lockKey(automationId: string, entityId: string | null): string {
  return `${automationId}:${entityId ?? "none"}`;
}

export function acquireLock(automationId: string, entityId: string | null): boolean {
  const key = lockKey(automationId, entityId);
  if (activeLocks.has(key)) return false;
  activeLocks.add(key);
  return true;
}

export function releaseLock(automationId: string, entityId: string | null): void {
  activeLocks.delete(lockKey(automationId, entityId));
}

export function activeLockCount(): number {
  return activeLocks.size;
}

/**
 * IDEMPOTENCY: voorkomt dubbele runs (en dus dubbele projecten, demo's,
 * prijsberekeningen, websiteversies, outreach-concepten, QC-runs) voor
 * hetzelfde automation + entity zolang een run actief is. Een afgeronde
 * run blokkeert een nieuwe bewust NIET — een expliciete nieuwe "run now"
 * is een menselijke actie. Herhaalde events tijdens een actieve run
 * worden overgeslagen.
 */
export async function assertNoActiveDuplicate(automationId: string, entityId: string | null): Promise<void> {
  const existing = await getAutomationRunRepository().findExisting(automationId, entityId, ["running", "queued", "paused"]);
  if (existing) {
    throw new AutomationGuardError(
      `Er draait al een actieve run (${existing.id}) voor deze automation + entity — dubbele executie overgeslagen (idempotency).`,
      "skipped"
    );
  }
}

/** Rate limit: max runs per uur / dag (op basis van run-historie). */
export async function assertRateLimits(automationId: string, limits: AutomationLimits): Promise<void> {
  const repo = getAutomationRunRepository();
  const runs = await repo.listByAutomation(automationId, 500);
  const now = Date.now();
  const lastHour = runs.filter((r) => now - new Date(r.createdAt).getTime() < 60 * 60 * 1000);
  if (lastHour.length >= limits.maxRunsPerHour) {
    throw new AutomationGuardError(`Rate-limiet bereikt: max ${limits.maxRunsPerHour} runs per uur.`);
  }
  const lastDay = runs.filter((r) => now - new Date(r.createdAt).getTime() < 24 * 60 * 60 * 1000);
  if (lastDay.length >= limits.maxRunsPerDay) {
    throw new AutomationGuardError(`Rate-limiet bereikt: max ${limits.maxRunsPerDay} runs per dag.`);
  }
  const activeRuns = await repo.listActive();
  if (activeRuns.length >= limits.maxConcurrentRuns) {
    throw new AutomationGuardError(
      `Concurrency-limiet bereikt: max ${limits.maxConcurrentRuns} gelijktijdige runs.`
    );
  }
}

/** LOOP PROTECTION: steps, cycles en runtime per run. */
export class LoopGuard {
  private visitedSteps: string[] = [];
  private executedSteps = 0;
  private readonly startedAt = Date.now();

  constructor(private readonly limits: AutomationLimits = getAutomationLimits()) {}

  /** Registreer een step; gooit bij cycle, max-steps of max-runtime. */
  beforeStep(stepId: string): void {
    if (this.visitedSteps.includes(stepId)) {
      throw new AutomationGuardError(
        `Cycle gedetecteerd: step "${stepId}" is in deze run al uitgevoerd — automation geblokkeerd (loop protection).`
      );
    }
    this.visitedSteps.push(stepId);
    this.executedSteps += 1;
    if (this.executedSteps > this.limits.maxStepsPerRun) {
      throw new AutomationGuardError(
        `Max ${this.limits.maxStepsPerRun} steps per run bereikt — automation geblokkeerd (loop protection).`
      );
    }
    if (Date.now() - this.startedAt > this.limits.maxRuntimeMsPerRun) {
      throw new AutomationGuardError(
        `Maximale runtime (${Math.round(this.limits.maxRuntimeMsPerRun / 1000)}s) bereikt — automation geblokkeerd.`
      );
    }
  }

  get executedCount(): number {
    return this.executedSteps;
  }
}

/** COST GUARD: technische limiet op geschatte AI-kosten per run. */
export class CostGuard {
  private accumulatedCost = 0;
  private aiCalls = 0;

  constructor(private readonly limits: AutomationLimits = getAutomationLimits()) {}

  register(aiCalls: number, estimatedCostUsd: number): void {
    this.aiCalls += aiCalls;
    this.accumulatedCost += estimatedCostUsd;
  }

  /** Vóór elke step met AI-werk: check both AI-call- en cost-limiet. */
  assertCanContinue(): void {
    if (this.aiCalls >= this.limits.maxAiCallsPerRun) {
      throw new AutomationGuardError(
        `AI-call-limiet bereikt (${this.limits.maxAiCallsPerRun} per run) — verdere AI-steps geblokkeerd (cost guard).`
      );
    }
    if (this.accumulatedCost >= this.limits.maxCostUsdPerRun) {
      throw new AutomationGuardError(
        `Technische cost-limiet bereikt ($${this.limits.maxCostUsdPerRun.toFixed(2)} per run) — verdere AI-steps geblokkeerd (cost guard).`
      );
    }
  }

  get totals(): { aiCalls: number; estimatedCostUsd: number } {
    return { aiCalls: this.aiCalls, estimatedCostUsd: this.accumulatedCost };
  }
}

/**
 * RETRY-POLICY (Fase 11, spec §8): alléén tijdelijke fouten mogen worden
 * gereset. Safety/validation/opt-out/blockedfouten NOOIT automatisch.
 */
const TRANSIENT_PATTERNS = [
  /timeout/i,
  /temporarily|temporary/i,
  /rate.?limit/i,
  /network/i,
  /connection/i,
  /ECONN/i,
  /5\d\d/i, // provider 5xx
  /overloaded/i,
  /concurrency|gelijktijdig/i, // technische limiet: later opnieuw (gebonden)
];

export function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const nonRetryable =
    /invalid|validation|safety|opt.?out|blocked|guard|permission|denied|unauthorized|requirements|configuration_missing|human/i.test(
      message
    );
  if (nonRetryable) return false;
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(message));
}

/** Berekent de retry-backoff (exponentieel, in ms). */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
}

export type { AutomationRun };
