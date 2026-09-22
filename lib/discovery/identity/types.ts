/** Never serialize this boundary into storage, logs, errors, queues or client responses. */
export interface TemporaryGoogleCandidate {
  readonly kind: "temporary_google";
  placeId: string;
  displayName: string;
  websiteUrl: string | null;
  websiteListingStatus: "website_listed" | "no_website_listed";
  address: {
    postalCode: string | null;
    houseNumber: string | null;
    addition: string | null;
    street: string | null;
    city: string | null;
    /** administrative_area_level_1 (provincie); nodig voor de bestaande enrichment. */
    province?: string | null;
    countryCode: string | null;
  };
  /** Contact-/zichtbaarheidssignalen uit dezelfde Google Enterprise-SKU als websiteUri (geen extra kosten). */
  phone?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
}
export interface GoogleDiscoveryPage {
  candidates: TemporaryGoogleCandidate[];
  nextPageToken: string | null;
}
/** All business values below must come from verified KVK profiles, never Google. */
export interface VerifiedKvkIdentity {
  kind: "verified_kvk";
  kvkNumber: string;
  establishmentNumber: string;
  businessName: string;
  tradeNames: string[];
  address: {
    street: string;
    houseNumber: string;
    addition: string | null;
    postalCode: string;
    city: string;
    country: "NL";
  };
  activities: { code: string; description: string; isMain: boolean }[];
  websites: string[];
  nonMailing: boolean | null;
  legalForm: string | null;
  provenance: {
    source: "kvk";
    fetchedAt: string;
    basisProfile: string;
    establishmentProfile: string;
    matchRule: "active_trade_name_and_visit_address_v1";
  };
}
export type KvkVerificationResult =
  | { status: "verified"; identity: VerifiedKvkIdentity }
  | { status: "ambiguous"; reason: "MULTIPLE_MATCHES" | "INSUFFICIENT_EVIDENCE" | "SEARCH_LIMIT" }
  | { status: "unmatched"; reason: "NO_MATCH" | "NOT_NL" | "INACTIVE" }
  | { status: "technical_error"; reason: "KVK_NOT_CONFIGURED" | "KVK_REQUEST_FAILED" | "KVK_INVALID_RESPONSE" };
export interface KvkVerifier {
  verify(candidate: TemporaryGoogleCandidate): Promise<KvkVerificationResult>;
}
