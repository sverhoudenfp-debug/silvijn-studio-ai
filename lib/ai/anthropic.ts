import Anthropic from "@anthropic-ai/sdk";
import { getAIConfig, modelSupportsTemperature, requireLiveAPIKey } from "./config";
import {
  AIAuthError,
  AIError,
  AIInvalidResponseError,
  AIProviderError,
  AITimeoutError,
} from "./errors";
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderResult,
} from "./types";

/**
 * De ENIGE plek in de codebase waar de Anthropic SDK wordt aangeroepen.
 * Uitsluitend server-side: ANTHROPIC_API_KEY komt alleen uit server-side
 * environment variables en verlaat deze module nooit.
 */

function mapAnthropicError(error: unknown, timeoutMsLabel: string): Error {
  // Volgorde is bewust: APIUserAbortError en APIConnectionError erven VAN
  // Anthropic.APIError (status undefined → 0) — de generieke APIError-tak mag
  // ze dus nooit eerst vangen, anders verdwijnt de echte oorzaak (timeout/
  // netwerk) in "Anthropic-APIfout (status 0)".
  if (error instanceof Anthropic.APIUserAbortError) {
    return new AITimeoutError(`Anthropic-aanvraag afgebroken: limiet van ${timeoutMsLabel} bereikt`);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    // Een afgebroken request (AbortSignal/timeout) komt hier als connectiefout
    // binnen — de echte limiet is dan bereikt en dat is een timeout, geen
    // netwerk-/providerfout. De specifieke boodschap mag nooit verloren gaan.
    const causeName = (error.cause as { name?: string } | undefined)?.name;
    if (causeName === "TimeoutError" || causeName === "AbortError") {
      return new AITimeoutError(`Anthropic-aanvraag afgebroken: limiet van ${timeoutMsLabel} bereikt`);
    }
    return new AIProviderError("Kon Anthropic niet bereiken (netwerkfout)");
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    // Fase 12 §O: log het veilige Anthropic error.type (never de payload —
    // die kan request-details bevatten). error.error?.type is een publieke
    // enum als invalid_request_error / billing_error / rate_limit_error.
    const errorType = (error as { error?: { type?: string } }).error?.type;
    const typeSuffix = errorType ? `, type: ${errorType}` : "";
    if (status === 401 || status === 403) return new AIAuthError(`Anthropic-authenticatie mislukt (status ${status}${typeSuffix})`);
    if (status === 429) return new AIProviderError(`Anthropic rate limit bereikt${typeSuffix}`);
    if (status >= 500) return new AIProviderError(`Anthropic-serverfout (status ${status}${typeSuffix})`);
    return new AIProviderError(`Anthropic-APIfout (status ${status}${typeSuffix})`);
  }
  // E2E-les 2026-09-20: een onverwachte foutklasse verdween volledig in deze
  // generieke boodschap. De constructor-naam (+ evt. status) is veilig te
  // loggen (geen payload) en maakt de echte oorzaak zichtbaar zonder secrets.
  const errorName = (error as { constructor?: { name?: string } })?.constructor?.name ?? "onbekend";
  const status = (error as { status?: number })?.status;
  return new AIProviderError(
    `Onbekende Anthropic-fout (${errorName}${status != null ? `, status ${status}` : ""})`
  );
}

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";
  readonly mode = "live" as const;
  private readonly client: Anthropic;
  private readonly timeoutMs: number;

  constructor() {
    const apiKey = requireLiveAPIKey();
    const config = getAIConfig();
    this.client = new Anthropic({
      apiKey,
      maxRetries: 0, // retry zit in lib/ai/retry.ts — één plek, geen dubbele retries
    });
    this.timeoutMs = config.requestTimeoutMs;
  }

  async generateText(request: AIProviderRequest): Promise<AIProviderResult> {
    try {
      const body: Anthropic.MessageCreateParamsNonStreaming = {
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
      };
      // Centrale capability-regel: temperature alleen meesturen als het model het ondersteunt.
      if (request.temperature !== undefined && modelSupportsTemperature(request.model)) {
        body.temperature = request.temperature;
      }
      // Expliciete thinking-cap (Anthropic: thinking.budget_tokens, minimaal
      // 1024). Bij expliciet thinking mag de API geen custom temperature
      // (vereist 1) — de service laat temperature dan al weg.
      if (request.thinkingBudget !== undefined) {
        body.thinking = {
          type: "enabled",
          budget_tokens: Math.max(1024, request.thinkingBudget),
        };
      }
      // Echte abort: het request stopt bij de limiet in plaats van af te
      // wachten en het antwoord nú achteraf weg te gooien (betaalde tokens).
      const response = await this.client.messages.create(body, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const text =
        response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("\n") ?? "";

      // Live-les 2026-09-19 (questionnaire completion, ai_run de6eecb1): een
      // thinking-model kan de VOLLEDIGE max_tokens aan redeneren besteden,
      // waardoor de tekst leeg of afgekapt terugkomt. Dat is een onvolledig
      // antwoord — eerlijk en specifiek melden i.p.v. het generieke
      // "geen geldige JSON" dat de echte oorzaak (te krap tokenbudget)
      // onzichtbaar maakte. Retryable: de denklengte varieert per poging.
      if (response.stop_reason === "max_tokens") {
        throw new AIInvalidResponseError(
          `AI-antwoord onvolledig: tokenlimiet (max_tokens ${request.maxTokens}) bereikt vóór volledige output — verhoog het tokenbudget (thinking verbruikt output-tokens)`
        );
      }

      return {
        text,
        model: response.model,
        mode: "live",
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error) {
      // Eigen foutklassen (AIError: timeout, rate limit, provider, invalid
      // response, ...) gaan ONVERANDERD door — een hermapping verscheenpte
      // eerder de specifieke reden (bijv. timeout) naar "Onbekende
      // Anthropic-fout", waardoor de UI en de logging geen oorzaak meer hadden.
      if (error instanceof AIError) throw error;
      throw mapAnthropicError(error, `${Math.round(this.timeoutMs / 1000)}s`);
    }
  }
}
