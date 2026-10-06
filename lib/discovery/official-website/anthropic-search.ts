import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getAIConfig, requireLiveAPIKey } from "@/lib/ai/config";
import type { TemporaryGoogleCandidate } from "../identity/types";

export class OfficialWebsiteSearchError extends Error {
  constructor(readonly code: "NOT_CONFIGURED" | "REQUEST_FAILED" | "INVALID_RESPONSE", readonly detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "OfficialWebsiteSearchError";
  }
}

export interface WebsiteSearchSource {
  search(candidate: TemporaryGoogleCandidate): Promise<{ urls: string[] }>;
}

function addressQuery(candidate: TemporaryGoogleCandidate): string {
  const streetLine = [
    candidate.address.street,
    candidate.address.houseNumber,
    candidate.address.addition,
  ].filter(Boolean).join(" ");
  return [
    candidate.displayName,
    streetLine,
    candidate.address.postalCode,
    candidate.address.city,
    "Nederland",
  ].filter(Boolean).join(", ");
}

/**
 * Narrow, one-shot URL source for official-website discovery. This is kept
 * separate from AnthropicProvider.generateText because callers need typed
 * web_search_tool_result blocks, not generated prose.
 */
export class AnthropicOfficialWebsiteSearch implements WebsiteSearchSource {
  private readonly client: Pick<Anthropic, "messages">;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options?: {
    apiKey?: string;
    model?: string;
    timeoutMs?: number;
    client?: Pick<Anthropic, "messages">;
  }) {
    let apiKey: string;
    try {
      apiKey = options?.apiKey ?? requireLiveAPIKey();
    } catch {
      throw new OfficialWebsiteSearchError("NOT_CONFIGURED");
    }
    const config = getAIConfig();
    this.model = options?.model ?? config.models.balanced;
    this.timeoutMs = options?.timeoutMs ?? config.requestTimeoutMs;
    this.client = options?.client ?? new Anthropic({ apiKey, maxRetries: 0 });
  }

  async search(candidate: TemporaryGoogleCandidate): Promise<{ urls: string[] }> {
    if (candidate.websiteListingStatus !== "no_website_listed") {
      throw new OfficialWebsiteSearchError("INVALID_RESPONSE");
    }

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1_000,
        tools: [{
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 1,
          user_location: {
            type: "approximate",
            city: candidate.address.city ?? undefined,
            region: undefined,
            country: "NL",
            timezone: "Europe/Amsterdam",
          },
        }],
        system: [
          "Je levert uitsluitend zoekondersteuning voor mogelijke officiële bedrijfswebsites in Nederland.",
          "Voer exact één webzoekopdracht uit. Zoek met de opgegeven bedrijfsnaam en locatie.",
          "Een zoekpositie is nooit bewijs van eigendom. Verzin geen URL en doe geen tweede zoekopdracht.",
        ].join(" "),
        messages: [{
          role: "user",
          content: `Zoek mogelijke officiële website-URL's voor: ${addressQuery(candidate)}. Citeer de geraadpleegde zoekresultaten.`,
        }],
      }, { signal: AbortSignal.timeout(this.timeoutMs) });

      if ((response.usage.server_tool_use?.web_search_requests ?? 0) !== 1) {
        throw new OfficialWebsiteSearchError(
          "INVALID_RESPONSE",
          `web_search_requests=${response.usage.server_tool_use?.web_search_requests ?? 0}, model=${this.model}`
        );
      }

      const urls: string[] = [];
      for (const block of response.content) {
        if (block.type !== "web_search_tool_result") continue;
        if (!Array.isArray(block.content)) {
          throw new OfficialWebsiteSearchError("REQUEST_FAILED", "web_search_tool_result.content is geen array");
        }
        for (const result of block.content) {
          if (result.type !== "web_search_result") continue;
          if (!urls.includes(result.url)) urls.push(result.url);
        }
      }
      return { urls };
    } catch (error) {
      if (error instanceof OfficialWebsiteSearchError) throw error;
      if (error instanceof Anthropic.AuthenticationError) {
        throw new OfficialWebsiteSearchError("NOT_CONFIGURED", `HTTP ${error.status ?? "?"} ${String(error.message ?? "").slice(0, 160)}`);
      }
      if (error instanceof Anthropic.APIError) {
        throw new OfficialWebsiteSearchError(
          "REQUEST_FAILED",
          `HTTP ${error.status ?? "?"} ${error.constructor.name}: ${String(error.message ?? "").slice(0, 160)}`
        );
      }
      if (error instanceof Error && /timeout|abort/i.test(`${error.name} ${error.message}`)) {
        throw new OfficialWebsiteSearchError("REQUEST_FAILED", `TIMEOUT na ${this.timeoutMs}ms: ${error.name}`);
      }
      throw new OfficialWebsiteSearchError(
        "REQUEST_FAILED",
        `${error instanceof Error ? `${error.name}: ${String(error.message).slice(0, 160)}` : String(error).slice(0, 160)}`
      );
    }
  }
}
