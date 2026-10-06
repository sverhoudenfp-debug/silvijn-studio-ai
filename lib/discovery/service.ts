import { GoogleNoWebsiteListedDiscoveryService } from "./identity/pre-kvk-service";
import type { Lead } from "@/lib/types";
import { getLeadRepository, type LeadCreateInput } from "@/lib/repositories/lead-repository";
import { enrichCandidate } from "./enrichment";
import { enrichCreatedLeads, enrichCandidateContact, contactEnrichmentFoundNote } from "./contact-enrichment/service";
import type { ContactEnrichmentProvider } from "./contact-enrichment/provider";
import type { EmailRequiredDiscoverySummary } from "./types";
import { findDuplicate, type DuplicateSignal } from "./duplicate-detector";
import { getDiscoveryProvider } from "./providers";
import type {
  DiscoveryCandidate,
  DiscoveryCandidateResult,
  DiscoveryRequest,
  DiscoveryResult,
  DiscoverySource,
  GooglePreKvkSummary,
} from "./types";
import { GOOGLE_NOT_FOUND_LEAD_NOTE, temporaryGoogleCandidateToDiscoveryCandidate } from "./identity/lead-candidate-mapping";
import { WebsiteDiscoveryService } from "./website-service";

/**
 * LeadDiscoveryService — de gecontroleerde discovery-engine (Fase 5).
 *
 * Pipeline: SEARCH → ENRICH → DUPLICATE CHECK → EMAIL-REQUIRED GATE
 *   (google: contactverrijking via Brave + bestaande verificatieregels; alleen
 *   kandidaten met geverifieerd zakelijk adres gaan verder) → WEBSITE STATUS
 * → LEAD CREATION. limit = gewenste nieuwe e-mail-leads; de kandidaatpool is
 * begrensd door getEmailRequiredCandidateCap (harde clamp 24).
 * Alleen expliciet aangeroepen (server action); geen cron, geen loops, geen bulk-AI.
 * Werkt volledig ZONDER Anthropic — AI-assisted enrichment kan later optioneel.
 *
 * Veiligheid: limit wordt afgetopt tot MAX_DISCOVERY_RESULTS (default 50);
 * provider-fouten worden veilig afgevangen en als foutmelding (geen internals)
 * in het resultaat gezet.
 */

/**
 * Email-required (2026-10-03): harde bovengrens aan het aantal kandidaten dat
 * een run onderzoekt, om de limiet (gewenste e-mail-leads) te kunnen halen
 * zonder onbeperkte API-calls. Standaard min(3× limiet, 24); configureerbaar
 * via DISCOVERY_EMAIL_REQUIRED_MAX_CANDIDATES, altijd afgetopt op 24.
 */
const EMAIL_REQUIRED_HARD_CANDIDATE_CAP = 24;
const EMAIL_REQUIRED_CANDIDATE_MULTIPLIER = 3;

export function getEmailRequiredCandidateCap(limit: number): number {
  const parsed = Number.parseInt(process.env.DISCOVERY_EMAIL_REQUIRED_MAX_CANDIDATES ?? "", 10);
  const configured =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(parsed, EMAIL_REQUIRED_HARD_CANDIDATE_CAP)
      : EMAIL_REQUIRED_HARD_CANDIDATE_CAP;
  return Math.max(1, Math.min(configured, EMAIL_REQUIRED_CANDIDATE_MULTIPLIER * Math.max(1, Math.floor(limit))));
}

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
  constructor(
    private readonly dependencies: {
      google?: GoogleNoWebsiteListedDiscoveryService;
      /** Testinjectie: productie gebruikt de echte provider (BRAVE_SEARCH_API_KEY). */
      contactEnrichment?: ContactEnrichmentProvider;
    } = {}
  ) {}

  async discover(request: DiscoveryRequest, context?: { runId: string }): Promise<DiscoveryResult> {
    void context; // Reserved for run-scoped phases; pre-KVK selection persists no candidates.
    const started = Date.now();
    const max = getMaxDiscoveryResults();
    const limit = Math.max(1, Math.min(request.limit, max));
    const effectiveRequest: DiscoveryRequest = { ...request, limit, country: request.country || "NL" };

    const source = effectiveRequest.source;
    // Email-required (2026-10-03): alleen voor de live google-bron. limit
    // betekent hier "gewenste nieuwe e-mail-leads"; mock/directory behouden
    // het bestaande gedrag (fictieve/bronnaam-kandidaten worden ook zonder
    // e-mail opgeslagen, verrijking draait daar nooit op).
    const emailRequired = source === "google";
    const candidateCap = emailRequired ? getEmailRequiredCandidateCap(limit) : limit;
    const emailSummary: EmailRequiredDiscoverySummary | undefined = emailRequired
      ? {
          mode: "email_required",
          targetLeads: limit,
          candidateCap,
          candidatesResearched: 0,
          noEmailFound: 0,
          emailsFound: 0,
          leadsCreated: 0,
          blocked: 0,
          errors: 0,
          stopReason: "candidates_exhausted",
          message: "",
        }
      : undefined;
    const errors: string[] = [];
    const candidates: DiscoveryCandidateResult[] = [];

    logDiscoveryEvent("DISCOVERY_STARTED", {
      source,
      country: effectiveRequest.country,
      city: effectiveRequest.city ?? null,
      province: effectiveRequest.province ?? null,
      industry: effectiveRequest.industry ?? null,
      limit,
    });

    // Google v2: Places → no_website_listed → begrensde officiële-websitecheck.
    // Alleen kandidaten met uitkomst `not_found` gaan de bestaande creatieketen in;
    // verified/ambiguous/technical_error worden uitsluitend geteld.
    let preKvk: GooglePreKvkSummary | undefined;
    let found: DiscoveryCandidate[] = [];
    let providerId: DiscoverySource = source;
    let providerLive = true;
    let totalFound = 0;
    if (source === "google") {
      const googleService = this.dependencies.google ?? new GoogleNoWebsiteListedDiscoveryService();
      // In-memory handoff binnen hetzelfde verzoek: de selectie wordt nooit geserialiseerd of opgeslagen.
      // Email-required: het Google-zoekbudget is de kandidaat-bovengrens
      // (candidateCap), niet de lead-limiet — de run mag meer kandidaten
      // onderzoeken om het gewenste aantal e-mail-leads te bereiken.
      const selection = await googleService.select({ ...effectiveRequest, limit: candidateCap });
      const aggregate = googleService.toResult(effectiveRequest, selection, Date.now() - started);
      preKvk = aggregate.preKvk;
      totalFound = aggregate.totalFound;
      errors.push(...aggregate.errors);
      if (!preKvk || (selection.errors.length > 0 && selection.temporaryCandidates.length === 0)) {
        return aggregate;
      }
      found = selection.temporaryCandidates.map((c) => temporaryGoogleCandidateToDiscoveryCandidate(c, effectiveRequest));
    } else {
      const provider = getDiscoveryProvider(source);
      providerId = provider.id as DiscoverySource;
      providerLive = provider.live;
      try {
        found = await provider.search(effectiveRequest);
        totalFound = found.length;
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
    }
    const provider = { id: providerId, live: providerLive };

    const leadRepository = getLeadRepository();
    let existingLeads: Lead[] = [];
    try {
      existingLeads = await leadRepository.list();
    } catch {
      errors.push("Bestaande leads konden niet worden geladen");
      logDiscoveryEvent("DISCOVERY_FAILED", { source: provider.id, reason: "repository" });
      return {
        candidates: [],
        totalFound,
        source: provider.id,
        preKvk,
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

        // 3) EMAIL-REQUIRED GATE (2026-10-03, alleen google): een kandidaat
        //    wordt pas een lead als Brave + de bestaande verificatieregels een
        //    zakelijk adres accepteren. Nooit raden; zonder geaccepteerd adres
        //    wordt de kandidaat overgeslagen en uitsluitend geteld. De
        //    verrijkingsprovider wordt pas geraadpleegd ná de dedupe (geen
        //    API-budget aan duplicaten).
        let verifiedEmail: string | null = e.email ?? null;
        let verifiedRule: string | null = null;
        let verifiedSourceUrl: string | null = null;
        if (emailSummary && !verifiedEmail) {
          const enrichment = await enrichCandidateContact(
            {
              businessName: e.businessName,
              city: e.city,
              phone: e.phone,
              address: e.address,
              postalCode: e.postalCode,
            },
            this.dependencies.contactEnrichment ? { provider: this.dependencies.contactEnrichment } : undefined
          );
          emailSummary.candidatesResearched += 1;
          if (enrichment.outcome === "blocked_external_configuration") {
            emailSummary.blocked += 1;
            emailSummary.stopReason = "blocked_external_configuration";
            candidates.push({
              candidate: checkedCandidate,
              status: "skipped",
              reason: "contactverrijking geblokkeerd (geen zoekprovider geconfigureerd)",
              websiteStatus: "no_website",
            });
            logDiscoveryEvent("CANDIDATE_SKIPPED", { reason: "enrichment_blocked" });
            // Provider-loos is run-breed: verder zoeken heeft geen zin.
            break;
          }
          if (enrichment.outcome === "provider_error") {
            emailSummary.errors += 1;
            candidates.push({
              candidate: checkedCandidate,
              status: "skipped",
              reason: "contactverrijking mislukt (providerfout)",
              websiteStatus: "no_website",
            });
            logDiscoveryEvent("CANDIDATE_SKIPPED", { reason: "enrichment_error" });
            continue;
          }
          if (enrichment.outcome === "no_email_found") {
            emailSummary.noEmailFound += 1;
            candidates.push({
              candidate: checkedCandidate,
              status: "skipped",
              reason: `geen geverifieerd zakelijk e-mailadres (${enrichment.reason})`,
              websiteStatus: "no_website",
            });
            logDiscoveryEvent("CANDIDATE_SKIPPED", { reason: "no_verified_email" });
            continue;
          }
          verifiedEmail = enrichment.email;
          verifiedRule = enrichment.rule;
          verifiedSourceUrl = enrichment.sourceUrl;
          emailSummary.emailsFound += 1;
        }

        // 4) Website-status (eerlijk: ongecontroleerd → unknown)
        const websiteStatus = await WebsiteDiscoveryService.determineStatus(e.website);

        // 5) Lead aanmaken via de bestaande repository
        const createInput: LeadCreateInput = {
          businessName: e.businessName,
          industry: e.industry,
          city: e.city,
          province: e.province,
          country: e.country,
          address: e.address,
          postalCode: e.postalCode,
          phone: e.phone,
          email: verifiedEmail,
          website: e.website,
          websiteStatus,
          source: candidate.source,
          notes: [
            source === "google"
              ? GOOGLE_NOT_FOUND_LEAD_NOTE
              : `Ontdekt via Lead Discovery (bron: ${candidate.source}${provider.live ? "" : " — mock data, fictief bedrijf"}).`,
            ...(verifiedRule ? [contactEnrichmentFoundNote(verifiedEmail as string, verifiedSourceUrl, verifiedRule)] : []),
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
        if (emailSummary) {
          emailSummary.leadsCreated += 1;
          if (emailSummary.leadsCreated >= emailSummary.targetLeads) {
            emailSummary.stopReason = "target_reached";
            break;
          }
        }
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

    // 5) Contactverrijking (2026-10-01): alleen voor AANGEMAAKTE leads van
    //    de live Google-bron, begrensd per run, nooit throwend. Mock-leads
    //    zijn fictief: zoeken naar een echt bedrijf zou onzin opleveren en
    //    zou zelfs een echt, vreemd bedrijf kunnen koppelen — daarom never.
    let contactEnrichment: import("./contact-enrichment/service").ContactEnrichmentRunSummary | undefined;
    if (source === "google" && batchLeads.length > 0 && !emailSummary) {
      contactEnrichment = await enrichCreatedLeads(batchLeads);
      logDiscoveryEvent("CONTACT_ENRICHMENT_COMPLETED", {
        attempted: contactEnrichment.attempted,
        emailFound: contactEnrichment.emailFound,
        noEmailFound: contactEnrichment.noEmailFound,
        blocked: contactEnrichment.blocked,
        errors: contactEnrichment.errors,
        notAttempted: contactEnrichment.notAttempted,
      });
    }

    if (emailSummary) {
      emailSummary.message =
        emailSummary.stopReason === "blocked_external_configuration"
          ? `Contactverrijking geblokkeerd (geen zoekprovider geconfigureerd): ${emailSummary.leadsCreated} van ${emailSummary.targetLeads} e-mail-leads gevonden.`
          : emailSummary.leadsCreated >= emailSummary.targetLeads
            ? `${emailSummary.leadsCreated} van ${emailSummary.targetLeads} e-mail-leads gevonden`
            : `${emailSummary.leadsCreated} van ${emailSummary.targetLeads} e-mail-leads gevonden — kandidaatpool uitgeput`;
    }

    logDiscoveryEvent("DISCOVERY_COMPLETED", {
      source: provider.id,
      found: found.length,
      created: createdLeads,
      duplicates: duplicatesSkipped,
      invalid: invalidCandidatesSkipped,
      ...(emailSummary
        ? {
            emailTarget: emailSummary.targetLeads,
            emailLeads: emailSummary.leadsCreated,
            researched: emailSummary.candidatesResearched,
            noEmail: emailSummary.noEmailFound,
            stopReason: emailSummary.stopReason,
          }
        : {}),
      durationMs: Date.now() - started,
    });

    if (preKvk) preKvk.leadsCreated = createdLeads;
    return {
      candidates,
      totalFound,
      source: provider.id,
      query: effectiveRequest,
      durationMs: Date.now() - started,
      duplicatesSkipped,
      invalidCandidatesSkipped,
      createdLeads,
      errors,
      ...(preKvk ? { preKvk } : {}),
      ...(contactEnrichment ? { contactEnrichment } : {}),
      ...(emailSummary ? { emailRequired: emailSummary } : {}),
    };
  }
}
