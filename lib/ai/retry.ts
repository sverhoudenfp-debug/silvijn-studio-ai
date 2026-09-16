import { AIError } from "./errors";

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs?: number;
}

/**
 * Beperkte retry voor retryable AI-fouten (rate limit, tijdelijke provider- of
 * netwerkfouten, ongeldige gestructureerde output). Configuration/auth/safety
 * fouten worden NIET geretried — geen oneindige loops.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  { maxRetries, initialDelayMs = 500 }: RetryOptions
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof AIError && error.retryable;
      if (!retryable || attempt === maxRetries) break;
      const backoff = initialDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  throw lastError;
}
