import type { LeadSourceType, WebsiteStatus } from "@/lib/types";

/**
 * Lead Discovery — types & contracten (Fase 5).
 * Discovery zoekt kandidaten, verrijkt ze, controleert op duplicaten en
 * maakt er Leads van via de bestaande LeadRepository. Geen tweede Lead-systeem.
 */

export type DiscoverySource = "mock" | "google" | "directory";

export interface DiscoveryRequest {
  /** ISO-landcode; Nederland = "NL" (default). */
  country: string;
  province?: string;
  city?: string;
  industry?: string;
  /** Vrije zoekterm, bijv. "loodgieters in Eindhoven". */
  query?: string;
  /** Aantal kandidaten; afgetopt door MAX_DISCOVERY_RESULTS. */
  limit: number;
  source: DiscoverySource;
}

/**
 * Ruwe kandidaat van een provider. websiteStatusHint is wat de BRON CLAIMT —
 * nooit geverifieerde data; de definitieve websiteStatus wordt bepaald door
 * de WebsiteDiscoveryService (ongecontroleerd → unknown, nooit gokken).
 */
export interface DiscoveryCandidate {
  externalId: string | null;
  businessName: string;
  industry: string;
  address: string | null;
  postalCode: string | null;
  city: string;
  province: string;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  /** Wat de bron claimt (no_website / has_website / website_poor / unknown / null). */
  websiteStatusHint: WebsiteStatus | null;
  source: LeadSourceType;
  sourceUrl: string | null;
  metadata: Record<string, unknown>;
}

export type DiscoveryCandidateStatus =
  | "new"
  | "duplicate"
  | "invalid"
  | "created"
  | "skipped";

export type DuplicateReason =
  | "duplicate_website"
  | "duplicate_email"
  | "duplicate_phone"
  | "duplicate_business_city"
  | "duplicate_source_id";

export interface DiscoveryCandidateResult {
  candidate: DiscoveryCandidate;
  status: DiscoveryCandidateStatus;
  reason?: string;
  leadId?: string;
  websiteStatus: WebsiteStatus;
}

export interface GooglePreKvkSummary {
  phase: "google_no_website_listed_v1";
  requested: number;
  googleCandidates: number;
  noWebsiteListed: number;
  websiteListedSkipped: number;
  quotaMet: boolean;
  stopReason: "quota_met" | "results_exhausted" | "page_limit" | "candidate_limit" | "technical_error";
}

export interface DiscoveryResult {
  identity?: import("./identity/persistence").IdentityDiscoverySummary;
  preKvk?: GooglePreKvkSummary;
  candidates: DiscoveryCandidateResult[];
  totalFound: number;
  source: string;
  query: DiscoveryRequest;
  durationMs: number;
  duplicatesSkipped: number;
  invalidCandidatesSkipped: number;
  createdLeads: number;
  errors: string[];
}

/**
 * Provider-contract. Een provider zoekt kandidaten bij een bron.
 * `live` maakt expliciet onderscheid tussen echte externe data en mock data —
 * mock data wordt nooit als echte extern gevonden data gepresenteerd.
 */
export interface LeadDiscoveryProvider {
  readonly id: string;
  readonly name: string;
  readonly live: boolean;
  search(request: DiscoveryRequest): Promise<DiscoveryCandidate[]>;
}
