import "server-only";
import type { DiscoverySource, LeadDiscoveryProvider } from "../types";
import { MockDiscoveryProvider } from "./mock-provider";
import { GooglePlacesDiscoveryProvider } from "./google-places-provider";
import { mockDiscoveryAllowed } from "../provider-safety";
export { DISCOVERY_SOURCES } from "../source-options";
export class DiscoveryConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = "DiscoveryConfigurationError"; }
}
class DirectoryProviderStub implements LeadDiscoveryProvider {
  readonly id = "directory";
  readonly name = "Bedrijfsdirectory (niet geconfigureerd)";
  readonly live = true;
  async search(): Promise<never> { throw new DiscoveryConfigurationError("DIRECTORY_NOT_CONFIGURED"); }
}
export function getDiscoveryProvider(source: "google"): GooglePlacesDiscoveryProvider;
export function getDiscoveryProvider(source: "mock" | "directory"): LeadDiscoveryProvider;
export function getDiscoveryProvider(source: DiscoverySource): LeadDiscoveryProvider | GooglePlacesDiscoveryProvider;
export function getDiscoveryProvider(source: DiscoverySource): LeadDiscoveryProvider | GooglePlacesDiscoveryProvider {
  switch (source) {
    case "google": return new GooglePlacesDiscoveryProvider();
    case "directory": return new DirectoryProviderStub();
    case "mock":
      if (!mockDiscoveryAllowed()) throw new DiscoveryConfigurationError("MOCK_DISCOVERY_FORBIDDEN");
      return new MockDiscoveryProvider();
    default: throw new DiscoveryConfigurationError("UNKNOWN_DISCOVERY_PROVIDER");
  }
}
