import type { DiscoverySource, LeadDiscoveryProvider } from "../types";
import { MockDiscoveryProvider } from "./mock-provider";

/**
 * Provider-registry — kiest de discovery-bron op request.source.
 * Echte providers (google, directory) melden MISSING CONFIGURATION
 * in plaats van nepdata te leveren of te crashen.
 */

export class DiscoveryConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryConfigurationError";
  }
}

class GoogleBusinessProviderStub {
  readonly id = "google";
  readonly name = "Google Business Provider (nog niet geconfigureerd)";
  readonly live = true;

  async search(): Promise<never> {
    throw new DiscoveryConfigurationError(
      "MISSING CONFIGURATION: GOOGLE_PLACES_API_KEY — de Google-provider is nog niet geconfigureerd."
    );
  }
}

class DirectoryProviderStub {
  readonly id = "directory";
  readonly name = "Bedrijfsdirectory Provider (nog niet geconfigureerd)";
  readonly live = true;

  async search(): Promise<never> {
    throw new DiscoveryConfigurationError(
      "MISSING CONFIGURATION: DIRECTORY_API_KEY — de directory-provider is nog niet geconfigureerd."
    );
  }
}

export function getDiscoveryProvider(source: DiscoverySource): LeadDiscoveryProvider {
  switch (source) {
    case "google":
      return new GoogleBusinessProviderStub() as unknown as LeadDiscoveryProvider;
    case "directory":
      return new DirectoryProviderStub() as unknown as LeadDiscoveryProvider;
    default:
      return new MockDiscoveryProvider();
  }
}

export const DISCOVERY_SOURCES: { id: DiscoverySource; label: string; available: boolean }[] = [
  { id: "mock", label: "Mock (fictieve testbedrijven)", available: true },
  { id: "google", label: "Google Business (vereist configuratie)", available: false },
  { id: "directory", label: "Bedrijfsdirectory (vereist configuratie)", available: false },
];
