import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GooglePlacesDiscoveryProvider } from "../lib/discovery/providers/google-places-provider";
import { GoogleNoWebsiteListedDiscoveryService } from "../lib/discovery/identity/pre-kvk-service";
import { LeadDiscoveryService } from "../lib/discovery/service";
import type { DiscoveryRequest } from "../lib/discovery/types";
import type { TemporaryGoogleCandidate } from "../lib/discovery/identity/types";

const request: DiscoveryRequest = {
  country: "NL",
  city: "Eindhoven",
  industry: "schilder",
  limit: 2,
  source: "google",
};

function googleResponse(websiteUri?: unknown): Response {
  return new Response(JSON.stringify({
    places: [{
      id: "place_1",
      displayName: { text: "Test Schilder" },
      ...(websiteUri !== undefined ? { websiteUri } : {}),
      addressComponents: [
        { longText: "Eindhoven", shortText: "Eindhoven", types: ["locality"] },
        { longText: "Nederland", shortText: "NL", types: ["country"] },
      ],
    }],
  }), { status: 200 });
}

async function mapWebsite(websiteUri?: unknown): Promise<TemporaryGoogleCandidate> {
  const provider = new GooglePlacesDiscoveryProvider({
    apiKey: "test-key",
    fetcher: async () => googleResponse(websiteUri),
  });
  return (await provider.searchPage(request)).candidates[0];
}

test("website present maps to website_listed with a usable URL", async () => {
  const candidate = await mapWebsite("https://example.nl/contact");
  assert.equal(candidate.websiteUrl, "https://example.nl/contact");
  assert.equal(candidate.websiteListingStatus, "website_listed");
});

test("website missing maps conservatively to no_website_listed", async () => {
  const candidate = await mapWebsite();
  assert.equal(candidate.websiteUrl, null);
  assert.equal(candidate.websiteListingStatus, "no_website_listed");
});

test("empty or invalid website values are not treated as usable listings", async () => {
  for (const value of ["", "   ", "not a url", "javascript:alert(1)"]) {
    const candidate = await mapWebsite(value);
    assert.equal(candidate.websiteUrl, null);
    assert.equal(candidate.websiteListingStatus, "no_website_listed");
  }
});

function temporary(placeId: string, listed: boolean): TemporaryGoogleCandidate {
  return {
    kind: "temporary_google",
    placeId,
    displayName: `Temporary ${placeId}`,
    websiteUrl: listed ? `https://${placeId}.example` : null,
    websiteListingStatus: listed ? "website_listed" : "no_website_listed",
    address: {
      postalCode: "5611 AA",
      houseNumber: "1",
      addition: null,
      street: "Teststraat",
      city: "Eindhoven",
      countryCode: "NL",
    },
  };
}

test("pre-KVK step keeps only no_website_listed candidates and records counts only", async () => {
  const service = new GoogleNoWebsiteListedDiscoveryService({
    provider: {
      async searchPage() {
        return {
          candidates: [temporary("listed", true), temporary("missing-1", false), temporary("missing-2", false)],
          nextPageToken: null,
        };
      },
    },
    officialWebsite: {
      async discover() { return { status: "not_found" as const, inspectedCandidates: 0 }; },
    },
  });

  const selection = await service.select(request);
  assert.deepEqual(selection.temporaryCandidates.map((candidate) => candidate.placeId), ["missing-1", "missing-2"]);
  assert.ok(selection.temporaryCandidates.every((candidate) => candidate.websiteListingStatus === "no_website_listed"));
  assert.deepEqual(selection.summary, {
    phase: "google_official_website_discovery_v2",
    requested: 2,
    googleCandidates: 3,
    noWebsiteListed: 2,
    websiteListedSkipped: 1,
    officialWebsiteVerified: 0,
    officialWebsiteAmbiguous: 0,
    officialWebsiteNotFound: 2,
    officialWebsiteTechnicalErrors: 0,
    potentialNoWebsiteCandidates: 2,
    quotaMet: true,
    stopReason: "quota_met",
  });

  const result = await service.discover(request);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.createdLeads, 0);
  assert.doesNotMatch(JSON.stringify(result), /Temporary listed|Temporary missing|https:\/\//);
});

test("production Google branch stops before KVK, repositories, lead creation, scoring and outreach", async () => {
  const google = new GoogleNoWebsiteListedDiscoveryService({
    provider: {
      async searchPage() {
        return { candidates: [temporary("missing-production", false)], nextPageToken: null };
      },
    },
    officialWebsite: {
      async discover() { return { status: "not_found" as const, inspectedCandidates: 0 }; },
    },
  });
  const result = await new LeadDiscoveryService({ google }).discover(
    { ...request, limit: 1 },
    { runId: "run-not-used" }
  );
  assert.equal(result.preKvk?.noWebsiteListed, 1);
  assert.equal(result.preKvk?.officialWebsiteNotFound, 1);
  assert.equal(result.preKvk?.potentialNoWebsiteCandidates, 1);
  assert.equal(result.preKvk?.quotaMet, true);
  assert.equal(result.createdLeads, 0);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.errors, []);

  const source = readFileSync(new URL("../lib/discovery/identity/pre-kvk-service.ts", import.meta.url), "utf8");
  const importPaths = Array.from(source.matchAll(/from ["']([^"']+)["']/g), (match) => match[1]).join("\n");
  assert.doesNotMatch(importPaths, /kvk|repositor|scor|outreach/i);
  assert.doesNotMatch(source, /\.(create|persist|verify|determineStatus|score|send)\s*\(/);
});
