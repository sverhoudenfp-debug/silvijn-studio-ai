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

/**
 * CENTRALE capability-regel: modellen die het `temperature`-parameter NIET
 * ondersteunen (Anthropic wijst de hele request af met HTTP 400 als het
 * toch wordt meegestuurd). claude-sonnet-5 is diagnostisch bevestigd
 * (invalid_request_error: "temperature is deprecated for this model");
 * claude-opus-5 hoort bij dezelfde generatie. Nieuwe modellen hier toevoegen.
 */
const TEMPERATURE_UNSUPPORTED_PREFIXES = ["claude-sonnet-5", "claude-opus-5"];

/** True als het model `temperature` accepteert in messages.create. */
export function modelSupportsTemperature(model: string): boolean {
  return !TEMPERATURE_UNSUPPORTED_PREFIXES.some((prefix) => model.startsWith(prefix));
}

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

/**
 * HARDE absolute bovengrens: geen enkele flow (ook geen expliciete owner-
 * commando's) kan per service-instantie meer AI-verzoeken afvuren dan dit.
 * Beschermt tegen runaway-loops en onbedoelde kosten, onafhankelijk van
 * omgevingsvariabelen of meegegeven overrides.
 */
export const MAX_AI_REQUESTS_PER_RUN_CAP = 25;

export function getAIConfig(): AIConfig {
  const modeEnv = process.env.AI_MODE?.trim().toLowerCase();
  // FAIL LOUD (Fase 12 §B): in productie mag een ontbrekende AI_MODE NIET stilletjs
  // naar mock terugvallen — live AI is de expliciete productiebedoeling.
  // Expliciete keuzes: "live" (vereist key) of "mock" (bewuste dev/test-mode).
  // Mock fallback blijft bewust beschikbaar voor development; zie docs/production.md.
  // Fail-loud alléén in de draaiende productie-omgeving — niet tijdens `next build`
  // (die draait ook met NODE_ENV=production maar zet geen runtime-env).
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
  if (process.env.NODE_ENV === "production" && !modeEnv && !isBuildPhase) {
    throw new AIConfigurationError(
      "AI_MODE ontbreekt in de productie-omgeving — stel AI_MODE=live (of expliciet mock) in via de deployment-omgeving."
    );
  }
  if (modeEnv && modeEnv !== "live" && modeEnv !== "mock") throw new AIConfigurationError("AI_MODE must be live or mock");
  const mode: AIMode = modeEnv === "live" ? "live" : "mock";
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || null;
  const maxRequests = Number.parseInt(process.env.AI_MAX_REQUESTS_PER_RUN ?? "", 10);
  // Request-timeout per AI-aanroep. Live designplanning is gemeten op 84,4s
  // (claude-sonnet-5, 12000 maxTokens, Velora Interieur v3, 2026-09-19); de
  // oude 60s-default sneed dergelijke volledige planningcalls af. Zware
  // planningcalls met rijke input (thinking + groot JSON) horen ruim binnen
  // de default te passen zonder env-configuratie. Configureerbaar via
  // AI_REQUEST_TIMEOUT_MS (1s-300s).
  const timeoutEnv = Number.parseInt(process.env.AI_REQUEST_TIMEOUT_MS ?? "", 10);

  return {
    mode,
    apiKey,
    models: {
      fast: readModel("fast", "claude-haiku-4-5"),
      balanced: readModel("balanced", "claude-sonnet-5"),
      powerful: readModel("powerful", "claude-opus-5"),
    },
    maxRequestsPerRun: Number.isFinite(maxRequests) && maxRequests > 0 ? Math.min(maxRequests, MAX_AI_REQUESTS_PER_RUN_CAP) : 5,
    requestTimeoutMs:
      Number.isFinite(timeoutEnv) && timeoutEnv >= 1_000 && timeoutEnv <= 300_000
        ? timeoutEnv
        : 120_000,
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
