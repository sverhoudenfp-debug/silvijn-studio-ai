import { AIConfigurationError } from "./errors";
import type { AIModelTier, AIMode } from "./types";

/**
 * ÉÉN centrale AI-configuratie. Modelnamen staan hier uitsluitend als default
 * en zijn per environment variable te overschrijven. NIET elders hardcoden.
 *
 * Actuele Claude-modellen (controleer bij een upgrade):
 *   fast      → claude-haiku-4-5  (snelste, goedkoop/high-volume)
 *   balanced  → claude-sonnet-5  (beste snelheid/intelligentie-balans, standaard productie)
 *   powerful → claude-opus-5     (krachtigste algemene model, zware taken)
 */

export interface AIConfig {
  mode: AIMode;
  apiKey: string | null;
  models: Record<AIModelTier, string>;
  maxRequestsPerRun: number;
  requestTimeoutMs: number;
  maxRetries: number;
}

function readModel(tier: AIModelTier, fallback: string): string {
  return process.env[`AI_MODEL_${tier.toUpperCase()}`]?.trim() || fallback;
}

export function getAIConfig(): AIConfig {
  const modeEnv = process.env.AI_MODE?.trim().toLowerCase();
  const mode: AIMode = modeEnv === "live" ? "live" : "mock";
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || null;
  const maxRequests = Number.parseInt(process.env.AI_MAX_REQUESTS_PER_RUN ?? "", 10);

  return {
    mode,
    apiKey,
    models: {
      fast: readModel("fast", "claude-haiku-4-5"),
      balanced: readModel("balanced", "claude-sonnet-5"),
      powerful: readModel("powerful", "claude-opus-5"),
    },
    maxRequestsPerRun: Number.isFinite(maxRequests) && maxRequests > 0 ? maxRequests : 5,
    requestTimeoutMs: 30_000,
    maxRetries: 2,
  };
}

/** Gekozen model voor een tier — validatie van de tier zelf. */
export function getModelForTier(tier: AIModelTier): string {
  return getAIConfig().models[tier];
}

/** Live mode vereist een API-key; anders falen we controleerd vóór er kosten kunnen ontstaan. */
export function requireLiveAPIKey(): string {
  const config = getAIConfig();
  if (!config.apiKey) {
    throw new AIConfigurationError("Live AI-mode vereist ANTHROPIC_API_KEY — deze ontbreekt.");
  }
  return config.apiKey;
}
