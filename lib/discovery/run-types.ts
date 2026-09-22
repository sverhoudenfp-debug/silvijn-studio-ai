/**
 * Discovery-run typen (Fase D) — één expliciete owner-opdracht per run.
 * De orchestrator gebruikt de bestaande LeadDiscoveryService; dit zijn
 * uitsluitend de run-registratie en samenvatting, geen tweede lead-systeem.
 */

export interface DiscoveryRunInput {
  ownerUserId: string;
  command: string;
  country: string;
  province: string | null;
  city: string | null;
  industry: string | null;
  query: string | null;
  source: "mock" | "google" | "directory";
  requestedLimit: number;
  effectiveLimit: number;
}

export interface DiscoveryRunLeadSummary {
  leadId: string;
  businessName: string;
  industry: string;
  city: string;
  websiteStatus: string;
  score: number;
  priority: "hoog" | "middel" | "laag";
}

export interface DiscoveryRunSummary {
  identity?: import("./identity/persistence").IdentityDiscoverySummary;
  preKvk?: import("./types").GooglePreKvkSummary;
  created: DiscoveryRunLeadSummary[];
  duplicateReasons: Record<string, number>;
}

export interface DiscoveryRunRecord {
  id: string;
  ownerUserId: string;
  command: string;
  country: string;
  province: string | null;
  city: string | null;
  industry: string | null;
  query: string | null;
  source: string;
  requestedLimit: number;
  effectiveLimit: number;
  status: "running" | "completed" | "failed";
  totalFound: number | null;
  createdLeads: number | null;
  duplicatesSkipped: number | null;
  invalidSkipped: number | null;
  durationMs: number | null;
  createdLeadIds: string[];
  summary: DiscoveryRunSummary;
  errors: string[];
  startedAt: string;
  completedAt: string | null;
}

export interface DiscoveryRunPatch {
  status: DiscoveryRunRecord["status"];
  totalFound: number | null;
  createdLeads: number | null;
  duplicatesSkipped: number | null;
  invalidSkipped: number | null;
  durationMs: number | null;
  createdLeadIds: string[];
  summary: DiscoveryRunSummary;
  errors: string[];
  completedAt: string;
}

/** Leesbare prioriteitsband bij de bestaande rule-based score (0-100). */
export function scorePriority(score: number): "hoog" | "middel" | "laag" {
  if (score >= 70) return "hoog";
  if (score >= 40) return "middel";
  return "laag";
}
