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

export interface AIRunRepository {
  readonly sink: "supabase" | "memory";
  log(run: AIRunInput): Promise<void>;
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
}

export class SupabaseAIRunRepository implements AIRunRepository {
  readonly sink = "supabase" as const;

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
