import "server-only";
import { GooglePlacesDiscoveryProvider } from "../providers/google-places-provider";
import type { DiscoveryRequest, DiscoveryResult, GooglePreKvkSummary } from "../types";
import type { GoogleDiscoveryPage, TemporaryGoogleCandidate } from "./types";

interface Dependencies {
  provider: { searchPage(request: DiscoveryRequest, token?: string | null): Promise<GoogleDiscoveryPage> };
  maxPages?: number;
  maxCandidates?: number;
}

export interface GooglePreKvkSelection {
  temporaryCandidates: TemporaryGoogleCandidate[];
  summary: GooglePreKvkSummary;
  errors: string[];
}

/**
 * Temporary Google-only selection step. The discovery result records counts,
 * never candidate values, and deliberately has no KVK, repository,
 * website-analysis, scoring, outreach or lead-creation dependency.
 */
export class GoogleNoWebsiteListedDiscoveryService {
  constructor(private readonly dependencies?: Dependencies) {}

  async discover(request: DiscoveryRequest): Promise<DiscoveryResult> {
    const started = Date.now();
    const selection = await this.select(request);
    return this.result(
      request,
      selection.summary,
      selection.errors,
      Date.now() - started
    );
  }

  /** Internal in-memory handoff. Callers must not persist or serialize it. */
  async select(request: DiscoveryRequest): Promise<GooglePreKvkSelection> {
    const requested = Math.max(1, Math.min(200, Math.floor(request.limit)));
    const summary: GooglePreKvkSummary = {
      phase: "google_no_website_listed_v1",
      requested,
      googleCandidates: 0,
      noWebsiteListed: 0,
      websiteListedSkipped: 0,
      quotaMet: false,
      stopReason: "results_exhausted",
    };
    const errors: string[] = [];
    const temporaryCandidates: TemporaryGoogleCandidate[] = [];
    const failed = (): GooglePreKvkSelection => ({ temporaryCandidates, summary, errors });

    if (request.source !== "google" || request.country.toUpperCase() !== "NL") {
      errors.push("MISSING CONFIGURATION: GOOGLE_NO_WEBSITE_DISCOVERY_NOT_CONFIGURED");
      summary.stopReason = "technical_error";
      return failed();
    }

    let provider: Dependencies["provider"];
    try {
      if (!this.dependencies && !process.env.GOOGLE_PLACES_API_KEY?.trim()) {
        throw new Error("CONFIGURATION");
      }
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

        if (candidate.websiteListingStatus === "website_listed") {
          summary.websiteListedSkipped++;
          continue;
        }

        temporaryCandidates.push(candidate);
        summary.noWebsiteListed = temporaryCandidates.length;
        if (temporaryCandidates.length >= requested) {
          summary.quotaMet = true;
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
