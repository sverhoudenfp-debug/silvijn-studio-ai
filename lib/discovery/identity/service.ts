import "server-only";
import { GooglePlacesDiscoveryProvider } from "../providers/google-places-provider";
import { KvkIdentityVerifier } from "./kvk-verifier";
import type { DiscoveryRequest, DiscoveryResult } from "../types";
import type { GoogleDiscoveryPage, KvkVerifier } from "./types";
import { persistableIdentity, validPlaceId, type IdentityDiscoverySummary, type VerifiedCandidateRepository } from "./persistence";
import { getVerifiedCandidateRepository } from "@/lib/repositories/verified-candidate-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { findDuplicate } from "../duplicate-detector";
import type { Lead } from "@/lib/types";

interface Dependencies {
  provider: { searchPage(request: DiscoveryRequest, token?: string | null): Promise<GoogleDiscoveryPage> };
  verifier: KvkVerifier;
  repository: VerifiedCandidateRepository;
  legacyLeads: () => Promise<Lead[]>;
  now?: () => number;
  maxPages?: number;
  maxCandidates?: number;
  timeLimitMs?: number;
}
/** Phase 1 has no website, scoring, AI, contact enrichment or lead creation dependency. */
export class GoogleIdentityDiscoveryService {
  constructor(private readonly dependencies?: Dependencies) {}
  async discover(request: DiscoveryRequest, runId: string): Promise<DiscoveryResult> {
    const clock = this.dependencies?.now ?? Date.now;
    const started = clock();
    const requested = Math.max(1, Math.min(200, Math.floor(request.limit)));
    const summary: IdentityDiscoverySummary = {
      phase: "identity_v1", verified: 0, persisted: 0, ambiguous: 0, unmatched: 0, technicalError: 0,
      duplicates: 0, placeDuplicates: 0, requested, quotaMet: false, stopReason: "results_exhausted", candidateIds: [], reasons: {},
    };
    const errors: string[] = [];
    let found = 0;
    const count = (reason: string) => { summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1; };
    const fail = (code: string) => { errors.push(code); summary.technicalError++; count(code); summary.stopReason = "technical_error"; };
    let deps: Dependencies;
    try {
      if (request.source !== "google" || request.country.toUpperCase() !== "NL" || !runId) throw new Error("CONFIGURATION");
      if (!this.dependencies && (!process.env.GOOGLE_PLACES_API_KEY?.trim() || !process.env.KVK_API_KEY?.trim())) throw new Error("CONFIGURATION");
      deps = this.dependencies ?? {
        provider: new GooglePlacesDiscoveryProvider(), verifier: new KvkIdentityVerifier(),
        repository: getVerifiedCandidateRepository(), legacyLeads: () => getLeadRepository().list(),
      };
    } catch {
      fail("MISSING CONFIGURATION: IDENTITY_DISCOVERY_NOT_CONFIGURED");
      return this.result(request, summary, found, errors, clock() - started);
    }
    let legacy: Lead[];
    try { legacy = (await deps.legacyLeads()).filter(lead => !lead.kvkNumber); }
    catch { fail("EXISTING_LEADS_READ_FAILED"); return this.result(request, summary, found, errors, clock() - started); }
    const seenPlaces = new Set<string>();
    const seenTokens = new Set<string>();
    let token: string | null = null;
    const maxPages = Math.max(1, Math.min(10, deps.maxPages ?? 5));
    const maxCandidates = Math.max(1, Math.min(200, deps.maxCandidates ?? 100));
    const deadline = started + Math.max(1, Math.min(180_000, deps.timeLimitMs ?? 120_000));
    outer: for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
      if (clock() >= deadline) { summary.stopReason = "time_limit"; break; }
      let page: GoogleDiscoveryPage;
      try { page = await deps.provider.searchPage(request, token); }
      catch { fail("GOOGLE_DISCOVERY_REQUEST_FAILED"); break; }
      for (const temporary of page.candidates) {
        if (found >= maxCandidates) { summary.stopReason = "candidate_limit"; break outer; }
        if (clock() >= deadline) { summary.stopReason = "time_limit"; break outer; }
        found++;
        let placeId: string;
        try { placeId = validPlaceId(temporary.placeId); }
        catch { fail("GOOGLE_INVALID_DISCOVERY_REFERENCE"); break outer; }
        if (seenPlaces.has(placeId)) { summary.placeDuplicates++; count("DUPLICATE_PLACE_ID"); continue; }
        seenPlaces.add(placeId);
        try {
          const result = await deps.verifier.verify(temporary);
          if (result.status === "technical_error") { fail(result.reason); break outer; }
          if (result.status === "unmatched" || result.status === "ambiguous") {
            summary[result.status]++; count(result.reason); continue;
          }
          const identity = persistableIdentity(result.identity);
          summary.verified++;
          // Conservative legacy duplicate hint, only on independently fetched KVK values.
          // Do not silently retrofit a KVK identity onto old records.
          const possibleLegacy = findDuplicate({ candidate: {
            externalId: null, businessName: identity.businessName, industry: "", address: null,
            postalCode: identity.address.postalCode, city: identity.address.city, province: "", country: "NL",
            phone: null, email: null, website: identity.websites[0] ?? null,
            websiteStatusHint: null, source: "directory", sourceUrl: null, metadata: {},
          }, existingLeads: legacy, batchLeads: [] });
          if (possibleLegacy) { summary.duplicates++; count("POSSIBLE_LEGACY_DUPLICATE"); continue; }
          const stored = await deps.repository.persist({ runId, identity, placeId });
          if (stored.status !== "created") { summary.duplicates++; count(stored.status === "duplicate_lead" ? "DUPLICATE_KVK_LEAD" : "DUPLICATE_KVK_CANDIDATE"); continue; }
          if (!stored.candidateId) throw new Error("PERSISTENCE_FAILED");
          summary.persisted++;
          summary.candidateIds.push(stored.candidateId);
          if (summary.persisted >= requested) { summary.quotaMet = true; summary.stopReason = "quota_met"; break outer; }
        } catch {
          // No exception serialization: provider errors can contain the temporary candidate.
          fail("IDENTITY_PROCESSING_FAILED"); break outer;
        }
      }
      if (!page.nextPageToken) { summary.stopReason = "results_exhausted"; break; }
      if (seenTokens.has(page.nextPageToken)) { summary.stopReason = "page_limit"; break; }
      seenTokens.add(page.nextPageToken);
      token = page.nextPageToken;
      if (pageNumber === maxPages - 1) summary.stopReason = "page_limit";
    }
    return this.result(request, summary, found, errors, clock() - started);
  }
  private result(request: DiscoveryRequest, identity: IdentityDiscoverySummary, found: number, errors: string[], durationMs: number): DiscoveryResult {
    return { candidates: [], totalFound: found, source: "google", query: request, durationMs,
      duplicatesSkipped: identity.duplicates + identity.placeDuplicates, invalidCandidatesSkipped: identity.ambiguous + identity.unmatched,
      createdLeads: 0, errors, identity };
  }
}
