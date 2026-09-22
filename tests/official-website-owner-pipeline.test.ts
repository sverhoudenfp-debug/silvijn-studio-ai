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
      countryCode: "NL",
    },
  };
}

function stableLeadSnapshot(value: unknown): string {
  return JSON.stringify(value);
}

test("owner-triggered Google pipeline aggregates all four website outcomes and retains only not_found", async () => {
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
  const beforeLeads = await leadRepository.list();
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
  assert.deepEqual(result.discovery?.candidates, []);
  assert.equal(result.discovery?.createdLeads, 0);
  assert.deepEqual(result.createdLeadSummaries, []);
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
    quotaMet: false,
    stopReason: "search_budget",
  });

  const [run] = await runs.list(1);
  assert.equal(run.status, "completed");
  assert.equal(run.createdLeads, 0);
  assert.deepEqual(run.createdLeadIds, []);
  assert.deepEqual(run.summary.created, []);
  assert.deepEqual(run.summary.duplicateReasons, {});
  assert.deepEqual(run.summary.preKvk, result.discovery?.preKvk);

  const serializedRun = JSON.stringify(run);
  for (const forbidden of [
    "already-listed", "verified-private-result", "Temporary Business", "Teststraat", "3512 AB",
  ]) assert.doesNotMatch(serializedRun, new RegExp(forbidden, "i"));

  const afterLeads = await leadRepository.list();
  assert.equal(stableLeadSnapshot(afterLeads), beforeSnapshot, "normal leads and their scoring/outreach state remain untouched");
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
