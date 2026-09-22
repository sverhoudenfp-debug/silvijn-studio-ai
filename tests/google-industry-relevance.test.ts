import { test } from "node:test";
import assert from "node:assert/strict";
import { assessIndustryRelevance, knownIndustryTypes, normalizeIndustryTerm } from "../lib/discovery/identity/industry-relevance";
import { GoogleNoWebsiteListedDiscoveryService } from "../lib/discovery/identity/pre-kvk-service";
import type { TemporaryGoogleCandidate } from "../lib/discovery/identity/types";

// Force the test-only in-memory repositories. Never touch production data.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function temporary(placeId: string, googleTypes?: string[]): TemporaryGoogleCandidate {
  return {
    kind: "temporary_google",
    placeId,
    displayName: `Business ${placeId}`,
    websiteUrl: null,
    websiteListingStatus: "no_website_listed",
    address: { postalCode: "5611 AA", houseNumber: "1", addition: null, street: "Kerkstraat", city: "Eindhoven", province: "Noord-Brabant", countryCode: "NL" },
    googleTypes,
  };
}

test("relevance is deterministic, closed and never invents a verdict", () => {
  assert.equal(normalizeIndustryTerm("  Schilder in Eindhoven "), "schilder");
  assert.equal(normalizeIndustryTerm("Schildersbedrijf"), "schildersbedrijf");
  assert.deepEqual(knownIndustryTypes("schilder"), ["painter"]);
  assert.equal(knownIndustryTypes("drone-inspectie"), null, "unknown industries have no registry entry");

  assert.equal(assessIndustryRelevance("schilder", ["painter", "point_of_interest"]), "relevant");
  assert.equal(assessIndustryRelevance("schilder", ["hobby_store", "store", "point_of_interest"]), "mismatch", "diamond-painting hobby shop is not a house painter");
  assert.equal(assessIndustryRelevance("schilder", []), "unknown", "no types is no proof");
  assert.equal(assessIndustryRelevance("schilder", undefined), "unknown");
  assert.equal(assessIndustryRelevance("drone-inspectie", ["store"]), "unknown", "unknown industry never excludes");
  assert.equal(assessIndustryRelevance(null, ["store"]), "unknown");
});

test("provable trade mismatches are counted, cost no web search and never become candidates", async () => {
  const searched: string[] = [];
  const service = new GoogleNoWebsiteListedDiscoveryService({
    provider: {
      async searchPage() {
        return {
          candidates: [
            temporary("hobby", ["hobby_store", "store"]),
            temporary("real-painter", ["painter", "point_of_interest"]),
            temporary("untyped"),
          ],
          nextPageToken: null,
        };
      },
    },
    officialWebsite: {
      async discover(candidate) {
        searched.push(candidate.placeId);
        return { status: "not_found", reason: "NO_OFFICIAL_WEBSITE_FOUND" } as never;
      },
    },
  });

  const selection = await service.select({ country: "NL", city: "Eindhoven", industry: "schilder", source: "google", limit: 5 });
  assert.equal(selection.summary.googleCandidates, 3);
  assert.equal(selection.summary.industryMismatchSkipped, 1);
  assert.deepEqual(searched.sort(), ["real-painter", "untyped"], "exactly one search per retained candidate, none for the mismatch");
  assert.deepEqual(selection.temporaryCandidates.map((c) => c.placeId).sort(), ["real-painter", "untyped"]);
  assert.equal(selection.summary.noWebsiteListed, 2);
  assert.equal(selection.summary.officialWebsiteNotFound, 2);
  assert.deepEqual(selection.errors, []);
});

test("without an industry in the owner command nothing is excluded", async () => {
  const service = new GoogleNoWebsiteListedDiscoveryService({
    provider: { async searchPage() { return { candidates: [temporary("hobby", ["hobby_store"])], nextPageToken: null }; } },
    officialWebsite: { async discover() { return { status: "not_found", reason: "NO_OFFICIAL_WEBSITE_FOUND" } as never; } },
  });
  const selection = await service.select({ country: "NL", city: "Eindhoven", source: "google", limit: 1 });
  assert.equal(selection.summary.industryMismatchSkipped, 0);
  assert.equal(selection.temporaryCandidates.length, 1);
});
