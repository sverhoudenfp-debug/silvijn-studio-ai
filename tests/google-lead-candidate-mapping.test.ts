import { test } from "node:test";
import assert from "node:assert/strict";
import { GOOGLE_NOT_FOUND_LEAD_NOTE, temporaryGoogleCandidateToDiscoveryCandidate } from "../lib/discovery/identity/lead-candidate-mapping";
import { enrichCandidate } from "../lib/discovery/enrichment";
import type { TemporaryGoogleCandidate } from "../lib/discovery/identity/types";
import type { DiscoveryRequest } from "../lib/discovery/types";

const request: DiscoveryRequest = { country: "NL", city: "Eindhoven", industry: "schilder", limit: 5, source: "google" };

function candidate(overrides: Partial<TemporaryGoogleCandidate> = {}): TemporaryGoogleCandidate {
  return {
    kind: "temporary_google",
    placeId: "ChIJabc123",
    displayName: "Schildersbedrijf De Kwast",
    websiteUrl: null,
    websiteListingStatus: "no_website_listed",
    address: { postalCode: "5611 AA", houseNumber: "12", addition: "A", street: "Kerkstraat", city: "Eindhoven", province: "Noord-Brabant", countryCode: "NL" },
    phone: "040 123 4567",
    rating: 4.7,
    reviewCount: 23,
    ...overrides,
  };
}

test("bounded not_found candidate maps onto the existing DiscoveryCandidate contract without inventing facts", () => {
  const mapped = temporaryGoogleCandidateToDiscoveryCandidate(candidate(), request);
  assert.equal(mapped.externalId, "google-place:ChIJabc123");
  assert.equal(mapped.businessName, "Schildersbedrijf De Kwast");
  assert.equal(mapped.address, "Kerkstraat 12A");
  assert.equal(mapped.postalCode, "5611 AA");
  assert.equal(mapped.city, "Eindhoven");
  assert.equal(mapped.province, "Noord-Brabant");
  assert.equal(mapped.country, "NL");
  assert.equal(mapped.phone, "040 123 4567");
  assert.equal(mapped.email, null, "Google never provides email; nothing is guessed");
  assert.equal(mapped.website, null);
  assert.equal(mapped.websiteStatusHint, "no_website");
  assert.equal(mapped.source, "google");
  assert.equal(mapped.sourceUrl, null);
  assert.deepEqual(mapped.metadata, {
    placeId: "ChIJabc123",
    websiteListingStatus: "no_website_listed",
    officialWebsiteOutcome: "not_found",
    boundedCheck: true,
    ratingHint: 4.7,
    reviewsHint: 23,
  });
  // No search results, snippets, citations or URLs travel with the candidate.
  assert.doesNotMatch(JSON.stringify(mapped), /https?:\/\/|snippet|citation/i);
  assert.match(GOOGLE_NOT_FOUND_LEAD_NOTE, /geen bewijs dat er geen website bestaat/i);
});

test("missing signals stay null and the existing enrichment carries rating/review hints through", () => {
  const mapped = temporaryGoogleCandidateToDiscoveryCandidate(
    candidate({ phone: undefined, rating: undefined, reviewCount: undefined, address: { postalCode: null, houseNumber: null, addition: null, street: null, city: null, countryCode: null } }),
    { ...request, province: "Noord-Brabant" }
  );
  assert.equal(mapped.phone, null);
  assert.equal(mapped.address, null);
  assert.equal(mapped.city, "Eindhoven", "falls back to the owner request city only");
  assert.equal(mapped.province, "Noord-Brabant", "falls back to the owner request province only");
  assert.equal(mapped.metadata.ratingHint, null);
  const enriched = enrichCandidate(temporaryGoogleCandidateToDiscoveryCandidate(candidate(), request));
  assert.equal(enriched.ok, true);
  assert.equal(enriched.candidate?.googleRating, 4.7);
  assert.equal(enriched.candidate?.reviewCount, 23);
  assert.equal(enriched.candidate?.email, null);
});

test("without any province the existing enrichment rejects the candidate instead of guessing", () => {
  const mapped = temporaryGoogleCandidateToDiscoveryCandidate(
    candidate({ address: { postalCode: "5611 AA", houseNumber: "1", addition: null, street: "Kerkstraat", city: "Eindhoven", countryCode: "NL" } }),
    request
  );
  const enriched = enrichCandidate(mapped);
  assert.equal(enriched.ok, false);
  assert.match(enriched.invalidReason ?? "", /provincie/i);
});
