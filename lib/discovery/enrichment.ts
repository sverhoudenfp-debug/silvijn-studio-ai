import type { DiscoveryCandidate } from "./types";
import { WebsiteDiscoveryService } from "./website-service";

/**
 * Enrichment — maakt van een ruwe discovery-kandidaat Lead-compatible data.
 * Normaliseren zonder te gokken: ontbrekende data blijft null/unknown.
 */

export interface EnrichedCandidate {
  businessName: string;
  industry: string;
  address: string | null;
  postalCode: string | null;
  city: string;
  province: string;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  sourceUrl: string | null;
  externalId: string | null;
  googleRating: number | null;
  reviewCount: number | null;
}

export interface EnrichmentResult {
  ok: boolean;
  candidate: EnrichedCandidate | null;
  invalidReason?: string;
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed : null;
}

export function enrichCandidate(candidate: DiscoveryCandidate): EnrichmentResult {
  const businessName = cleanText(candidate.businessName);
  const city = cleanText(candidate.city);
  const province = cleanText(candidate.province);
  const industry = cleanText(candidate.industry);
  const country = cleanText(candidate.country) ?? "Nederland";

  if (!businessName) return { ok: false, candidate: null, invalidReason: "bedrijfsnaam ontbreekt" };
  if (!city) return { ok: false, candidate: null, invalidReason: "stad ontbreekt" };
  if (!province) return { ok: false, candidate: null, invalidReason: "provincie ontbreekt" };
  if (!industry) return { ok: false, candidate: null, invalidReason: "branche ontbreekt" };

  const website = WebsiteDiscoveryService.normalizeUrl(candidate.website);
  if (candidate.website && candidate.website.trim() && !website) {
    return { ok: false, candidate: null, invalidReason: "ongeldige website-URL" };
  }

  const email = cleanText(candidate.email)?.toLowerCase() ?? null;
  const phone = cleanText(candidate.phone);

  const ratingHint = typeof candidate.metadata.ratingHint === "number" ? candidate.metadata.ratingHint : null;
  const reviewsHint = typeof candidate.metadata.reviewsHint === "number" ? candidate.metadata.reviewsHint : null;

  return {
    ok: true,
    candidate: {
      businessName,
      industry,
      address: cleanText(candidate.address),
      postalCode: cleanText(candidate.postalCode),
      city,
      province,
      country,
      phone,
      email,
      website,
      sourceUrl: WebsiteDiscoveryService.normalizeUrl(candidate.sourceUrl),
      externalId: cleanText(candidate.externalId),
      googleRating: ratingHint,
      reviewCount: reviewsHint,
    },
  };
}
