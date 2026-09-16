import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * AIRunRepository — logt elke AI-execution (agent, taak, model, tokens, kosten,
 * duur, fouten) voor kostencontrole. Supabase indien geconfigureerd, anders een
 * veilige in-memory + console fallback (development).
 */

export interface AIRunInput {
  agentType: string;
  taskType: string;
  model: string;
  mode: "mock" | "live";
  status: "completed" | "failed";
  leadId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AIRunRecord {
  id: string | null;
  agentType: string;
  taskType: string;
  model: string;
  mode: "mock" | "live";
  status: "completed" | "failed";
  leadId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: string | null;
}

export interface AIRunRepository {
  readonly sink: "supabase" | "memory";
  log(run: AIRunInput): Promise<void>;
  /** Fase 12 §O/P: uitlezen voor analytics — nieuwste eerst. */
  listRecent(limit?: number): Promise<AIRunRecord[]>;
}

export class MemoryAIRunRepository implements AIRunRepository {
  readonly sink = "memory" as const;
  private readonly runs: AIRunInput[] = [];

  async log(run: AIRunInput): Promise<void> {
    this.runs.push(run);
    // Veilig log-formaat: geen prompts, geen keys, alleen metadata.
    console.info(
      `[AI run] agent=${run.agentType} task=${run.taskType} model=${run.model} mode=${run.mode} status=${run.status} tokens=${run.totalTokens ?? 0} cost=${run.estimatedCost ?? 0}ms=${run.durationMs ?? 0}${run.errorMessage ? ` error=${run.errorMessage}` : ""}`
    );
  }

  getRuns(): AIRunInput[] {
    return this.runs;
  }

  async listRecent(limit = 100): Promise<AIRunRecord[]> {
    return this.runs.slice(-limit).reverse().map((run, i) => ({
      id: `memory-${this.runs.length - i}`,
      agentType: run.agentType,
      taskType: run.taskType,
      model: run.model,
      mode: run.mode,
      status: run.status,
      leadId: run.leadId ?? null,
      inputTokens: run.inputTokens ?? null,
      outputTokens: run.outputTokens ?? null,
      totalTokens: run.totalTokens ?? null,
      estimatedCost: run.estimatedCost ?? null,
      durationMs: run.durationMs ?? null,
      errorMessage: run.errorMessage ?? null,
      createdAt: null,
    }));
  }
}

export class SupabaseAIRunRepository implements AIRunRepository {
  readonly sink = "supabase" as const;

  async listRecent(limit = 100): Promise<AIRunRecord[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("ai_runs")
      .select("id,agent_type,task_type,model,mode,status,lead_id,input_tokens,output_tokens,total_tokens,estimated_cost,duration_ms,error_message,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string | null,
      agentType: row.agent_type as string,
      taskType: row.task_type as string,
      model: row.model as string,
      mode: row.mode as "mock" | "live",
      status: row.status as "completed" | "failed",
      leadId: (row.lead_id as string | null) ?? null,
      inputTokens: (row.input_tokens as number | null) ?? null,
      outputTokens: (row.output_tokens as number | null) ?? null,
      totalTokens: (row.total_tokens as number | null) ?? null,
      estimatedCost: (row.estimated_cost as number | null) ?? null,
      durationMs: (row.duration_ms as number | null) ?? null,
      errorMessage: (row.error_message as string | null) ?? null,
      createdAt: (row.created_at as string | null) ?? null,
    }));
  }

  async log(run: AIRunInput): Promise<void> {
    const { error } = await getSupabaseServerClient().from("ai_runs").insert({
      agent_type: run.agentType,
      task_type: run.taskType,
      model: run.model,
      mode: run.mode,
      status: run.status,
      lead_id: run.leadId ?? null,
      input_tokens: run.inputTokens ?? null,
      output_tokens: run.outputTokens ?? null,
      total_tokens: run.totalTokens ?? null,
      estimated_cost: run.estimatedCost ?? null,
      duration_ms: run.durationMs ?? null,
      error_message: run.errorMessage ?? null,
      metadata: run.metadata ?? null,
    });
    if (error) {
      // Logging mag de businessflow nooit breken — val terug op console.
      console.warn(`[AI run] opslaan in Supabase mislukt: ${error.message}`);
    }
  }
}

let memoryRunRepository: MemoryAIRunRepository | null = null;

export function getAIRunRepository(): AIRunRepository {
  if (isSupabaseConfigured()) return new SupabaseAIRunRepository();
  memoryRunRepository ??= new MemoryAIRunRepository();
  return memoryRunRepository;
}
