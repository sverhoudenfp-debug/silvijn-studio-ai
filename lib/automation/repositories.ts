import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type {
  Automation,
  AutomationEvent,
  AutomationEventType,
  AutomationQueueItem,
  AutomationRun,
} from "./types";

/**
 * Automation-repositories (Fase 11) — zelfde patroon als Fase 4-10:
 * memory-implementatie (mock) + Supabase (migratie 0008, RLS aan,
 * geen publiek beleid — server-side only via server actions).
 */

// ---------------------------------------------------------------------------
// AutomationRepository
// ---------------------------------------------------------------------------

export interface AutomationRepository {
  readonly source: "mock" | "supabase";
  create(automation: Omit<Automation, "createdAt" | "updatedAt">): Promise<Automation>;
  /** Atomaire insert die niets doet als de rij al bestaat — race-vrij. */
  upsertIfAbsent(automation: Omit<Automation, "createdAt" | "updatedAt">): Promise<void>;
  getById(id: string): Promise<Automation | null>;
  list(): Promise<Automation[]>;
  listByTrigger(trigger: AutomationEventType | "manual"): Promise<Automation[]>;
  update(id: string, update: Partial<Automation>): Promise<Automation | null>;
}

class MemoryAutomationRepository implements AutomationRepository {
  readonly source = "mock" as const;
  private records: Automation[] = [];

  private now(): string {
    return new Date().toISOString();
  }

  async upsertIfAbsent(automation: Omit<Automation, "createdAt" | "updatedAt">): Promise<void> {
    if (this.records.some((r) => r.id === automation.id)) return;
    this.create(automation);
  }
  async create(automation: Omit<Automation, "createdAt" | "updatedAt">): Promise<Automation> {
    const now = this.now();
    this.records.push({ ...automation, createdAt: now, updatedAt: now });
    return this.records[this.records.length - 1];
  }
  async getById(id: string): Promise<Automation | null> {
    return this.records.find((r) => r.id === id) ?? null;
  }
  async list(): Promise<Automation[]> {
    return [...this.records].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async listByTrigger(trigger: AutomationEventType | "manual"): Promise<Automation[]> {
    return this.records.filter((r) => r.trigger === trigger);
  }
  async update(id: string, update: Partial<Automation>): Promise<Automation | null> {
    const record = this.records.find((r) => r.id === id);
    if (!record) return null;
    Object.assign(record, update, { updatedAt: this.now() });
    return record;
  }
}

interface AutomationRow {
  id: string;
  name: string;
  description: string;
  type: Automation["type"];
  status: Automation["status"];
  enabled: boolean;
  trigger: AutomationEventType | "manual";
  steps: Automation["steps"];
  current_step: string | null;
  execution_count: number;
  success_count: number;
  failure_count: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    status: row.status,
    enabled: row.enabled,
    trigger: row.trigger,
    steps: row.steps ?? [],
    currentStep: row.current_step,
    executionCount: row.execution_count,
    successCount: row.success_count,
    failureCount: row.failure_count,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SupabaseAutomationRepository implements AutomationRepository {
  readonly source = "supabase" as const;

  /**
   * Atomaire INSERT ... ON CONFLICT (id) DO NOTHING — veilig bij gelijktijdige
   * renders (Next.js build workers) én idempotent: bestaande rijen blijven ongewijzigd.
   */
  async upsertIfAbsent(automation: Omit<Automation, "createdAt" | "updatedAt">): Promise<void> {
    const { error } = await getSupabaseServerClient()
      .from("automations")
      .upsert(
        {
          id: automation.id,
          name: automation.name,
          description: automation.description,
          type: automation.type,
          status: automation.status,
          enabled: automation.enabled,
          trigger: automation.trigger,
          steps: automation.steps,
          current_step: automation.currentStep,
          execution_count: automation.executionCount,
          success_count: automation.successCount,
          failure_count: automation.failureCount,
          last_run_at: automation.lastRunAt,
          next_run_at: automation.nextRunAt,
        },
        { onConflict: "id", ignoreDuplicates: true }
      );
    if (error) throw new Error(`AutomationRepository: upsert mislukt: ${error.message}`);
  }

  async create(automation: Omit<Automation, "createdAt" | "updatedAt">): Promise<Automation> {
    const { data, error } = await getSupabaseServerClient()
      .from("automations")
      .insert({
        id: automation.id,
        name: automation.name,
        description: automation.description,
        type: automation.type,
        status: automation.status,
        enabled: automation.enabled,
        trigger: automation.trigger,
        steps: automation.steps,
        current_step: automation.currentStep,
        execution_count: automation.executionCount,
        success_count: automation.successCount,
        failure_count: automation.failureCount,
        last_run_at: automation.lastRunAt,
        next_run_at: automation.nextRunAt,
      })
      .select("*")
      .single();
    if (error) throw new Error(`AutomationRepository: aanmaken mislukt: ${error.message}`);
    return rowToAutomation(data as AutomationRow);
  }
  async getById(id: string): Promise<Automation | null> {
    const { data, error } = await getSupabaseServerClient().from("automations").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`AutomationRepository: ophalen mislukt: ${error.message}`);
    return data ? rowToAutomation(data as AutomationRow) : null;
  }
  async list(): Promise<Automation[]> {
    const { data, error } = await getSupabaseServerClient().from("automations").select("*").order("created_at");
    if (error) throw new Error(`AutomationRepository: ophalen mislukt: ${error.message}`);
    return (data as AutomationRow[]).map(rowToAutomation);
  }
  async listByTrigger(trigger: AutomationEventType | "manual"): Promise<Automation[]> {
    const { data, error } = await getSupabaseServerClient().from("automations").select("*").eq("trigger", trigger);
    if (error) throw new Error(`AutomationRepository: ophalen mislukt: ${error.message}`);
    return (data as AutomationRow[]).map(rowToAutomation);
  }
  async update(id: string, update: Partial<Automation>): Promise<Automation | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("automations")
      .update({
        ...(update.status !== undefined ? { status: update.status } : {}),
        ...(update.enabled !== undefined ? { enabled: update.enabled } : {}),
        ...(update.currentStep !== undefined ? { current_step: update.currentStep } : {}),
        ...(update.steps !== undefined ? { steps: update.steps } : {}),
        ...(update.executionCount !== undefined ? { execution_count: update.executionCount } : {}),
        ...(update.successCount !== undefined ? { success_count: update.successCount } : {}),
        ...(update.failureCount !== undefined ? { failure_count: update.failureCount } : {}),
        ...(update.lastRunAt !== undefined ? { last_run_at: update.lastRunAt } : {}),
        ...(update.nextRunAt !== undefined ? { next_run_at: update.nextRunAt } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`AutomationRepository: bijwerken mislukt: ${error.message}`);
    return data ? rowToAutomation(data as AutomationRow) : null;
  }
}

// ---------------------------------------------------------------------------
// AutomationRunRepository
// ---------------------------------------------------------------------------

export interface AutomationRunRepository {
  readonly source: "mock" | "supabase";
  create(run: Omit<AutomationRun, "createdAt" | "updatedAt">): Promise<AutomationRun>;
  getById(id: string): Promise<AutomationRun | null>;
  list(limit?: number): Promise<AutomationRun[]>;
  listByAutomation(automationId: string, limit?: number): Promise<AutomationRun[]>;
  listActive(): Promise<AutomationRun[]>;
  /** Idempotency-check: bestaat er al een actieve/afgerunde run voor automation+entity+step? */
  findExisting(automationId: string, entityId: string | null, statuses: AutomationRun["status"][]): Promise<AutomationRun | null>;
  update(id: string, update: Partial<AutomationRun>): Promise<AutomationRun | null>;
}

class MemoryAutomationRunRepository implements AutomationRunRepository {
  readonly source = "mock" as const;
  private records: AutomationRun[] = [];

  private now(): string {
    return new Date().toISOString();
  }
  async create(run: Omit<AutomationRun, "createdAt" | "updatedAt">): Promise<AutomationRun> {
    const now = this.now();
    this.records.push({ ...run, createdAt: now, updatedAt: now });
    return this.records[this.records.length - 1];
  }
  async getById(id: string): Promise<AutomationRun | null> {
    return this.records.find((r) => r.id === id) ?? null;
  }
  async list(limit = 50): Promise<AutomationRun[]> {
    return [...this.records].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  async listByAutomation(automationId: string, limit = 20): Promise<AutomationRun[]> {
    return this.records
      .filter((r) => r.automationId === automationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  async listActive(): Promise<AutomationRun[]> {
    return this.records.filter((r) => r.status === "running" || r.status === "queued" || r.status === "paused");
  }
  async findExisting(automationId: string, entityId: string | null, statuses: AutomationRun["status"][]): Promise<AutomationRun | null> {
    return (
      this.records.find(
        (r) => r.automationId === automationId && r.entityId === entityId && statuses.includes(r.status)
      ) ?? null
    );
  }
  async update(id: string, update: Partial<AutomationRun>): Promise<AutomationRun | null> {
    const record = this.records.find((r) => r.id === id);
    if (!record) return null;
    Object.assign(record, update, { updatedAt: this.now() });
    return record;
  }
}

interface AutomationRunRow {
  id: string;
  automation_id: string;
  status: AutomationRun["status"];
  entity_type: AutomationRun["entityType"];
  entity_id: string | null;
  current_step: string | null;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  retry_count: number;
  waiting_reason: string | null;
  steps: AutomationRun["steps"];
  metadata: AutomationRun["metadata"];
  warnings: AutomationRun["warnings"];
  ai_calls: number;
  estimated_cost_usd: number;
  created_at: string;
  updated_at: string;
}

function rowToRun(row: AutomationRunRow): AutomationRun {
  return {
    id: row.id,
    automationId: row.automation_id,
    status: row.status,
    entityType: row.entity_type,
    entityId: row.entity_id,
    currentStep: row.current_step,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
    retryCount: row.retry_count,
    waitingReason: row.waiting_reason,
    steps: row.steps ?? [],
    metadata: row.metadata ?? {},
    warnings: row.warnings ?? [],
    aiCalls: row.ai_calls ?? 0,
    estimatedCostUsd: row.estimated_cost_usd ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const RUN_UPDATE_MAPPING: Array<[keyof Partial<AutomationRun>, string]> = [
  ["status", "status"],
  ["currentStep", "current_step"],
  ["startedAt", "started_at"],
  ["completedAt", "completed_at"],
  ["error", "error"],
  ["retryCount", "retry_count"],
  ["waitingReason", "waiting_reason"],
  ["steps", "steps"],
  ["metadata", "metadata"],
  ["warnings", "warnings"],
  ["aiCalls", "ai_calls"],
  ["estimatedCostUsd", "estimated_cost_usd"],
];

class SupabaseAutomationRunRepository implements AutomationRunRepository {
  readonly source = "supabase" as const;

  async create(run: Omit<AutomationRun, "createdAt" | "updatedAt">): Promise<AutomationRun> {
    const { data, error } = await getSupabaseServerClient()
      .from("automation_runs")
      .insert({
        id: run.id,
        automation_id: run.automationId,
        status: run.status,
        entity_type: run.entityType,
        entity_id: run.entityId,
        current_step: run.currentStep,
        started_at: run.startedAt,
        completed_at: run.completedAt,
        error: run.error,
        retry_count: run.retryCount,
        waiting_reason: run.waitingReason,
        steps: run.steps,
        metadata: run.metadata,
        warnings: run.warnings,
        ai_calls: run.aiCalls,
        estimated_cost_usd: run.estimatedCostUsd,
      })
      .select("*")
      .single();
    if (error) throw new Error(`AutomationRunRepository: aanmaken mislukt: ${error.message}`);
    return rowToRun(data as AutomationRunRow);
  }
  async getById(id: string): Promise<AutomationRun | null> {
    const { data, error } = await getSupabaseServerClient().from("automation_runs").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`AutomationRunRepository: ophalen mislukt: ${error.message}`);
    return data ? rowToRun(data as AutomationRunRow) : null;
  }
  async list(limit = 50): Promise<AutomationRun[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("automation_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`AutomationRunRepository: ophalen mislukt: ${error.message}`);
    return (data as AutomationRunRow[]).map(rowToRun);
  }
  async listByAutomation(automationId: string, limit = 20): Promise<AutomationRun[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("automation_runs")
      .select("*")
      .eq("automation_id", automationId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`AutomationRunRepository: ophalen mislukt: ${error.message}`);
    return (data as AutomationRunRow[]).map(rowToRun);
  }
  async listActive(): Promise<AutomationRun[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("automation_runs")
      .select("*")
      .in("status", ["running", "queued", "paused"]);
    if (error) throw new Error(`AutomationRunRepository: ophalen mislukt: ${error.message}`);
    return (data as AutomationRunRow[]).map(rowToRun);
  }
  async findExisting(
    automationId: string,
    entityId: string | null,
    statuses: AutomationRun["status"][]
  ): Promise<AutomationRun | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("automation_runs")
      .select("*")
      .eq("automation_id", automationId)
      .eq("entity_id", entityId)
      .in("status", statuses)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`AutomationRunRepository: idempotency-check mislukt: ${error.message}`);
    return data ? rowToRun(data as AutomationRunRow) : null;
  }
  async update(id: string, update: Partial<AutomationRun>): Promise<AutomationRun | null> {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [key, column] of RUN_UPDATE_MAPPING) {
      if (update[key] !== undefined) patch[column] = update[key];
    }
    const { data, error } = await getSupabaseServerClient()
      .from("automation_runs")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`AutomationRunRepository: bijwerken mislukt: ${error.message}`);
    return data ? rowToRun(data as AutomationRunRow) : null;
  }
}

// ---------------------------------------------------------------------------
// AutomationEventRepository
// ---------------------------------------------------------------------------

export interface AutomationEventRepository {
  readonly source: "mock" | "supabase";
  record(event: Omit<AutomationEvent, "id" | "timestamp">): Promise<AutomationEvent>;
  list(limit?: number): Promise<AutomationEvent[]>;
  listByEntity(entityType: AutomationEvent["entityType"], entityId: string, limit?: number): Promise<AutomationEvent[]>;
}

class MemoryAutomationEventRepository implements AutomationEventRepository {
  readonly source = "mock" as const;
  private records: AutomationEvent[] = [];

  async record(event: Omit<AutomationEvent, "id" | "timestamp">): Promise<AutomationEvent> {
    const stored: AutomationEvent = {
      ...event,
      id: `evt-${(this.records.length + 1).toString().padStart(5, "0")}`,
      timestamp: new Date().toISOString(),
    };
    this.records.push(stored);
    return stored;
  }
  async list(limit = 50): Promise<AutomationEvent[]> {
    return [...this.records].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
  }
  async listByEntity(entityType: AutomationEvent["entityType"], entityId: string, limit = 50): Promise<AutomationEvent[]> {
    return this.records
      .filter((r) => r.entityType === entityType && r.entityId === entityId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }
}

interface AutomationEventRow {
  id: string;
  type: AutomationEventType;
  entity_type: AutomationEvent["entityType"];
  entity_id: string | null;
  timestamp: string;
  payload: AutomationEvent["payload"];
  source: string;
}

function rowToEvent(row: AutomationEventRow): AutomationEvent {
  return {
    id: row.id,
    type: row.type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    timestamp: row.timestamp,
    payload: row.payload ?? {},
    source: row.source,
  };
}

class SupabaseAutomationEventRepository implements AutomationEventRepository {
  readonly source = "supabase" as const;

  async record(event: Omit<AutomationEvent, "id" | "timestamp">): Promise<AutomationEvent> {
    const { data, error } = await getSupabaseServerClient()
      .from("automation_events")
      .insert({
        type: event.type,
        entity_type: event.entityType,
        entity_id: event.entityId,
        payload: event.payload,
        source: event.source,
      })
      .select("*")
      .single();
    if (error) throw new Error(`AutomationEventRepository: opslaan mislukt: ${error.message}`);
    return rowToEvent(data as AutomationEventRow);
  }
  async list(limit = 50): Promise<AutomationEvent[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("automation_events")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`AutomationEventRepository: ophalen mislukt: ${error.message}`);
    return (data as AutomationEventRow[]).map(rowToEvent);
  }
  async listByEntity(entityType: AutomationEvent["entityType"], entityId: string, limit = 50): Promise<AutomationEvent[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("automation_events")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("timestamp", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`AutomationEventRepository: ophalen mislukt: ${error.message}`);
    return (data as AutomationEventRow[]).map(rowToEvent);
  }
}

// ---------------------------------------------------------------------------
// AutomationQueueRepository
// ---------------------------------------------------------------------------

export interface AutomationQueueRepository {
  readonly source: "mock" | "supabase";
  enqueue(item: Omit<AutomationQueueItem, "id" | "enqueuedAt">): Promise<AutomationQueueItem>;
  next(): Promise<AutomationQueueItem | null>;
  get(id: string): Promise<AutomationQueueItem | null>;
  list(limit?: number): Promise<AutomationQueueItem[]>;
  update(id: string, update: Partial<AutomationQueueItem>): Promise<AutomationQueueItem | null>;
}

class MemoryAutomationQueueRepository implements AutomationQueueRepository {
  readonly source = "mock" as const;
  private records: AutomationQueueItem[] = [];

  async enqueue(item: Omit<AutomationQueueItem, "id" | "enqueuedAt">): Promise<AutomationQueueItem> {
    const stored: AutomationQueueItem = {
      ...item,
      id: `q-${(this.records.length + 1).toString().padStart(5, "0")}`,
      enqueuedAt: new Date().toISOString(),
    };
    this.records.push(stored);
    return stored;
  }
  async next(): Promise<AutomationQueueItem | null> {
    return this.records.find((r) => r.status === "queued") ?? null;
  }
  async get(id: string): Promise<AutomationQueueItem | null> {
    return this.records.find((r) => r.id === id) ?? null;
  }
  async list(limit = 50): Promise<AutomationQueueItem[]> {
    return [...this.records].sort((a, b) => b.enqueuedAt.localeCompare(a.enqueuedAt)).slice(0, limit);
  }
  async update(id: string, update: Partial<AutomationQueueItem>): Promise<AutomationQueueItem | null> {
    const record = this.records.find((r) => r.id === id);
    if (!record) return null;
    Object.assign(record, update);
    return record;
  }
}

interface AutomationQueueRow {
  id: string;
  automation_id: string;
  entity_type: AutomationQueueItem["entityType"];
  entity_id: string | null;
  trigger_event: AutomationQueueItem["triggerEvent"];
  status: AutomationQueueItem["status"];
  attempts: number;
  enqueued_at: string;
  processed_at: string | null;
  error: string | null;
}

function rowToQueueItem(row: AutomationQueueRow): AutomationQueueItem {
  return {
    id: row.id,
    automationId: row.automation_id,
    entityId: row.entity_id,
    entityType: row.entity_type,
    triggerEvent: row.trigger_event,
    status: row.status,
    attempts: row.attempts,
    enqueuedAt: row.enqueued_at,
    processedAt: row.processed_at,
    error: row.error,
  };
}

class SupabaseAutomationQueueRepository implements AutomationQueueRepository {
  readonly source = "supabase" as const;

  async enqueue(item: Omit<AutomationQueueItem, "id" | "enqueuedAt">): Promise<AutomationQueueItem> {
    const { data, error } = await getSupabaseServerClient()
      .from("automation_queue")
      .insert({
        automation_id: item.automationId,
        entity_type: item.entityType,
        entity_id: item.entityId,
        trigger_event: item.triggerEvent,
        status: item.status,
        attempts: item.attempts,
      })
      .select("*")
      .single();
    if (error) throw new Error(`AutomationQueueRepository: enqueue mislukt: ${error.message}`);
    return rowToQueueItem(data as AutomationQueueRow);
  }
  async next(): Promise<AutomationQueueItem | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("automation_queue")
      .select("*")
      .eq("status", "queued")
      .order("enqueued_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`AutomationQueueRepository: dequeue mislukt: ${error.message}`);
    return data ? rowToQueueItem(data as AutomationQueueRow) : null;
  }
  async get(id: string): Promise<AutomationQueueItem | null> {
    const { data, error } = await getSupabaseServerClient().from("automation_queue").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`AutomationQueueRepository: ophalen mislukt: ${error.message}`);
    return data ? rowToQueueItem(data as AutomationQueueRow) : null;
  }
  async list(limit = 50): Promise<AutomationQueueItem[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("automation_queue")
      .select("*")
      .order("enqueued_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`AutomationQueueRepository: ophalen mislukt: ${error.message}`);
    return (data as AutomationQueueRow[]).map(rowToQueueItem);
  }
  async update(id: string, update: Partial<AutomationQueueItem>): Promise<AutomationQueueItem | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("automation_queue")
      .update({
        ...(update.status !== undefined ? { status: update.status } : {}),
        ...(update.attempts !== undefined ? { attempts: update.attempts } : {}),
        ...(update.processedAt !== undefined ? { processed_at: update.processedAt } : {}),
        ...(update.error !== undefined ? { error: update.error } : {}),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`AutomationQueueRepository: bijwerken mislukt: ${error.message}`);
    return data ? rowToQueueItem(data as AutomationQueueRow) : null;
  }
}

// ---------------------------------------------------------------------------
// Singletons (memory) / Supabase-factories
// ---------------------------------------------------------------------------

let memoryAutomationRepo: MemoryAutomationRepository | null = null;
let memoryRunRepo: MemoryAutomationRunRepository | null = null;
let memoryEventRepo: MemoryAutomationEventRepository | null = null;
let memoryQueueRepo: MemoryAutomationQueueRepository | null = null;

export function getAutomationRepository(): AutomationRepository {
  if (isSupabaseConfigured()) return new SupabaseAutomationRepository();
  memoryAutomationRepo ??= new MemoryAutomationRepository();
  return memoryAutomationRepo;
}

export function getAutomationRunRepository(): AutomationRunRepository {
  if (isSupabaseConfigured()) return new SupabaseAutomationRunRepository();
  memoryRunRepo ??= new MemoryAutomationRunRepository();
  return memoryRunRepo;
}

export function getAutomationEventRepository(): AutomationEventRepository {
  if (isSupabaseConfigured()) return new SupabaseAutomationEventRepository();
  memoryEventRepo ??= new MemoryAutomationEventRepository();
  return memoryEventRepo;
}

export function getAutomationQueueRepository(): AutomationQueueRepository {
  if (isSupabaseConfigured()) return new SupabaseAutomationQueueRepository();
  memoryQueueRepo ??= new MemoryAutomationQueueRepository();
  return memoryQueueRepo;
}
