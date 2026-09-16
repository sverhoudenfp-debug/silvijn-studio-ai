import Anthropic from "@anthropic-ai/sdk";
import { getAIConfig, modelSupportsTemperature, requireLiveAPIKey } from "./config";
import {
  AIAuthError,
  AIConfigurationError,
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

function mapAnthropicError(error: unknown): Error {
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    if (status === 401 || status === 403) return new AIAuthError("Anthropic-authenticatie mislukt");
    if (status === 429) return new AIProviderError("Anthropic rate limit bereikt");
    if (status >= 500) return new AIProviderError("Anthropic-serverfout");
    return new AIProviderError(`Anthropic-APIfout (status ${status})`);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AIProviderError("Kon Anthropic niet bereiken (netwerkfout)");
  }
  return new AIProviderError("Onbekende Anthropic-fout");
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
    const started = Date.now();
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
      const response = await this.client.messages.create(body);

      if (Date.now() - started > this.timeoutMs) {
        throw new AITimeoutError("Anthropic-aanvraag duurde te lang");
      }

      const text =
        response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("\n") ?? "";

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
      if (error instanceof AIConfigurationError || error instanceof AIAuthError) throw error;
      throw mapAnthropicError(error);
    }
  }
}
