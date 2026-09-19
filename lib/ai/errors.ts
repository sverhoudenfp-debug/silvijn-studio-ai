/** Foutklassen voor de AI-laag. Nooit API-keys, stack traces of interne details naar gebruikers lekken. */

export class AIError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | "configuration"
      | "auth"
      | "rate_limit"
      | "timeout"
      | "invalid_response"
      | "provider"
      | "safety_limit"
      | "unknown",
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "AIError";
  }
}

export class AIConfigurationError extends AIError {
  constructor(message: string) {
    super(message, "configuration", false);
    this.name = "AIConfigurationError";
  }
}

export class AIAuthError extends AIError {
  constructor(message: string) {
    super(message, "auth", false);
    this.name = "AIAuthError";
  }
}

export class AIRateLimitError extends AIError {
  constructor(message: string) {
    super(message, "rate_limit", true);
    this.name = "AIRateLimitError";
  }
}

export class AITimeoutError extends AIError {
  constructor(message: string) {
    super(message, "timeout", true);
    this.name = "AITimeoutError";
  }
}

export class AIInvalidResponseError extends AIError {
  constructor(message: string) {
    super(message, "invalid_response", true);
    this.name = "AIInvalidResponseError";
  }
}

export class AIProviderError extends AIError {
  constructor(message: string) {
    super(message, "provider", true);
    this.name = "AIProviderError";
  }
}

export class AISafetyLimitError extends AIError {
  constructor(message: string) {
    super(message, "safety_limit", false);
    this.name = "AISafetyLimitError";
  }
}

/** Veelige gebruikersboodschap — geen keys, geen internals. */
export function userFacingAIMessage(error: unknown): string {
  if (error instanceof AIError) {
    switch (error.kind) {
      case "configuration":
        return "AI is niet juist geconfigureerd. Controleer de environment variables.";
      case "auth":
        return "AI-authenticatie is mislukt. Controleer de API-sleutelconfiguratie.";
      case "rate_limit":
        return "AI-aanvragen worden momenteel beperkt. Probeer het later opnieuw.";
      case "timeout":
        return "De AI-aanvraag duurde te lang. Probeer het later opnieuw.";
      case "invalid_response":
        return "De AI gaf een ongeldig antwoord. Probeer het opnieuw.";
      case "safety_limit":
        return "De AI-veiligheidslimiet voor deze run is bereikt.";
      case "provider":
        return "Er ging iets mis bij de AI-provider. Probeer het later opnieuw.";
      default:
        return "Er ging onverwacht iets mis bij de AI-aanvraag.";
    }
  }
  return "Er ging onverwacht iets mis bij de AI-aanvraag.";
}

/**
 * Metadata over een AI-call-poging (mode + model die de service WILDE
 * gebruiken) — gegenereerd op het moment van falen, zodat een rapporteerende
 * service (bijv. QC) bij een FAILED live call niet met de init-waarde
 * "mock" blijft staan. Productiebug 2026-09-19: de AI-QC faalde live op
 * max_tokens, maar het quality_controls-record toonde mode=mock omdat het
 * faalpad mode/model nooit bijwerkte.
 */
export interface AIAttemptMetadata {
  mode: "mock" | "live";
  model: string;
}

const AI_ATTEMPT_PROPERTY = "aiAttempt" as const;

type ErrorWithAIAttempt = Error & { [AI_ATTEMPT_PROPERTY]?: AIAttemptMetadata };

/** Zet de pogings-metadata op de fout (non-enumerable: niet in logs/serialisatie lekken). */
export function attachAIAttemptMetadata(error: unknown, metadata: AIAttemptMetadata): void {
  if (error instanceof Error) {
    Object.defineProperty(error, AI_ATTEMPT_PROPERTY, {
      value: metadata,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
}

/** Leest de pogings-metadata terug; null bij afwezigheid of ongulide vorm. */
export function readAIAttemptMetadata(error: unknown): AIAttemptMetadata | null {
  if (error instanceof Error) {
    const metadata = (error as ErrorWithAIAttempt)[AI_ATTEMPT_PROPERTY];
    if (
      metadata &&
      (metadata.mode === "live" || metadata.mode === "mock") &&
      typeof metadata.model === "string" &&
      metadata.model.length > 0
    ) {
      return metadata;
    }
  }
  return null;
}
