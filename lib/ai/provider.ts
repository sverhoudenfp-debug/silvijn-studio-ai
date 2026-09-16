import { getAIConfig } from "./config";
import { MockAIProvider } from "./mock-provider";
import { AnthropicProvider } from "./anthropic";
import type { AIProvider } from "./types";

/**
 * Provider-factory: de rest van de applicatie werkt alleen tegen de AIProvider
 * interface. Mock of live volgt uit AI_MODE (default: mock).
 */
export function getAIProvider(): AIProvider {
  const config = getAIConfig();
  if (config.mode === "live") {
    return new AnthropicProvider(); // constructor valideert de API-key (fail fast)
  }
  return new MockAIProvider();
}
