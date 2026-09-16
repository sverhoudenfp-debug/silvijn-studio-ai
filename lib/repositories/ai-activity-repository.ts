import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * AIActivityRepository — domein-activiteiten zoals "business analysis gestart".
 * Supabase indien geconfigureerd, anders in-memory + console fallback.
 */

export interface AIActivityInput {
  leadId?: string | null;
  type: string;
  status: "started" | "completed" | "failed" | "blocked";
  message: string;
  metadata?: Record<string, unknown> | null;
}

export interface AIActivityRecord {
  id: string | null;
  leadId: string | null;
  type: string;
  status: "started" | "completed" | "failed" | "blocked";
  message: string;
  createdAt: string | null;
}

export interface AIActivityRepository {
  readonly sink: "supabase" | "memory";
  log(activity: AIActivityInput): Promise<void>;
  /** Fase 12 §O/P/Q: uitlezen voor activity-feed en audit-trail — nieuwste eerst. */
  listRecent(limit?: number): Promise<AIActivityRecord[]>;
}

export class MemoryAIActivityRepository implements AIActivityRepository {
  readonly sink = "memory" as const;
  private readonly activities: AIActivityInput[] = [];

  async log(activity: AIActivityInput): Promise<void> {
    this.activities.push(activity);
    console.info(`[AI activity] type=${activity.type} status=${activity.status} — ${activity.message}`);
  }

  getActivities(): AIActivityInput[] {
    return this.activities;
  }

  async listRecent(limit = 100): Promise<AIActivityRecord[]> {
    return this.activities.slice(-limit).reverse().map((a, i) => ({
      id: `memory-${this.activities.length - i}`,
      leadId: a.leadId ?? null,
      type: a.type,
      status: a.status,
      message: a.message,
      createdAt: null,
    }));
  }
}

export class SupabaseAIActivityRepository implements AIActivityRepository {
  readonly sink = "supabase" as const;

  async listRecent(limit = 100): Promise<AIActivityRecord[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("ai_activities")
      .select("id,lead_id,type,status,message,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string | null,
      leadId: (row.lead_id as string | null) ?? null,
      type: row.type as string,
      status: row.status as "started" | "completed" | "failed" | "blocked",
      message: row.message as string,
      createdAt: (row.created_at as string | null) ?? null,
    }));
  }

  async log(activity: AIActivityInput): Promise<void> {
    const { error } = await getSupabaseServerClient().from("ai_activities").insert({
      lead_id: activity.leadId ?? null,
      type: activity.type,
      status: activity.status,
      message: activity.message,
      metadata: activity.metadata ?? null,
    });
    if (error) {
      console.warn(`[AI activity] opslaan in Supabase mislukt: ${error.message}`);
    }
  }
}

let memoryActivityRepository: MemoryAIActivityRepository | null = null;

export function getAIActivityRepository(): AIActivityRepository {
  if (isSupabaseConfigured()) return new SupabaseAIActivityRepository();
  memoryActivityRepository ??= new MemoryAIActivityRepository();
  return memoryActivityRepository;
}
