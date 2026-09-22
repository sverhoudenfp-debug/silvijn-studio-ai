import "server-only";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { persistableIdentity, validPlaceId, type PersistVerifiedInput, type PersistVerifiedResult, type VerifiedCandidateRepository, type VerifiedCandidateRecord } from "@/lib/discovery/identity/persistence";

export class SupabaseVerifiedCandidateRepository implements VerifiedCandidateRepository {
  async persist(input: PersistVerifiedInput): Promise<PersistVerifiedResult> {
    const identity = persistableIdentity(input.identity);
    const placeId = validPlaceId(input.placeId);
    const { data, error } = await getSupabaseServerClient().rpc("persist_verified_discovery_candidate", {
      p_identity: identity, p_place_id: placeId, p_run_id: input.runId,
    });
    if (error || !data || !["created", "duplicate_candidate", "duplicate_lead"].includes(data.status)) {
      // Never forward an RPC error: it may quote business values.
      throw new Error("VERIFIED_CANDIDATE_PERSIST_FAILED");
    }
    return { status: data.status, candidateId: data.candidateId ?? null, leadId: data.leadId ?? null };
  }
}

/** Explicitly injected test double. Factory never silently selects it for live Google discovery. */
export class MemoryVerifiedCandidateRepository implements VerifiedCandidateRepository {
  readonly records: VerifiedCandidateRecord[] = [];
  readonly references = new Map<string, { kvk: string; establishment: string }>();
  constructor(private readonly existing: { id: string; kvkNumber: string; establishmentNumber?: string | null }[] = []) {}
  async persist(input: PersistVerifiedInput): Promise<PersistVerifiedResult> {
    const identity = persistableIdentity(input.identity);
    const place = validPlaceId(input.placeId);
    const ref = this.references.get(place);
    if (ref && (ref.kvk !== identity.kvkNumber || ref.establishment !== identity.establishmentNumber)) throw new Error("DISCOVERY_IDENTITY_CONFLICT");
    if (this.records.some(r => r.identity.establishmentNumber === identity.establishmentNumber && r.identity.kvkNumber !== identity.kvkNumber) ||
        this.existing.some(r => r.establishmentNumber === identity.establishmentNumber && r.kvkNumber !== identity.kvkNumber) ||
        [...this.references.values()].some(r => r.establishment === identity.establishmentNumber && r.kvk !== identity.kvkNumber)) throw new Error("DISCOVERY_IDENTITY_CONFLICT");
    const lead = this.existing.find(r => r.kvkNumber === identity.kvkNumber);
    let record = this.records.find(r => r.identity.kvkNumber === identity.kvkNumber);
    const status = lead ? "duplicate_lead" : record ? "duplicate_candidate" : "created";
    if (!lead && !record) {
      record = { id: crypto.randomUUID(), identity };
      this.records.push(record);
    }
    this.references.set(place, { kvk: identity.kvkNumber, establishment: identity.establishmentNumber });
    return { status, candidateId: lead ? null : record!.id, leadId: lead?.id ?? null };
  }
}
export function getVerifiedCandidateRepository(): VerifiedCandidateRepository {
  if (!isSupabaseConfigured()) throw new Error("VERIFIED_CANDIDATE_DATABASE_NOT_CONFIGURED");
  return new SupabaseVerifiedCandidateRepository();
}
