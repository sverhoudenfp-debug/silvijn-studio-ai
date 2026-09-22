import { test } from "node:test";
import assert from "node:assert/strict";
import { DiscoveryOrchestrator } from "../lib/discovery/orchestrator";
import { GoogleNoWebsiteListedDiscoveryService } from "../lib/discovery/identity/pre-kvk-service";
import type { TemporaryGoogleCandidate } from "../lib/discovery/identity/types";
import type { OfficialWebsiteDiscoveryResult } from "../lib/discovery/official-website/service";
import { LeadDiscoveryService } from "../lib/discovery/service";
import { MockDiscoveryRunRepository } from "../lib/repositories/discovery-run-repository";
import { getLeadRepository } from "../lib/repositories/lead-repository";

// Force the test-only in-memory repositories. Never touch production data.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function temporary(placeId: string, listed = false): TemporaryGoogleCandidate {
  return {
    kind: "temporary_google",
    placeId,
    displayName: `Temporary Business ${placeId}`,
    websiteUrl: listed ? `https://${placeId}.example.nl` : null,
    websiteListingStatus: listed ? "website_listed" : "no_website_listed",
    address: {
      postalCode: "3512 AB",
      houseNumber: "12",
      addition: null,
      street: "Teststraat",
      city: "Utrecht",
      province: "Utrecht",
      countryCode: "NL",
    },
    phone: placeId === "missing" ? "030 123 4567" : null,
    rating: placeId === "missing" ? 4.6 : null,
    reviewCount: placeId === "missing" ? 31 : null,
  };
}

function stableLeadSnapshot(value: unknown): string {
  return JSON.stringify(value);
}

test("owner-triggered Google pipeline aggregates all four website outcomes and creates leads only from bounded not_found", async () => {
  const runs = new MockDiscoveryRunRepository();
  const outcomes: Record<string, OfficialWebsiteDiscoveryResult> = {
    verified: {
      status: "official_website_verified",
      websiteUrl: "https://verified-private-result.example.nl/",
      evidence: { name: "structured_data", location: "postal_code" },
    },
    ambiguous: { status: "ambiguous", inspectedCandidates: 2 },
    missing: { status: "not_found", inspectedCandidates: 3 },
    technical: { status: "technical_error", reason: "SEARCH_FAILED" },
  };
  const officialCalls: string[] = [];
  let googleCalls = 0;
  const google = new GoogleNoWebsiteListedDiscoveryService({
    provider: {
      async searchPage() {
        googleCalls++;
        return {
          candidates: [
            temporary("already-listed", true),
            temporary("verified"),
            temporary("ambiguous"),
            temporary("missing"),
            temporary("technical"),
          ],
          nextPageToken: "must-not-be-used-after-owner-limit",
        };
      },
    },
    officialWebsite: {
      async discover(candidate) {
        officialCalls.push(candidate.placeId);
        return outcomes[candidate.placeId];
      },
    },
  });
  const discovery = new LeadDiscoveryService({ google });
  const orchestrator = new DiscoveryOrchestrator(runs, discovery);
  const leadRepository = getLeadRepository();
  const beforeLeads = [...(await leadRepository.list())]; // copy: the memory repository returns its live array
  const beforeSnapshot = stableLeadSnapshot(beforeLeads);

  const result = await orchestrator.runCommand({
    ownerUserId: "10000000-0000-4000-8000-0000000000d1",
    country: "NL",
    city: "Utrecht",
    industry: "Schilder",
    source: "google",
    limit: 4,
  });

  assert.equal(result.status, "completed");
  assert.equal(googleCalls, 1, "existing owner limit stops Google pagination after four unlisted candidates");
  assert.deepEqual(officialCalls, ["verified", "ambiguous", "missing", "technical"]);
  // Only the bounded not_found candidate enters the existing enrich → dedupe → create → score chain.
  assert.equal(result.discovery?.candidates.length, 1);
  assert.equal(result.discovery?.candidates[0]?.status, "created");
  assert.equal(result.discovery?.candidates[0]?.websiteStatus, "no_website");
  assert.equal(result.discovery?.candidates[0]?.candidate.externalId, "google-place:missing");
  assert.equal(result.discovery?.candidates[0]?.candidate.email, null, "no email is ever invented");
  assert.equal(result.discovery?.createdLeads, 1);
  assert.equal(result.createdLeadSummaries.length, 1);
  assert.equal(result.createdLeadSummaries[0]?.businessName, "Temporary Business missing");
  assert.ok(result.createdLeadSummaries[0]!.score > 0, "existing scoring ran on create");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.discovery?.preKvk, {
    phase: "google_official_website_discovery_v2",
    requested: 4,
    googleCandidates: 5,
    noWebsiteListed: 4,
    websiteListedSkipped: 1,
    officialWebsiteVerified: 1,
    officialWebsiteAmbiguous: 1,
    officialWebsiteNotFound: 1,
    officialWebsiteTechnicalErrors: 1,
    potentialNoWebsiteCandidates: 1,
    leadsCreated: 1,
    quotaMet: false,
    stopReason: "search_budget",
  });

  const [run] = await runs.list(1);
  assert.equal(run.status, "completed");
  assert.equal(run.createdLeads, 1);
  assert.equal(run.createdLeadIds.length, 1);
  assert.equal(run.summary.created.length, 1);
  assert.deepEqual(run.summary.duplicateReasons, {});
  assert.deepEqual(run.summary.preKvk, result.discovery?.preKvk);

  // Listed, verified, ambiguous and technical_error candidates never reach the run record,
  // and no search results, URLs or raw address lines are persisted.
  const serializedRun = JSON.stringify(run);
  for (const forbidden of [
    "already-listed", "verified-private-result", "Temporary Business verified", "Temporary Business ambiguous",
    "Temporary Business technical", "Teststraat", "3512 AB", "https://",
  ]) assert.doesNotMatch(serializedRun, new RegExp(forbidden, "i"));

  const afterLeads = await leadRepository.list();
  assert.equal(afterLeads.length, beforeLeads.length + 1, "exactly one new lead");
  const created = afterLeads.find((lead) => lead.id === run.createdLeadIds[0]);
  assert.ok(created);
  assert.equal(created.websiteStatus, "no_website");
  assert.equal(created.email, null);
  assert.equal(created.phone, "030 123 4567");
  assert.equal(created.googleRating, 4.6);
  assert.equal(created.reviewCount, 31);
  assert.equal(created.leadStatus, "new");
  assert.match(created.notes.join(" "), /geen bewijs dat er geen website bestaat/i);
  const untouched = afterLeads.filter((lead) => lead.id !== created.id);
  assert.equal(stableLeadSnapshot(untouched), beforeSnapshot, "existing leads and their scoring/outreach state remain untouched");
});

test("technical website outcomes are aggregate-only and never become potential no-website candidates", async () => {
  const service = new GoogleNoWebsiteListedDiscoveryService({
    provider: {
      async searchPage() {
        return { candidates: [temporary("technical-only")], nextPageToken: null };
      },
    },
    officialWebsite: {
      async discover() { return { status: "technical_error", reason: "SEARCH_FAILED" }; },
    },
  });

  const selection = await service.select({
    country: "NL",
    city: "Utrecht",
    source: "google",
    limit: 1,
  });
  assert.deepEqual(selection.temporaryCandidates, []);
  assert.equal(selection.summary.officialWebsiteTechnicalErrors, 1);
  assert.equal(selection.summary.potentialNoWebsiteCandidates, 0);
  assert.equal(selection.summary.officialWebsiteNotFound, 0);
  assert.deepEqual(selection.errors, []);
});
