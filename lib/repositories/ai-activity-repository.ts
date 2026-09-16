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

export interface AIActivityRepository {
  readonly sink: "supabase" | "memory";
  log(activity: AIActivityInput): Promise<void>;
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
}

export class SupabaseAIActivityRepository implements AIActivityRepository {
  readonly sink = "supabase" as const;

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
