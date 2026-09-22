import { z } from "zod";
import type { VerifiedKvkIdentity } from "./types";

const text = z.string().trim().min(1).max(500);
const identitySchema = z.object({
  kind: z.literal("verified_kvk"),
  kvkNumber: z.string().regex(/^\d{8}$/),
  establishmentNumber: z.string().regex(/^\d{12}$/),
  businessName: text,
  tradeNames: z.array(text).min(1).max(200),
  address: z.object({ street: text, houseNumber: z.string().regex(/^\d+$/), addition: text.nullable(), postalCode: z.string().regex(/^[1-9]\d{3}[A-Z]{2}$/), city: text, country: z.literal("NL") }).strict(),
  activities: z.array(z.object({ code: z.string().regex(/^\d{2,6}$/), description: text, isMain: z.boolean() }).strict()).max(200),
  websites: z.array(z.string().trim().min(1).max(2048)).max(100),
  nonMailing: z.boolean().nullable(),
  legalForm: text.nullable(),
  provenance: z.object({ source: z.literal("kvk"), fetchedAt: z.string().datetime(), basisProfile: z.string(), establishmentProfile: z.string(), matchRule: z.literal("active_trade_name_and_visit_address_v1") }).strict(),
}).strict().superRefine((v, ctx) => {
  if (v.provenance.basisProfile !== `https://api.kvk.nl/api/v1/basisprofielen/${v.kvkNumber}` || v.provenance.establishmentProfile !== `https://api.kvk.nl/api/v1/vestigingsprofielen/${v.establishmentNumber}`) {
    ctx.addIssue({ code: "custom", message: "INVALID_KVK_PROVENANCE" });
  }
});

/** Only the identity verifier's independently acquired KVK contract crosses this boundary.
 * No passthrough metadata, Google payload, exception message or copy-through fields.
 */
export function persistableIdentity(input: unknown): VerifiedKvkIdentity {
  const parsed = identitySchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_VERIFIED_IDENTITY");
  return parsed.data;
}
export function validPlaceId(input: unknown): string {
  if (typeof input !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(input)) throw new Error("INVALID_DISCOVERY_REFERENCE");
  return input;
}
export interface VerifiedCandidateRecord {
  id: string;
  identity: VerifiedKvkIdentity;
}
export interface PersistVerifiedInput {
  runId: string;
  identity: VerifiedKvkIdentity;
  placeId: string;
}
export type PersistVerifiedResult = {
  status: "created" | "duplicate_candidate" | "duplicate_lead";
  candidateId: string | null;
  leadId: string | null;
};
export interface VerifiedCandidateRepository {
  persist(input: PersistVerifiedInput): Promise<PersistVerifiedResult>;
}
export interface IdentityDiscoverySummary {
  phase: "identity_v1";
  verified: number;
  persisted: number;
  ambiguous: number;
  unmatched: number;
  technicalError: number;
  duplicates: number;
  placeDuplicates: number;
  requested: number;
  quotaMet: boolean;
  stopReason: "quota_met" | "results_exhausted" | "page_limit" | "candidate_limit" | "time_limit" | "technical_error";
  candidateIds: string[];
  /** Provider-independent enum counts. Never source payloads. */
  reasons: Record<string, number>;
}
