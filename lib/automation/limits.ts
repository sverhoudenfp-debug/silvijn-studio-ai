/**
 * Centrale automation-limieten (Fase 11, spec §23-24) — technische
 * veiligheidslimieten, GEEN commerciële waarden.
 * Alle defaults zijn conservatief; overrides via environment variables.
 */

export interface AutomationLimits {
  maxRunsPerHour: number;
  maxRunsPerDay: number;
  maxAiCallsPerRun: number;
  maxLeadsPerDiscoveryRun: number;
  maxRetriesPerStep: number;
  maxConcurrentRuns: number;
  /** Technische cost guard per run in USD (geschat, via ai_runs-logging). */
  maxCostUsdPerRun: number;
  /** Loop protection: max steps per run. */
  maxStepsPerRun: number;
  /** Maximum runtime per run in ms. */
  maxRuntimeMsPerRun: number;
}

/** Conservatieve defaults. */
export const DEFAULT_AUTOMATION_LIMITS: AutomationLimits = {
  maxRunsPerHour: 10,
  maxRunsPerDay: 50,
  maxAiCallsPerRun: 10,
  maxLeadsPerDiscoveryRun: 25,
  maxRetriesPerStep: 3,
  maxConcurrentRuns: 2,
  maxCostUsdPerRun: 1,
  maxStepsPerRun: 25,
  maxRuntimeMsPerRun: 10 * 60 * 1000,
};

function readIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAutomationLimits(): AutomationLimits {
  return {
    maxRunsPerHour: readIntEnv("AUTOMATION_MAX_RUNS_PER_HOUR", DEFAULT_AUTOMATION_LIMITS.maxRunsPerHour),
    maxRunsPerDay: readIntEnv("AUTOMATION_MAX_RUNS_PER_DAY", DEFAULT_AUTOMATION_LIMITS.maxRunsPerDay),
    maxAiCallsPerRun: readIntEnv("AUTOMATION_MAX_AI_CALLS_PER_RUN", DEFAULT_AUTOMATION_LIMITS.maxAiCallsPerRun),
    maxLeadsPerDiscoveryRun: readIntEnv("AUTOMATION_MAX_LEADS_PER_DISCOVERY_RUN", DEFAULT_AUTOMATION_LIMITS.maxLeadsPerDiscoveryRun),
    maxRetriesPerStep: readIntEnv("AUTOMATION_MAX_RETRIES_PER_STEP", DEFAULT_AUTOMATION_LIMITS.maxRetriesPerStep),
    maxConcurrentRuns: readIntEnv("AUTOMATION_MAX_CONCURRENT_RUNS", DEFAULT_AUTOMATION_LIMITS.maxConcurrentRuns),
    maxCostUsdPerRun: readIntEnv("AUTOMATION_MAX_COST_USD_PER_RUN", DEFAULT_AUTOMATION_LIMITS.maxCostUsdPerRun),
    maxStepsPerRun: readIntEnv("AUTOMATION_MAX_STEPS_PER_RUN", DEFAULT_AUTOMATION_LIMITS.maxStepsPerRun),
    maxRuntimeMsPerRun: readIntEnv("AUTOMATION_MAX_RUNTIME_MS_PER_RUN", DEFAULT_AUTOMATION_LIMITS.maxRuntimeMsPerRun),
  };
}

/**
 * Autonomy-level — deterministische configuratie. Level 3 (controlled
 * autonomous) is architectuurvoorbereiding en mag NOOIT via AI-output of
 * automation zelf worden geactiveerd; alleen menselijke config wijzigt dit.
 */
export function getAutonomyLevel(): 0 | 1 | 2 | 3 {
  const parsed = Number.parseInt(process.env.AUTOMATION_AUTONOMY_LEVEL ?? "", 10);
  if (parsed === 0 || parsed === 1 || parsed === 2 || parsed === 3) return parsed;
  return 1; // DEFAULT = LEVEL 1 (suggested): genereren/voorbereiden, geen verzending
}
