import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GoogleIdentityDiscoveryService } from "../lib/discovery/identity/service";
import { persistableIdentity } from "../lib/discovery/identity/persistence";
import { MemoryVerifiedCandidateRepository } from "../lib/repositories/verified-candidate-repository";
import type { TemporaryGoogleCandidate, VerifiedKvkIdentity, KvkVerificationResult } from "../lib/discovery/identity/types";
import { getDiscoveryProvider } from "../lib/discovery/providers";
import { validateDiscoveryCommand } from "../lib/discovery/orchestrator";
import { mockDiscoveryAllowed } from "../lib/discovery/provider-safety";
import { getLeadRepository } from "../lib/repositories/lead-repository";
import type { Lead } from "../lib/types";

delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
delete process.env.GOOGLE_PLACES_API_KEY;
delete process.env.KVK_API_KEY;
const request = { country: "NL", city: "Eindhoven", industry: "Schilders", source: "google" as const, limit: 2 };
function temporary(id = "google_id_1"): TemporaryGoogleCandidate {
  return { kind: "temporary_google", placeId: id, displayName: "GOOGLE_SECRET_NAME_SENTINEL", address: { postalCode: "5611AB", houseNumber: "1", addition: null, street: "GOOGLE_SECRET_STREET", city: "Eindhoven", countryCode: "NL" } };
}
function identity(kvk = "12345678", est = "000012345678"): VerifiedKvkIdentity {
  return { kind: "verified_kvk", kvkNumber: kvk, establishmentNumber: est, businessName: "KVK Test Schilder", tradeNames: ["KVK Test Schilder"],
    address: { street: "KVK Teststraat", houseNumber: "1", addition: null, postalCode: "5611AB", city: "Eindhoven", country: "NL" }, activities: [{ code: "4334", description: "Schilderen", isMain: true }], websites: ["https://example.invalid"], nonMailing: false, legalForm: null,
    provenance: { source: "kvk", fetchedAt: "2026-09-22T10:00:00.000Z", basisProfile: `https://api.kvk.nl/api/v1/basisprofielen/${kvk}`, establishmentProfile: `https://api.kvk.nl/api/v1/vestigingsprofielen/${est}`, matchRule: "active_trade_name_and_visit_address_v1" } };
}
const verified = (kvk?: string, est?: string): KvkVerificationResult => ({ status: "verified", identity: identity(kvk, est) });

test("Phase1 serializes only KVK identities and Place ID, never temporary candidates or scores", async () => {
  const repo = new MemoryVerifiedCandidateRepository();
  const service = new GoogleIdentityDiscoveryService({ provider: { async searchPage() { return { candidates: [temporary()], nextPageToken: null }; } }, verifier: { async verify() { return verified(); } }, repository: repo, legacyLeads: async () => [] });
  const result = await service.discover(request, "run-1");
  assert.equal(result.identity?.persisted, 1); assert.equal(result.identity?.quotaMet, false);
  assert.equal(result.identity?.stopReason, "results_exhausted"); assert.equal(result.createdLeads, 0); assert.deepEqual(result.candidates, []);
  const output = JSON.stringify([result, repo.records, [...repo.references]]);
  assert.doesNotMatch(output, /GOOGLE_SECRET|rating|reviewCount|leadScore/);
  assert.equal(repo.records[0].identity.businessName, "KVK Test Schilder");
  assert.equal(repo.references.get("google_id_1")?.kvk, "12345678");
});

test("ambiguous and unmatched do not persist or consume the requested verified quota", async () => {
  const repo = new MemoryVerifiedCandidateRepository(); let calls = 0;
  const results: KvkVerificationResult[] = [{ status: "ambiguous", reason: "MULTIPLE_MATCHES" }, { status: "unmatched", reason: "NO_MATCH" }, verified()];
  const service = new GoogleIdentityDiscoveryService({ provider: { async searchPage(_r, token) { return { candidates: token ? [temporary("g3")] : [temporary("g1"), temporary("g2")], nextPageToken: token ? null : "sensitive_token" }; } }, verifier: { async verify() { return results[calls++]; } }, repository: repo, legacyLeads: async () => [] });
  const result = await service.discover({ ...request, limit: 1 }, "run-1");
  assert.equal(result.identity?.ambiguous, 1); assert.equal(result.identity?.unmatched, 1); assert.equal(result.identity?.persisted, 1); assert.equal(result.identity?.quotaMet, true);
  assert.doesNotMatch(JSON.stringify(result), /sensitive_token|GOOGLE_SECRET/);
});

test("same KVK enterprise and different Places or branches produce one candidate", async () => {
  const repo = new MemoryVerifiedCandidateRepository(); let n = 0;
  const service = new GoogleIdentityDiscoveryService({ provider: { async searchPage() { return { candidates: [temporary("a"), temporary("b")], nextPageToken: null }; } }, verifier: { async verify() { return verified("12345678", n++ ? "000087654321" : "000012345678"); } }, repository: repo, legacyLeads: async () => [] });
  const result = await service.discover(request, "run-1");
  assert.equal(repo.records.length, 1); assert.equal(repo.references.size, 2); assert.equal(result.identity?.duplicates, 1); assert.equal(result.identity?.persisted, 1);
});

test("duplicate establishment and duplicate known lead are not inserted", async () => {
  const repo = new MemoryVerifiedCandidateRepository([{ id: "legacy-uuid", kvkNumber: "12345678", establishmentNumber: "000012345678" }]);
  assert.equal((await repo.persist({ runId: "r", identity: identity(), placeId: "one" })).status, "duplicate_lead");
  assert.equal(repo.records.length, 0);
  await assert.rejects(repo.persist({ runId: "r", identity: identity("87654321"), placeId: "two" }), /IDENTITY_CONFLICT/);
});

test("one Place ID cannot silently be reassigned to another KVK enterprise", async () => {
  const repo = new MemoryVerifiedCandidateRepository();
  await repo.persist({ runId: "r", identity: identity(), placeId: "same" });
  await assert.rejects(repo.persist({ runId: "r", identity: identity("87654321", "000087654321"), placeId: "same" }), /IDENTITY_CONFLICT/);
});

test("duplicate place within a run is never reverified", async () => {
  let calls = 0; const repo = new MemoryVerifiedCandidateRepository();
  const service = new GoogleIdentityDiscoveryService({ provider: { async searchPage() { return { candidates: [temporary(), temporary()], nextPageToken: null }; } }, verifier: { async verify() { calls++; return verified(); } }, repository: repo, legacyLeads: async () => [] });
  const result = await service.discover(request, "r"); assert.equal(calls, 1); assert.equal(result.identity?.placeDuplicates, 1);
});

test("technical_error is not unmatched; source exception text never leaves processing", async () => {
  const repo = new MemoryVerifiedCandidateRepository();
  for (const verifier of [{ async verify(): Promise<KvkVerificationResult> { return { status: "technical_error", reason: "KVK_REQUEST_FAILED" }; } }, { async verify(): Promise<KvkVerificationResult> { throw new Error("GOOGLE_SECRET_NAME apiKey=SECRET"); } }]) {
    const service = new GoogleIdentityDiscoveryService({ provider: { async searchPage() { return { candidates: [temporary()], nextPageToken: null }; } }, verifier, repository: repo, legacyLeads: async () => [] });
    const result = await service.discover(request, "r"); assert.equal(result.identity?.technicalError, 1); assert.equal(result.identity?.unmatched, 0); assert.doesNotMatch(JSON.stringify(result), /GOOGLE_SECRET|apiKey|SECRET/);
  }
  assert.equal(repo.records.length, 0);
});

test("Google exception does not enter run history and never falls back to mock", async () => {
  const repo = new MemoryVerifiedCandidateRepository();
  const service = new GoogleIdentityDiscoveryService({ provider: { async searchPage() { throw new Error("GOOGLE_SECRET errorBody"); } }, verifier: { async verify() { throw new Error("unreachable"); } }, repository: repo, legacyLeads: async () => [] });
  const result = await service.discover(request, "r"); assert.equal(result.totalFound, 0); assert.equal(result.createdLeads, 0); assert.doesNotMatch(JSON.stringify(result), /GOOGLE_SECRET|errorBody/);
});

test("strict provenance rejects raw Google properties at every persistence level", () => {
  const clean = identity(); assert.deepEqual(persistableIdentity(clean), clean);
  for (const input of [{ ...clean, googleRating: 4 }, { ...clean, metadata: temporary() }, { ...clean, provenance: { ...clean.provenance, raw: temporary() } }, { ...clean, address: { ...clean.address, rawGoogle: temporary() } }, { ...clean, provenance: { ...clean.provenance, source: "google" } }, { ...clean, kvkNumber: 12345678 }, { ...clean, provenance: { ...clean.provenance, basisProfile: "https://maps.google.com" } }]) {
    assert.throws(() => persistableIdentity(input), /^Error: INVALID_VERIFIED_IDENTITY$/);
  }
});

test("bounded loop stops on repeated page tokens without pretending the quota is met", async () => {
  const repo = new MemoryVerifiedCandidateRepository(); let pages = 0;
  const service = new GoogleIdentityDiscoveryService({ provider: { async searchPage() { pages++; return { candidates: [], nextPageToken: "repeat" }; } }, verifier: { async verify() { return verified(); } }, repository: repo, legacyLeads: async () => [] });
  const result = await service.discover(request, "r"); assert.equal(pages, 2); assert.equal(result.identity?.stopReason, "page_limit"); assert.equal(result.identity?.quotaMet, false);
});

test("unknown providers reject instead of resolving to mock", () => {
  assert.throws(() => getDiscoveryProvider("bogus" as "mock"), /UNKNOWN_DISCOVERY_PROVIDER/);
  assert.throws(() => validateDiscoveryCommand({ ownerUserId: "owner", country: "NL", city: "Eindhoven", limit: 1, source: "bogus" as "mock" }), /UNKNOWN_DISCOVERY_PROVIDER/);
  const action = readFileSync("app/(dashboard)/lead-discovery/actions.ts", "utf8");
  assert.doesNotMatch(action, /:\s*"mock"/); assert.match(action, /requireStudioOwner/);
});

test("production and configured-database contexts reject mock even with opt-in", () => {
  const old = { ...process.env };
  try {
    process.env.DISCOVERY_ALLOW_MOCK = "true"; Object.assign(process.env, { NODE_ENV: "production" });
    assert.equal(mockDiscoveryAllowed(), false); assert.throws(() => getDiscoveryProvider("mock"), /MOCK_DISCOVERY_FORBIDDEN/);
    Object.assign(process.env, { NODE_ENV: "development" }); process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
    assert.equal(mockDiscoveryAllowed(), false);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    assert.equal(mockDiscoveryAllowed(), true);
  } finally { for (const key of ["NODE_ENV", "DISCOVERY_ALLOW_MOCK", "NEXT_PUBLIC_SUPABASE_URL"]) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; } }
});

test("legacy leads stay readable with stable UUID, lifecycle and scoring behavior", async () => {
  const repository = getLeadRepository();
  const rows = await repository.list(); const before = JSON.stringify(rows);
  assert.ok(rows.length > 0);
  await new GoogleIdentityDiscoveryService().discover(request, "r");
  assert.equal(JSON.stringify(await repository.list()), before);
  assert.equal(rows[0].kvkNumber ?? null, null);
});

test("legacy duplicate hint never overwrites an old lead's identity", async () => {
  const repo = new MemoryVerifiedCandidateRepository();
  const oldLead = { id: "existing", businessName: "KVK Test Schilder", city: "Eindhoven", website: null, phone: null, email: null } as Lead;
  const snapshot = JSON.stringify(oldLead);
  const service = new GoogleIdentityDiscoveryService({ provider: { async searchPage() { return { candidates: [temporary()], nextPageToken: null }; } }, verifier: { async verify() { return verified(); } }, repository: repo, legacyLeads: async () => [oldLead] });
  const result = await service.discover(request, "r"); assert.equal(result.identity?.duplicates, 1); assert.equal(repo.records.length, 0); assert.equal(JSON.stringify(oldLead), snapshot);
});

test("additive SQL preserves lead UUIDs and has atomic uniqueness, RLS and service-only writes", () => {
  const sql = readFileSync("supabase/migrations/0026_discovery_identity_v1.sql", "utf8");
  assert.match(sql, /kvk_number text/); assert.match(sql, /establishment_number text/);
  assert.match(sql, /pg_advisory_xact_lock/); assert.match(sql, /create unique index leads_kvk_number_unique/);
  assert.match(sql, /enable row level security/); assert.match(sql, /is_studio_owner\(\)/);
  assert.match(sql, /grant execute on function public.persist_verified_discovery_candidate\(jsonb,text,uuid\) to service_role/);
  assert.doesNotMatch(sql, /delete from|truncate|update public.leads|drop table/i);
});
