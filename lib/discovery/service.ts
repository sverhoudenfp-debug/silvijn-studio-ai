import { GoogleNoWebsiteListedDiscoveryService } from "./identity/pre-kvk-service";
import type { Lead } from "@/lib/types";
import { getLeadRepository, type LeadCreateInput } from "@/lib/repositories/lead-repository";
import { enrichCandidate } from "./enrichment";
import { findDuplicate, type DuplicateSignal } from "./duplicate-detector";
import { getDiscoveryProvider } from "./providers";
import type {
  DiscoveryCandidate,
  DiscoveryCandidateResult,
  DiscoveryRequest,
  DiscoveryResult,
} from "./types";
import { WebsiteDiscoveryService } from "./website-service";

/**
 * LeadDiscoveryService — de gecontroleerde discovery-engine (Fase 5).
 *
 * Pipeline: SEARCH → ENRICH → DUPLICATE CHECK → WEBSITE STATUS → LEAD CREATION.
 * Alleen expliciet aangeroepen (server action); geen cron, geen loops, geen bulk-AI.
 * Werkt volledig ZONDER Anthropic — AI-assisted enrichment kan later optioneel.
 *
 * Veiligheid: limit wordt afgetopt tot MAX_DISCOVERY_RESULTS (default 50);
 * provider-fouten worden veilig afgevangen en als foutmelding (geen internals)
 * in het resultaat gezet.
 */

export function getMaxDiscoveryResults(): number {
  const parsed = Number.parseInt(process.env.MAX_DISCOVERY_RESULTS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
}

function logDiscoveryEvent(event: string, data: Record<string, unknown>): void {
  // Veilig log-formaat: alleen filters en tellingen, geen persoonsgegevens.
  console.info(`[Discovery] ${event} ${JSON.stringify(data)}`);
}

const DUPLICATE_LABELS: Record<DuplicateSignal, string> = {
  duplicate_website: "Website bestaat al op een lead",
  duplicate_email: "E-mail bestaat al op een lead",
  duplicate_phone: "Telefoonnummer bestaat al op een lead",
  duplicate_business_city: "Zelfde bedrijfsnaam + stad bestaat al",
  duplicate_source_id: "Extern bron-ID is al verwerkt",
};

export class LeadDiscoveryService {
  async discover(request: DiscoveryRequest, context?: { runId: string }): Promise<DiscoveryResult> {
    void context; // Reserved for run-scoped phases; pre-KVK selection persists no candidates.
    const started = Date.now();
    const max = getMaxDiscoveryResults();
    const limit = Math.max(1, Math.min(request.limit, max));
    const effectiveRequest: DiscoveryRequest = { ...request, limit, country: request.country || "NL" };

    const source = effectiveRequest.source;
    if (source === "google") return new GoogleNoWebsiteListedDiscoveryService().discover(effectiveRequest);
    const provider = getDiscoveryProvider(source);
    const errors: string[] = [];
    const candidates: DiscoveryCandidateResult[] = [];

    logDiscoveryEvent("DISCOVERY_STARTED", {
      source: provider.id,
      country: effectiveRequest.country,
      city: effectiveRequest.city ?? null,
      province: effectiveRequest.province ?? null,
      industry: effectiveRequest.industry ?? null,
      limit,
    });

    let found: DiscoveryCandidate[] = [];
    try {
      found = await provider.search(effectiveRequest);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Onbekende providerfout";
      errors.push(message);
      logDiscoveryEvent("DISCOVERY_FAILED", { source: provider.id, reason: "provider" });
      return {
        candidates: [],
        totalFound: 0,
        source: provider.id,
        query: effectiveRequest,
        durationMs: Date.now() - started,
        duplicatesSkipped: 0,
        invalidCandidatesSkipped: 0,
        createdLeads: 0,
        errors,
      };
    }

    const leadRepository = getLeadRepository();
    let existingLeads: Lead[] = [];
    try {
      existingLeads = await leadRepository.list();
    } catch {
      errors.push("Bestaande leads konden niet worden geladen");
      logDiscoveryEvent("DISCOVERY_FAILED", { source: provider.id, reason: "repository" });
      return {
        candidates: [],
        totalFound: found.length,
        source: provider.id,
        query: effectiveRequest,
        durationMs: Date.now() - started,
        duplicatesSkipped: 0,
        invalidCandidatesSkipped: 0,
        createdLeads: 0,
        errors,
      };
    }

    const batchLeads: Lead[] = [];
    let duplicatesSkipped = 0;
    let invalidCandidatesSkipped = 0;
    let createdLeads = 0;

    for (const candidate of found) {
      try {
        // 1) Enrichment + validatie
        const enriched = enrichCandidate(candidate);
        if (!enriched.ok || !enriched.candidate) {
          invalidCandidatesSkipped += 1;
          candidates.push({
            candidate,
            status: "invalid",
            reason: enriched.invalidReason ?? "ongeldige kandidaat",
            websiteStatus: candidate.website ? "unknown" : "no_website",
          });
          logDiscoveryEvent("CANDIDATE_SKIPPED", { reason: "invalid" });
          continue;
        }

        const e = enriched.candidate;
        const checkedCandidate: DiscoveryCandidate = {
          ...candidate,
          businessName: e.businessName,
          industry: e.industry,
          city: e.city,
          province: e.province,
          country: e.country,
          phone: e.phone,
          email: e.email,
          website: e.website,
        };

        // 2) Duplicate check (bestaand + batch) — vóór enige live website-check
        const duplicate = findDuplicate({
          candidate: checkedCandidate,
          existingLeads,
          batchLeads,
        });
        if (duplicate) {
          duplicatesSkipped += 1;
          candidates.push({
            candidate: checkedCandidate,
            status: "duplicate",
            reason: DUPLICATE_LABELS[duplicate],
            websiteStatus: e.website ? "unknown" : "no_website",
          });
          logDiscoveryEvent("CANDIDATE_DUPLICATE", { signal: duplicate });
          continue;
        }

        // 3) Website-status (eerlijk: ongecontroleerd → unknown)
        const websiteStatus = await WebsiteDiscoveryService.determineStatus(e.website);

        // 4) Lead aanmaken via de bestaande repository
        const createInput: LeadCreateInput = {
          businessName: e.businessName,
          industry: e.industry,
          city: e.city,
          province: e.province,
          country: e.country,
          address: e.address,
          postalCode: e.postalCode,
          phone: e.phone,
          email: e.email,
          website: e.website,
          websiteStatus,
          source: candidate.source,
          notes: [
            `Ontdekt via Lead Discovery (bron: ${candidate.source}${provider.live ? "" : " — mock data, fictief bedrijf"}).`,
          ],
          externalId: e.externalId,
          sourceUrl: e.sourceUrl,
          googleRating: e.googleRating,
          reviewCount: e.reviewCount,
        };
        const lead = await leadRepository.create(createInput);
        batchLeads.push(lead);
        createdLeads += 1;
        candidates.push({
          candidate: checkedCandidate,
          status: "created",
          leadId: lead.id,
          websiteStatus,
        });
        logDiscoveryEvent("CANDIDATE_CREATED", { leadId: lead.id, score: lead.leadScore });
      } catch {
        errors.push("Een kandidaat kon niet worden verwerkt");
        candidates.push({
          candidate,
          status: "skipped",
          reason: "verwerking mislukt",
          websiteStatus: candidate.website ? "unknown" : "no_website",
        });
        logDiscoveryEvent("CANDIDATE_SKIPPED", { reason: "error" });
      }
    }

    logDiscoveryEvent("DISCOVERY_COMPLETED", {
      source: provider.id,
      found: found.length,
      created: createdLeads,
      duplicates: duplicatesSkipped,
      invalid: invalidCandidatesSkipped,
      durationMs: Date.now() - started,
    });

    return {
      candidates,
      totalFound: found.length,
      source: provider.id,
      query: effectiveRequest,
      durationMs: Date.now() - started,
      duplicatesSkipped,
      invalidCandidatesSkipped,
      createdLeads,
      errors,
    };
  }
}
