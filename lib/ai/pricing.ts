/**
 * Centrale modelprijzen (per 1 miljoen tokens, USD).
 *
 * LET OP: prijzen kunnen wijzigen — deze waarden zijn schattingen gebaseerd op
 * de bekende publicatieprijzen en moeten bij een modelupgrade worden gecontroleerd
 * tegen https://platform.claude.com/docs. Alle kosten in de app lopen via
 * estimateCost() zodat een prijswijziging één aanpassing is.
 */

export interface ModelPricing {
  /** USD per 1M input-tokens. */
  inputPerMillion: number;
  /** USD per 1M output-tokens. */
  outputPerMillion: number;
}

export const modelPricing: Record<string, ModelPricing> = {
  "claude-haiku-4-5": { inputPerMillion: 1, outputPerMillion: 5 },
  "claude-sonnet-4-5": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-opus-4-5": { inputPerMillion: 5, outputPerMillion: 25 },
};

/** Onbekende modellen krijgen geen kosten toegeschreven (0) — nooit gokken. */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = modelPricing[model];
  if (!pricing) return 0;
  const cost =
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
