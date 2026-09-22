import "server-only";
import { isKnownDiscoverySource, mockDiscoveryAllowed } from "./provider-safety";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import {
  getDiscoveryRunRepository,
  type DiscoveryRunRepository,
} from "@/lib/repositories/discovery-run-repository";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { LeadDiscoveryService, getMaxDiscoveryResults } from "./service";
import type { DiscoveryRequest, DiscoveryResult, DiscoverySource } from "./types";
import type { DiscoveryRunLeadSummary, DiscoveryRunSummary } from "./run-types";
import { scorePriority } from "./run-types";

/**
 * DiscoveryOrchestrator — Fase D: de gecontroleerde schil rond de bestaande
 * discovery-engine. Per expliciete owner-opdracht:
 *
 *   1. valideert de opdracht (minimaal branche ÓF plaats/regio; limiet afgetopt)
 *   2. legt de opdracht vast als discovery_run (command-record, status running)
 *   3. hergebruikt LeadDiscoveryService.discover() — search → enrich →
 *      duplicate check (bestaand + batch) → website-status → lead-creatie
 *      met de bestaande rule-based scoring
 *   4. werkt het run-record bij met tellingen, scores/prioriteiten, fouten
 *      en schrijft één audit_events-rij
 *
 * NEVER: automatische trigger (geen cron, geen entity-event), outreach
 * versturen, leads verzinnen of bestaande leads muteren. Bestaande leads en
 * duplicaten worden veilig overgeslagen door de bestaande detector.
 */

export interface DiscoveryCommandInput {
  ownerUserId: string;
  country: string;
  province?: string;
  city?: string;
  industry?: string;
  query?: string;
  source: DiscoverySource;
  limit: number;
}

export interface DiscoveryCommandResult {
  runId: string | null;
  command: string;
  status: "completed" | "failed" | "rejected";
  discovery: DiscoveryResult | null;
  createdLeadSummaries: DiscoveryRunLeadSummary[];
  errors: string[];
}

export class DiscoveryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryInputError";
  }
}

const MAX_COMMAND_LENGTH = 500;

function normalize(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function validateDiscoveryCommand(input: DiscoveryCommandInput): {
  country: string;
  province: string | null;
  city: string | null;
  industry: string | null;
  query: string | null;
  source: DiscoverySource;
  requestedLimit: number;
  effectiveLimit: number;
  command: string;
} {
  if (!isKnownDiscoverySource(input.source)) throw new DiscoveryInputError("UNKNOWN_DISCOVERY_PROVIDER");
  if (input.source === "mock" && !mockDiscoveryAllowed()) throw new DiscoveryInputError("MOCK_DISCOVERY_FORBIDDEN");
  const country = (normalize(input.country) ?? "NL").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new DiscoveryInputError("Land moet een ISO-landcode van 2 letters zijn");
  }
  if (input.source === "google" && country !== "NL") throw new DiscoveryInputError("GOOGLE_IDENTITY_NL_ONLY");
  const province = normalize(input.province);
  const city = normalize(input.city);
  const industry = normalize(input.industry);
  const query = normalize(input.query);

  // Masterconfig 4.2: gerichte opdracht, geen blinde bulk-verzameling.
  if (!industry && !city && !province && !query) {
    throw new DiscoveryInputError(
      "Geef minimaal een branche, plaats of regio op voor een gerichte discovery-opdracht"
    );
  }

  const requestedLimit = Math.min(Math.max(Number.isFinite(input.limit) ? Math.floor(input.limit) : 20, 1), 200);
  const effectiveLimit = Math.min(requestedLimit, getMaxDiscoveryResults());

  const scopeParts = [industry, city, province].filter(Boolean).map(String);
  const command = `Start lead discovery${scopeParts.length > 0 ? ` voor ${scopeParts.join(" in ")}` : ""}${
    city && province ? ` (${province})` : ""
  } — bron: ${input.source}, limiet: ${effectiveLimit}`.slice(0, MAX_COMMAND_LENGTH);

  return { country, province, city, industry, query, source: input.source, requestedLimit, effectiveLimit, command };
}

async function writeAuditEvent(
  ownerUserId: string,
  runId: string,
  action: "discovery_run_completed" | "discovery_run_failed",
  details: Record<string, unknown>
): Promise<void> {
  if (!isSupabaseConfigured()) return; // development/mock: geen audit-opslag
  try {
    const client = getSupabaseServerClient();
    const { error } = await client.from("audit_events").insert({
      actor_id: ownerUserId,
      action,
      entity_type: "discovery_run",
      entity_id: runId,
      details,
    });
    if (error) throw error;
  } catch {
    // Audit-mislukking mag de run niet ongedaan maken, maar mag ook niet
    // stilletjes verdwijnen: veilige server-log zonder persoonsgegevens.
    console.warn("[Discovery] AUDIT_WRITE_FAILED", { runId, action });
  }
}

export class DiscoveryOrchestrator {
  constructor(
    private readonly runRepository: DiscoveryRunRepository = getDiscoveryRunRepository(),
    private readonly discovery: LeadDiscoveryService = new LeadDiscoveryService()
  ) {}

  async runCommand(input: DiscoveryCommandInput): Promise<DiscoveryCommandResult> {
    const validated = validateDiscoveryCommand(input);
    const request: DiscoveryRequest = {
      country: validated.country,
      province: validated.province ?? undefined,
      city: validated.city ?? undefined,
      industry: validated.industry ?? undefined,
      query: validated.query ?? undefined,
      limit: validated.effectiveLimit,
      source: validated.source,
    };

    // 1) Expliciet command-record vóór de run (scope + budget vastgelegd).
    const run = await this.runRepository.create({
      ownerUserId: input.ownerUserId,
      command: validated.command,
      country: validated.country,
      province: validated.province,
      city: validated.city,
      industry: validated.industry,
      query: validated.query,
      source: validated.source,
      requestedLimit: validated.requestedLimit,
      effectiveLimit: validated.effectiveLimit,
    });

    const started = Date.now();
    try {
      const result = await this.discovery.discover(request, { runId: run.id });

      // 2) Scores/prioriteiten van aangemaakte leads ophalen via de bestaande
      //    repository (score is bij creatie berekend door de scoring agent).
      const leadRepository = getLeadRepository();
      const createdLeadSummaries: DiscoveryRunLeadSummary[] = [];
      for (const candidate of result.candidates) {
        if (candidate.status !== "created" || !candidate.leadId) continue;
        const lead = await leadRepository.get(candidate.leadId);
        if (!lead) continue;
        createdLeadSummaries.push({
          leadId: lead.id,
          businessName: lead.businessName,
          industry: lead.industry,
          city: lead.city,
          websiteStatus: lead.websiteStatus,
          score: lead.leadScore,
          priority: scorePriority(lead.leadScore),
        });
      }

      const duplicateReasons: Record<string, number> = {};
      for (const candidate of result.candidates) {
        if (candidate.status !== "duplicate") continue;
        const reason = candidate.reason ?? "duplicaat";
        duplicateReasons[reason] = (duplicateReasons[reason] ?? 0) + 1;
      }
      const summary: DiscoveryRunSummary = { created: createdLeadSummaries, duplicateReasons, ...(result.identity ? { identity: result.identity } : {}) };

      const durationMs = Date.now() - started;
      // Eerlijke run-status: fouten (providerfout of mislukte kandidaten) markeren
      // de opdracht als geheel als gefaald, ook als er deels leads zijn aangemaakt.
      const runStatus = result.errors.length > 0 ? "failed" : "completed";
      await this.runRepository.complete(run.id, {
        status: runStatus,
        totalFound: result.totalFound,
        createdLeads: result.createdLeads,
        duplicatesSkipped: result.duplicatesSkipped,
        invalidSkipped: result.invalidCandidatesSkipped,
        durationMs,
        createdLeadIds: createdLeadSummaries.map((entry) => entry.leadId),
        summary,
        errors: result.errors,
        completedAt: new Date().toISOString(),
      });

      await writeAuditEvent(
        input.ownerUserId,
        run.id,
        runStatus === "failed" ? "discovery_run_failed" : "discovery_run_completed",
        {
        source: result.source,
        found: result.totalFound,
        created: result.createdLeads,
          ...(result.identity ? { verifiedCandidates: result.identity.persisted, quotaMet: result.identity.quotaMet } : {}),
        duplicates: result.duplicatesSkipped,
        invalid: result.invalidCandidatesSkipped,
        durationMs,
      });

      return {
        runId: run.id,
        command: validated.command,
        status: runStatus,
        discovery: result,
        createdLeadSummaries,
        errors: result.errors,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Onbekende fout tijdens discovery";
      const durationMs = Date.now() - started;
      const errors = [message];
      await this.runRepository.complete(run.id, {
        status: "failed",
        totalFound: null,
        createdLeads: 0,
        duplicatesSkipped: 0,
        invalidSkipped: 0,
        durationMs,
        createdLeadIds: [],
        summary: { created: [], duplicateReasons: {} },
        errors,
        completedAt: new Date().toISOString(),
      });
      await writeAuditEvent(input.ownerUserId, run.id, "discovery_run_failed", {
        source: validated.source,
        durationMs,
      });
      return {
        runId: run.id,
        command: validated.command,
        status: "failed",
        discovery: null,
        createdLeadSummaries: [],
        errors,
      };
    }
  }
}
