import type { DiscoverySource } from "./types";
/** Client-safe labels, never import backend providers into the client bundle. */
export const DISCOVERY_SOURCES: { id: DiscoverySource; label: string; available: boolean }[] = [
  { id: "google", label: "Google + KVK (Phase 1 identiteit, API-toegang vereist)", available: true },
  { id: "directory", label: "Bedrijfsdirectory (niet geconfigureerd)", available: false },
  { id: "mock", label: "Mock (uitsluitend geïsoleerde tests)", available: false },
];
