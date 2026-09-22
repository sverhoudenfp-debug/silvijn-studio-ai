import "server-only";
import type { TemporaryGoogleCandidate } from "../identity/types";
import {
  WebsiteDiscoveryService,
  type WebsiteInspectionResult,
} from "../website-service";
import {
  AnthropicOfficialWebsiteSearch,
  OfficialWebsiteSearchError,
  type WebsiteSearchSource,
} from "./anthropic-search";

export type OfficialWebsiteDiscoveryResult =
  | {
      status: "official_website_verified";
      websiteUrl: string;
      evidence: {
        name: "structured_data" | "page_title";
        location: "postal_code" | "street_address" | "structured_city";
      };
    }
  | { status: "ambiguous"; inspectedCandidates: number }
  | { status: "not_found"; inspectedCandidates: number }
  | { status: "technical_error"; reason: "INVALID_INPUT" | "SEARCH_NOT_CONFIGURED" | "SEARCH_FAILED" };

interface Dependencies {
  search?: WebsiteSearchSource;
  inspect?: (url: string) => Promise<WebsiteInspectionResult>;
}

interface EvaluatedWebsite {
  url: string;
  verified: boolean;
  partial: boolean;
  evidence: {
    name: "structured_data" | "page_title";
    location: "postal_code" | "street_address" | "structured_city";
  } | null;
}

const BLOCKED_HOSTS = [
  "facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com", "tiktok.com",
  "youtube.com", "pinterest.com", "threads.net", "snapchat.com",
  "google.com", "google.nl", "maps.google.com", "bing.com", "yahoo.com",
  "marktplaats.nl", "bol.com", "amazon.nl", "amazon.com", "etsy.com",
  "trustpilot.com", "kvk.nl", "telefoonboek.nl", "detelefoongids.nl", "openingstijden.nl",
  "cylex.nl", "allebiz.nl", "bedrijvenpagina.nl", "bedrijvengids.nl", "indeed.com",
  "foursquare.com", "yelp.com", "tripadvisor.nl", "tripadvisor.com",
  "vindjefietsenmaker.nl", "rijwiel.net",
];

const BLOCKED_PATH_SEGMENTS = new Set([
  "profile", "profiel", "listing", "vermelding", "directory", "bedrijvengids",
  "companies", "bedrijven", "merchant", "seller", "shops",
]);

const GENERIC_NAME_TOKENS = new Set([
  "de", "het", "een", "van", "der", "den", "en", "bv", "b", "v", "vof", "cv", "nv",
  "bedrijf", "bedrijven", "nederland", "netherlands",
]);

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " en ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: string | null | undefined): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function businessTokens(name: string): string[] {
  return Array.from(new Set(
    normalizeText(name).split(" ").filter((token) => token.length >= 2 && !GENERIC_NAME_TOKENS.has(token))
  ));
}

function nameMatches(value: string | null, businessName: string): boolean {
  const normalizedValue = normalizeText(value);
  const normalizedName = normalizeText(businessName);
  if (!normalizedValue || !normalizedName) return false;
  if (normalizedValue.includes(normalizedName)) return true;
  const tokens = businessTokens(businessName);
  if (tokens.length < 2) return false;
  const matches = tokens.filter((token) => new RegExp(`(?:^| )${token}(?: |$)`).test(normalizedValue)).length;
  return matches >= 2 && matches / tokens.length >= 0.75;
}

function hostIsBlocked(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function candidateUrl(rawUrl: string): string | null {
  const normalized = WebsiteDiscoveryService.normalizeUrl(rawUrl);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (hostIsBlocked(url.hostname)) return null;
    const segments = url.pathname.toLowerCase().split("/").filter(Boolean);
    if (segments.some((segment) => BLOCKED_PATH_SEGMENTS.has(segment))) return null;
    if (/\.(?:pdf|docx?|xlsx?|jpe?g|png|gif|webp|svg)$/i.test(url.pathname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function locationEvidence(
  inspection: WebsiteInspectionResult,
  candidate: TemporaryGoogleCandidate
): {
  postal: boolean;
  street: boolean;
  city: boolean;
  structuredCity: boolean;
} {
  const visible = normalizeText(inspection.visibleText);
  const postcode = compact(candidate.address.postalCode);
  const street = normalizeText(candidate.address.street);
  const houseNumber = compact(candidate.address.houseNumber);
  const city = normalizeText(candidate.address.city);
  const structured = inspection.structuredOrganizations;
  return {
    postal: Boolean(postcode) && (
      compact(inspection.visibleText).includes(postcode) ||
      structured.some((item) => compact(item.postalCode).includes(postcode))
    ),
    street: Boolean(street && houseNumber) && (
      visible.includes(street) && compact(inspection.visibleText).includes(houseNumber) ||
      structured.some((item) => normalizeText(item.address).includes(street) && compact(item.address).includes(houseNumber))
    ),
    city: Boolean(city) && visible.includes(city),
    structuredCity: Boolean(city) && structured.some((item) => normalizeText(item.city) === city),
  };
}

function evaluate(
  url: string,
  inspection: WebsiteInspectionResult,
  candidate: TemporaryGoogleCandidate
): EvaluatedWebsite {
  const eligibleFinalUrl = candidateUrl(inspection.finalUrl ?? url);
  if (!eligibleFinalUrl || !inspection.check.reachable || inspection.check.looksBroken || !inspection.check.hasBasicHtml) {
    return { url, verified: false, partial: false, evidence: null };
  }

  const structuredName = inspection.structuredOrganizations.some((item) => nameMatches(item.name, candidate.displayName));
  const titleName = nameMatches(inspection.title, candidate.displayName);
  const visibleName = nameMatches(inspection.visibleText, candidate.displayName);
  const location = locationEvidence(inspection, candidate);

  if (structuredName && (location.postal || location.street || location.structuredCity)) {
    return {
      url: inspection.finalUrl ?? eligibleFinalUrl,
      verified: true,
      partial: true,
      evidence: {
        name: "structured_data",
        location: location.postal ? "postal_code" : location.street ? "street_address" : "structured_city",
      },
    };
  }
  if (titleName && (location.postal || location.street)) {
    return {
      url: inspection.finalUrl ?? eligibleFinalUrl,
      verified: true,
      partial: true,
      evidence: {
        name: "page_title",
        location: location.postal ? "postal_code" : "street_address",
      },
    };
  }

  return {
    url: inspection.finalUrl ?? eligibleFinalUrl,
    verified: false,
    partial: Boolean((structuredName || titleName || visibleName) && (location.city || location.structuredCity || location.postal || location.street)),
    evidence: null,
  };
}

/**
 * In-memory only. This service imports no repository, scoring, KVK, outreach,
 * lead creation or status transition code.
 */
export class OfficialWebsiteDiscoveryService {
  constructor(private readonly dependencies: Dependencies = {}) {}

  async discover(candidate: TemporaryGoogleCandidate): Promise<OfficialWebsiteDiscoveryResult> {
    if (candidate.kind !== "temporary_google" || candidate.websiteListingStatus !== "no_website_listed") {
      return { status: "technical_error", reason: "INVALID_INPUT" };
    }

    let searched: { urls: string[] };
    try {
      const search = this.dependencies.search ?? new AnthropicOfficialWebsiteSearch();
      searched = await search.search(candidate);
    } catch (error) {
      if (error instanceof OfficialWebsiteSearchError && error.code === "NOT_CONFIGURED") {
        return { status: "technical_error", reason: "SEARCH_NOT_CONFIGURED" };
      }
      return { status: "technical_error", reason: "SEARCH_FAILED" };
    }

    const candidates: string[] = [];
    const seenHosts = new Set<string>();
    for (const rawUrl of searched.urls) {
      const url = candidateUrl(rawUrl);
      if (!url) continue;
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (seenHosts.has(host)) continue;
      seenHosts.add(host);
      candidates.push(url);
      if (candidates.length === 5) break;
    }

    if (candidates.length === 0) return { status: "not_found", inspectedCandidates: 0 };

    const inspect = this.dependencies.inspect ?? ((url: string) => WebsiteDiscoveryService.inspectWebsite(url));
    const evaluated: EvaluatedWebsite[] = [];
    for (const url of candidates) {
      evaluated.push(evaluate(url, await inspect(url), candidate));
    }

    const verified = evaluated.filter((item) => item.verified);
    if (verified.length === 1 && verified[0].evidence) {
      return {
        status: "official_website_verified",
        websiteUrl: verified[0].url,
        evidence: verified[0].evidence,
      };
    }
    if (verified.length > 1 || evaluated.some((item) => item.partial)) {
      return { status: "ambiguous", inspectedCandidates: candidates.length };
    }
    return { status: "not_found", inspectedCandidates: candidates.length };
  }
}
