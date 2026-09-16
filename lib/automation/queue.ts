import { getAutomationQueueRepository } from "./repositories";
import type { AutomationQueueItem } from "./types";

/**
 * AutomationQueue (Fase 11, spec §21) — eenvoudige queue-abstraction.
 * Memory-implementatie volstaat in deze fase; de architectuur staat toe
 * dat later een database-queue (Supabase SKIP LOCKED) of externe worker
 * wordt aangesloten zonder de callers te veranderen. Geen Redis,
 * geen oneindige queue: attempts zijn begrensd door de retry-limieten.
 */

export class AutomationQueue {
  async enqueue(input: {
    automationId: string;
    entityId: string | null;
    entityType: AutomationQueueItem["entityType"];
    triggerEvent: AutomationQueueItem["triggerEvent"];
  }): Promise<AutomationQueueItem> {
    const repo = getAutomationQueueRepository();
    // Dubbele queue-items voor dezelfde automation + entity voorkomen:
    const existing = (await repo.list(200)).find(
      (item) => item.status === "queued" && item.automationId === input.automationId && item.entityId === input.entityId
    );
    if (existing) return existing;
    return repo.enqueue({ ...input, status: "queued", attempts: 0, processedAt: null, error: null });
  }

  async dequeue(): Promise<AutomationQueueItem | null> {
    return getAutomationQueueRepository().next();
  }

  async markProcessing(item: AutomationQueueItem): Promise<AutomationQueueItem | null> {
    return getAutomationQueueRepository().update(item.id, { status: "processing" });
  }

  async complete(item: AutomationQueueItem): Promise<AutomationQueueItem | null> {
    return getAutomationQueueRepository().update(item.id, {
      status: "completed",
      processedAt: new Date().toISOString(),
      error: null,
    });
  }

  /** Geplande herkansing na een tijdelijke fout (attempt + 1). */
  async retry(item: AutomationQueueItem, error: string, maxAttempts: number): Promise<AutomationQueueItem | null> {
    const attempts = item.attempts + 1;
    const repo = getAutomationQueueRepository();
    if (attempts >= maxAttempts) {
      return repo.update(item.id, {
        status: "failed",
        attempts,
        processedAt: new Date().toISOString(),
        error,
      });
    }
    return repo.update(item.id, { status: "queued", attempts, error });
  }

  async fail(item: AutomationQueueItem, error: string): Promise<AutomationQueueItem | null> {
    return getAutomationQueueRepository().update(item.id, {
      status: "failed",
      processedAt: new Date().toISOString(),
      error,
    });
  }

  async list(limit = 50): Promise<AutomationQueueItem[]> {
    return getAutomationQueueRepository().list(limit);
  }
}
