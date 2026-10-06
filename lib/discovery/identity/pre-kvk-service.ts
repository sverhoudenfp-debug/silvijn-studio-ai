import "server-only";
import { OfficialWebsiteDiscoveryService, type OfficialWebsiteDiscoveryResult } from "../official-website/service";
import { OfficialWebsiteSearchError } from "../official-website/anthropic-search";
import { GooglePlacesDiscoveryProvider } from "../providers/google-places-provider";
import type { DiscoveryRequest, DiscoveryResult, GooglePreKvkSummary } from "../types";
import type { GoogleDiscoveryPage, TemporaryGoogleCandidate } from "./types";
import { assessIndustryRelevance } from "./industry-relevance";

interface Dependencies {
  provider: { searchPage(request: DiscoveryRequest, token?: string | null): Promise<GoogleDiscoveryPage> };
  officialWebsite?: { discover(candidate: TemporaryGoogleCandidate): Promise<OfficialWebsiteDiscoveryResult> };
  maxPages?: number;
  maxCandidates?: number;
}

export interface GooglePreKvkSelection {
  /** Only bounded not_found outcomes. Never serialize or persist these values. */
  temporaryCandidates: TemporaryGoogleCandidate[];
  summary: GooglePreKvkSummary;
  errors: string[];
}

/**
 * Owner-triggered, temporary Google → no listing → official website discovery.
 * Only aggregate counts leave this service. Candidate values remain in memory,
 * and there is deliberately no KVK, repository, scoring, outreach, lead creation
 * or status-transition dependency.
 */
export class GoogleNoWebsiteListedDiscoveryService {
  constructor(private readonly dependencies?: Dependencies) {}

  async discover(request: DiscoveryRequest): Promise<DiscoveryResult> {
    const started = Date.now();
    const selection = await this.select(request);
    return this.result(request, selection.summary, selection.errors, Date.now() - started);
  }

  /** Aggregate DiscoveryResult voor een selectie; bevat nooit kandidaatwaarden. */
  toResult(request: DiscoveryRequest, selection: GooglePreKvkSelection, durationMs: number): DiscoveryResult {
    return this.result(request, selection.summary, selection.errors, durationMs);
  }

  /** Internal in-memory handoff. Retains only bounded not_found outcomes. */
  async select(request: DiscoveryRequest): Promise<GooglePreKvkSelection> {
    const requested = Math.max(1, Math.min(200, Math.floor(request.limit)));
    const summary: GooglePreKvkSummary = {
      phase: "google_official_website_discovery_v2",
      requested,
      googleCandidates: 0,
      noWebsiteListed: 0,
      websiteListedSkipped: 0,
      industryMismatchSkipped: 0,
      officialWebsiteVerified: 0,
      officialWebsiteAmbiguous: 0,
      officialWebsiteNotFound: 0,
      officialWebsiteTechnicalErrors: 0,
      potentialNoWebsiteCandidates: 0,
      quotaMet: false,
      stopReason: "results_exhausted",
    };
    const errors: string[] = [];
    const unlistedCandidates: TemporaryGoogleCandidate[] = [];
    const temporaryCandidates: TemporaryGoogleCandidate[] = [];
    const failed = (): GooglePreKvkSelection => ({ temporaryCandidates, summary, errors });

    if (request.source !== "google" || request.country.toUpperCase() !== "NL") {
      errors.push("MISSING CONFIGURATION: GOOGLE_NO_WEBSITE_DISCOVERY_NOT_CONFIGURED");
      summary.stopReason = "technical_error";
      return failed();
    }

    let provider: Dependencies["provider"];
    try {
      if (!this.dependencies && !process.env.GOOGLE_PLACES_API_KEY?.trim()) throw new Error("CONFIGURATION");
      provider = this.dependencies?.provider ?? new GooglePlacesDiscoveryProvider();
    } catch {
      errors.push("MISSING CONFIGURATION: GOOGLE_NO_WEBSITE_DISCOVERY_NOT_CONFIGURED");
      summary.stopReason = "technical_error";
      return failed();
    }

    const maxPages = Math.max(1, Math.min(10, this.dependencies?.maxPages ?? 5));
    const maxCandidates = Math.max(1, Math.min(200, this.dependencies?.maxCandidates ?? 100));
    const seenPlaces = new Set<string>();
    const seenTokens = new Set<string>();
    let token: string | null = null;

    outer: for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
      let page: GoogleDiscoveryPage;
      try {
        page = await provider.searchPage(request, token);
      } catch {
        errors.push("GOOGLE_DISCOVERY_REQUEST_FAILED");
        summary.stopReason = "technical_error";
        break;
      }

      for (const candidate of page.candidates) {
        if (summary.googleCandidates >= maxCandidates) {
          summary.stopReason = "candidate_limit";
          break outer;
        }
        if (seenPlaces.has(candidate.placeId)) continue;
        seenPlaces.add(candidate.placeId);
        summary.googleCandidates++;

        // Deterministic relevance first: a provable trade mismatch never costs a
        // web search and never becomes a lead. Unknown stays in (no proof).
        if (assessIndustryRelevance(request.industry, candidate.googleTypes) === "mismatch") {
          summary.industryMismatchSkipped = (summary.industryMismatchSkipped ?? 0) + 1;
          continue;
        }

        if (candidate.websiteListingStatus === "website_listed") {
          summary.websiteListedSkipped++;
          continue;
        }

        unlistedCandidates.push(candidate);
        summary.noWebsiteListed = unlistedCandidates.length;
        // Preserve the owner command limit as the hard web-search budget:
        // never perform more than one search for each requested candidate.
        if (unlistedCandidates.length >= requested) {
          summary.stopReason = "quota_met";
          break outer;
        }
      }

      if (!page.nextPageToken) {
        summary.stopReason = "results_exhausted";
        break;
      }
      if (seenTokens.has(page.nextPageToken)) {
        summary.stopReason = "page_limit";
        break;
      }
      seenTokens.add(page.nextPageToken);
      token = page.nextPageToken;
      if (pageNumber === maxPages - 1) summary.stopReason = "page_limit";
    }

    const officialWebsite = this.dependencies?.officialWebsite ?? new OfficialWebsiteDiscoveryService();
    const websiteCheckFailures = new Map<string, number>();
    for (const candidate of unlistedCandidates) {
      let outcome: OfficialWebsiteDiscoveryResult;
      try {
        outcome = await officialWebsite.discover(candidate);
      } catch (error) {
        // Observability (2026-10-06): de exacte reden vastleggen in de run-errors,
        // zonder het gedrag te veranderen — de kandidaat blijft technical_error.
        const reason = error instanceof OfficialWebsiteSearchError ? error.code : "SEARCH_FAILED";
        const detail =
          error instanceof OfficialWebsiteSearchError
            ? error.detail ?? ""
            : (error instanceof Error ? error.message : String(error)).slice(0, 180);
        const key = detail ? `${reason}: ${detail}` : reason;
        websiteCheckFailures.set(key, (websiteCheckFailures.get(key) ?? 0) + 1);
        outcome = { status: "technical_error", reason: "SEARCH_FAILED" };
      }
      switch (outcome.status) {
        case "official_website_verified":
          summary.officialWebsiteVerified++;
          break;
        case "ambiguous":
          summary.officialWebsiteAmbiguous++;
          break;
        case "not_found":
          summary.officialWebsiteNotFound++;
          temporaryCandidates.push(candidate);
          break;
        case "technical_error": {
          summary.officialWebsiteTechnicalErrors++;
          const detail = outcome.detail ?? "";
          const key = detail ? `${outcome.reason}: ${detail}` : outcome.reason;
          websiteCheckFailures.set(key, (websiteCheckFailures.get(key) ?? 0) + 1);
          break;
        }
      }
    }

    for (const [key, count] of websiteCheckFailures) {
      errors.push(`OFFICIAL_WEBSITE_CHECK_FAILED [${key}]${count > 1 ? ` (x${count})` : ""}`);
    }
    summary.potentialNoWebsiteCandidates = temporaryCandidates.length;
    summary.quotaMet = temporaryCandidates.length >= requested;
    if (summary.stopReason === "quota_met" && !summary.quotaMet) summary.stopReason = "search_budget";
    return { temporaryCandidates, summary, errors };
  }

  private result(
    request: DiscoveryRequest,
    preKvk: GooglePreKvkSummary,
    errors: string[],
    durationMs: number
  ): DiscoveryResult {
    return {
      candidates: [],
      totalFound: preKvk.googleCandidates,
      source: "google",
      query: request,
      durationMs,
      duplicatesSkipped: 0,
      invalidCandidatesSkipped: 0,
      createdLeads: 0,
      errors,
      preKvk,
    };
  }
}
