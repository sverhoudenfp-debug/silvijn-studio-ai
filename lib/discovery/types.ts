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
  phase: "google_official_website_discovery_v2";
  requested: number;
  googleCandidates: number;
  noWebsiteListed: number;
  websiteListedSkipped: number;
  /** Kandidaten waarvan Google-types aantoonbaar niet bij de gevraagde branche passen (alleen geteld). */
  industryMismatchSkipped?: number;
  officialWebsiteVerified: number;
  officialWebsiteAmbiguous: number;
  officialWebsiteNotFound: number;
  officialWebsiteTechnicalErrors: number;
  potentialNoWebsiteCandidates: number;
  /** Leads die via de bestaande creatieketen uit not_found-kandidaten zijn gemaakt (telling). */
  leadsCreated?: number;
  quotaMet: boolean;
  stopReason: "quota_met" | "search_budget" | "results_exhausted" | "page_limit" | "candidate_limit" | "technical_error";
}

/**
 * Email-required samenvatting (2026-10-03) — alleen gezet voor de live
 * google-bron. limit betekent hier: gewenste nieuwe e-mail-geschikte leads;
 * de discovery onderzoekt een begrensde kandidaatpool (candidateCap) om dat
 * aantal te bereiken. Kandidaten zonder geverifieerd zakelijk adres worden
 * NIET als lead opgeslagen.
 */
export interface EmailRequiredDiscoverySummary {
  mode: "email_required";
  /** Gewenste aantal nieuwe e-mail-leads (= owner-limiet). */
  targetLeads: number;
  /** Harde bovengrens aan onderzochte kandidaten deze run. */
  candidateCap: number;
  /** Kandidaten die de verrijkingsbeslissing hebben bereikt. */
  candidatesResearched: number;
  /** Verrijking gedraaid, geen adres geaccepteerd (niet opgeslagen). */
  noEmailFound: number;
  /** Adres geaccepteerd door een van de drie verificatieregels. */
  emailsFound: number;
  /** Nieuwe leads aangemaakt mét geverifieerd adres. */
  leadsCreated: number;
  /** Verrijking geblokkeerd (geen provider geconfigureerd). */
  blocked: number;
  /** Providerfouten tijdens de verrijking. */
  errors: number;
  stopReason:
    | "target_reached"
    | "candidates_exhausted"
    | "blocked_external_configuration";
  /** Leesbare uitkomst voor UI en run-overzicht, bijv. "7 van 10 e-mail-leads gevonden — kandidaatpool uitgeput". */
  message: string;
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
  /** Contactverrijking (2026-10-01): alleen gezet voor live bronnen (google). */
  contactEnrichment?: import("./contact-enrichment/service").ContactEnrichmentRunSummary;
  /** Email-required trechter (2026-10-03): alleen gezet voor de google-bron. */
  emailRequired?: EmailRequiredDiscoverySummary;
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
