import type { DiscoverySource } from "./types";
export function isKnownDiscoverySource(source: unknown): source is DiscoverySource {
  return source === "google" || source === "directory" || source === "mock";
}
export function mockDiscoveryAllowed(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.SUPABASE_SECRET_KEY &&
    (Boolean(process.env.NODE_TEST_CONTEXT) || process.env.DISCOVERY_ALLOW_MOCK === "true");
}
