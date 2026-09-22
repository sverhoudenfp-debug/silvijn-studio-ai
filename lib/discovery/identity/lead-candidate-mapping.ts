import type { DiscoveryCandidate, DiscoveryRequest } from "../types";
import type { TemporaryGoogleCandidate } from "./types";

/**
 * Zet een tijdelijke Google-kandidaat die de volledige v2-selectie doorstond
 * (geen website vermeld → begrensde officiële-websitecheck → not_found) om naar
 * het bestaande DiscoveryCandidate-contract, zodat de normale creatieketen
 * (enrichment → duplicaatcheck → websitestatus → LeadRepository.create → scoring)
 * ongewijzigd wordt hergebruikt.
 *
 * Eerlijkheidsregels:
 * - `not_found` is geen bewijs van afwezigheid; dit staat expliciet in de metadata
 *   en in de leadnotitie. Er wordt geen website, e-mail of ander feit verzonnen.
 * - Er lekken geen zoekresultaten, snippets of citations: alleen Google-identiteit
 *   (Place ID, naam, adres) en de Enterprise-signalen telefoon/rating/reviews.
 */
export const GOOGLE_NOT_FOUND_LEAD_NOTE =
  "Ontdekt via Google Places zonder vermelde website. Begrensde officiële-websitecheck: niet gevonden (geen bewijs dat er geen website bestaat). Geen e-mailadres beschikbaar uit de bron.";

export function temporaryGoogleCandidateToDiscoveryCandidate(
  candidate: TemporaryGoogleCandidate,
  request: DiscoveryRequest
): DiscoveryCandidate {
  const a = candidate.address;
  const streetLine = [a.street, [a.houseNumber, a.addition].filter(Boolean).join("")].filter(Boolean).join(" ").trim();
  return {
    externalId: `google-place:${candidate.placeId}`,
    businessName: candidate.displayName,
    industry: (request.industry ?? request.query ?? "").trim(),
    address: streetLine || null,
    postalCode: a.postalCode,
    city: (a.city ?? request.city ?? "").trim(),
    province: (a.province ?? request.province ?? "").trim(),
    country: (a.countryCode ?? request.country ?? "NL").toUpperCase(),
    phone: candidate.phone ?? null,
    email: null,
    website: null,
    websiteStatusHint: "no_website",
    source: "google",
    sourceUrl: null,
    metadata: {
      placeId: candidate.placeId,
      websiteListingStatus: candidate.websiteListingStatus,
      officialWebsiteOutcome: "not_found",
      boundedCheck: true,
      // Bestaande enrichment leest ratingHint/reviewsHint (bronclaims, geen verificatie).
      ratingHint: candidate.rating ?? null,
      reviewsHint: candidate.reviewCount ?? null,
    },
  };
}
