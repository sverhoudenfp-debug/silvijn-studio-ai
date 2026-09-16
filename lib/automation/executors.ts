import { scoreLead, type ScorableLead } from "@/lib/agents/lead-scoring";
import { LeadDiscoveryService } from "@/lib/discovery/service";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { OutreachService } from "@/lib/outreach/service";
import { ProjectService } from "@/lib/projects/service";
import { getPriceIndicationRepository } from "@/lib/pricing/repository";
import { QualityControlService } from "@/lib/qc/service";
import { SalesService } from "@/lib/sales/service";
import { WebsiteGenerationService } from "@/lib/websites/service";
import { getAutomationLimits } from "./limits";
import type { StepExecutionResult } from "./types";

/**
 * Step-executors (Fase 11) — DUNNE LAAG rondom de bestaande engines.
 * Geen dubbele business logic: elke executor roept de bestaande service
 * aan en laat ALLE bestaande guards (lead-status, project-guards,
 * generatielimieten, versie-beheer, QC-guards, pricing-config) onverkort
 * gelden. De orchestrator kan geen enkele guard omzeilen.
 */

export interface StepContext {
  /** Entity waarop de automation draait (leadId/projectId/websiteId). */
  entityId: string | null;
  /** Context die eerdere steps hebben doorgegeven (bijv. projectId). */
  context: Record<string, unknown>;
}

export class StepExecutionBlockedError extends Error {
  constructor(
    message: string,
    public readonly outcome: "blocked" | "waiting_for_human"
  ) {
    super(message);
    this.name = "StepExecutionBlockedError";
  }
}

// Services zijn stateloos; repositories worden LAZY per call opgehaald zodat
// de mock/Supabase-mode keuze altijd tegen de actuele configuratie wordt
// gemaakt (nooit ingebakken op import-tijd).
const projectService = new ProjectService();
const websiteService = new WebsiteGenerationService();
const qcService = new QualityControlService();

function requireEntity(context: StepContext): string {
  if (!context.entityId) {
    throw new StepExecutionBlockedError("Step vereist een entity (lead/project), maar er is er geen.", "blocked");
  }
  return context.entityId;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, stepName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Step "${stepName}" overschreed de timeout (${timeoutMs}ms)`)), timeoutMs);
    }),
  ]);
}

/**
 * DISCOVER_LEADS — gebruikt LeadDiscoveryService (inclusief dedup, enrich,
 * validatie, opslag, MAX_DISCOVERY_RESULTS). Demo-generatie en outreach
 * horen hier NOOIT bij.
 */
export async function executeDiscoverLeads(context: StepContext): Promise<StepExecutionResult> {
  void context; // discovery draait run-breed, niet op één entity
  const limits = getAutomationLimits();
  const result = await withTimeout(
    new LeadDiscoveryService().discover({
      country: "NL",
      limit: limits.maxLeadsPerDiscoveryRun,
      source: "mock",
    }),
    120_000,
    "discover_leads"
  );
  const createdLeadIds = result.candidates.filter((c) => c.leadId).map((c) => c.leadId as string);
  return {
    outcome: "success",
    result: `${result.totalFound} kandidaten gevonden, ${result.duplicatesSkipped} duplicates overgeslagen, ${result.createdLeads} leads opgeslagen (bron: ${result.source}).`,
    context: { createdLeadIds },
  };
}

/** SCORE_LEAD — deterministische rule-based scoring agent (geen AI-call). */
export async function executeScoreLead(context: StepContext): Promise<StepExecutionResult> {
  const bulkIds = context.context.createdLeadIds as string[] | undefined;
  if (bulkIds && bulkIds.length > 0) {
    const scored: number[] = [];
    for (const leadId of bulkIds) {
      const lead = await getLeadRepository().get(leadId);
      if (!lead) continue;
      scored.push(scoreLead(lead as ScorableLead).score);
    }
    return {
      outcome: "success",
      result: `${scored.length} nieuwe leads deterministisch gescoord (rule-based, geen AI): gemiddeld ${scored.length > 0 ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0}/100.`,
    };
  }
  const leadId = requireEntity(context);
  const lead = await getLeadRepository().get(leadId);
  if (!lead) throw new StepExecutionBlockedError("Lead niet gevonden voor scoring.", "blocked");
  const scored = scoreLead(lead as ScorableLead);
  return {
    outcome: "success",
    result: `Lead gescoord: ${scored.score}/100 — ${scored.reason}`,
    context: { leadScore: scored.score },
  };
}

/** ANALYZE_LEAD — kwalificatie via de bestaande SalesService-analyse (mock-dev: handmatige registratie is de norm). */
export async function executeAnalyzeLead(context: StepContext): Promise<StepExecutionResult> {
  const bulkIds = context.context.createdLeadIds as string[] | undefined;
  if (bulkIds && bulkIds.length > 0) {
    const leads = await Promise.all(bulkIds.map((id) => getLeadRepository().get(id)));
    const found = leads.filter((l): l is NonNullable<typeof l> => Boolean(l));
    const withWebsite = found.filter((l) => l.websiteStatus !== "no_website").length;
    return {
      outcome: "success",
      result: `${found.length} nieuwe leads geanalyseerd: ${withWebsite} met (zwakke) website, ${found.length - withWebsite} zonder website — deterministische observatie, geen AI-call.`,
    };
  }
  const leadId = requireEntity(context);
  const lead = await getLeadRepository().get(leadId);
  if (!lead) throw new StepExecutionBlockedError("Lead niet gevonden voor analyse.", "blocked");
  return {
    outcome: "success",
    result: `Lead geanalyseerd: status "${lead.leadStatus}", score ${lead.leadScore}/100, industrie ${lead.industry}, website-status ${lead.websiteStatus}.`,
    context: { leadStatus: lead.leadStatus },
  };
}

/** CREATE_PROJECT — idempotent via bestaande ProjectService (1 project per lead). */
export async function executeCreateProject(context: StepContext): Promise<StepExecutionResult> {
  const leadId = requireEntity(context);
  const lead = await getLeadRepository().get(leadId);
  if (!lead) throw new StepExecutionBlockedError("Lead niet gevonden voor projectcreatie.", "blocked");
  if (lead.leadStatus !== "qualified") {
    throw new StepExecutionBlockedError(
      `Project kan alleen bij een gekwalificeerde lead (huidig: ${lead.leadStatus}) — bestaande guard onverkort actief.`,
      "blocked"
    );
  }
  const existing = await projectService.getByLeadId(leadId);
  if (existing) {
    return {
      outcome: "success",
      result: `Project bestaat al (${existing.id}, status ${existing.status}) — hergebruikt, geen duplicate (idempotent).`,
      context: { projectId: existing.id },
    };
  }
  const project = await projectService.createFromLead(leadId);
  return {
    outcome: "success",
    result: `Project aangemaakt voor ${lead.businessName}: ${project.id} (status ${project.status}).`,
    context: { projectId: project.id },
  };
}

/** CHECK_REQUIREMENTS — deterministische check; ontbrekende vereisten → BLOCKED. */
export async function executeCheckRequirements(context: StepContext): Promise<StepExecutionResult> {
  const projectId = (context.context.projectId as string | undefined) ?? requireEntity(context);
  const project = await projectService.get(projectId);
  if (!project) throw new StepExecutionBlockedError("Project niet gevonden voor requirements-check.", "blocked");
  const requirements = project.requirements;
  if (project.status === "cancelled" || project.status === "completed") {
    throw new StepExecutionBlockedError(
      `Project is ${project.status} — automation stopt (bestaande guard).`,
      "blocked"
    );
  }
  // Kern-vereisten voor websitegeneratie: onbekend = wachten op mens (AI verzint niets).
  if (!requirements.websiteType) {
    throw new StepExecutionBlockedError(
      "WebsiteType is onbekend (requirements onvolledig) — automation wacht op menselijke aanvulling. De AI mag geen requirements verzinnen.",
      "waiting_for_human"
    );
  }
  return {
    outcome: "success",
    result: `Requirements in orde: type ${requirements.websiteType}, ${requirements.numberOfPages ?? "?"} pagina's, e-commerce ${requirements.ecommerce === true ? "ja" : "nee"}.`,
  };
}

/** CREATE_PRICE_INDICATION — bestaande PricingEngine; CONFIGURATION_MISSING → BLOCKED, geen fallback-prijs. */
export async function executeCreatePriceIndication(context: StepContext): Promise<StepExecutionResult> {
  const projectId = (context.context.projectId as string | undefined) ?? requireEntity(context);
  await projectService.calculatePrice(projectId);
  const indications = await getPriceIndicationRepository().listByProject(projectId);
  const indication = indications[indications.length - 1];
  if (!indication) {
    throw new StepExecutionBlockedError("Prijsindicatie kon niet worden opgehaald — automation stopt.", "blocked");
  }
  if (indication.status === "configuration_missing") {
    throw new StepExecutionBlockedError(
      "Pricing-configuratie ontbreekt — géén fallback-prijs; automation geblokkeerd tot de menselijke configuratie er is.",
      "blocked"
    );
  }
  if (indication.requiresHuman || indication.status === "requires_human") {
    throw new StepExecutionBlockedError(
      `Prijsindicatie vereist menselijke beoordeling (${indication.escalationReasons.join("; ") || "REQUIRES_HUMAN"}) — automation wacht.`,
      "waiting_for_human"
    );
  }
  return {
    outcome: "success",
    result: `Prijsindicatie berekend (status ${indication.status}, versie ${indication.pricingVersion}); totaal ${indication.total.toFixed(2)} ${indication.currency} — alleen via de bestaande PricingEngine, geen AI-bedrag.`,
    context: { priceIndicationId: indication.id },
  };
}

/** CHECK_PRICE — deterministische check of de indicatie bruikbaar is. */
export async function executeCheckPrice(context: StepContext): Promise<StepExecutionResult> {
  const projectId = (context.context.projectId as string | undefined) ?? requireEntity(context);
  const indications = await import("@/lib/pricing/repository").then((m) => m.getPriceIndicationRepository().listByProject(projectId));
  const latest = indications[0];
  if (!latest) {
    throw new StepExecutionBlockedError("Geen prijsindicatie gevonden — eerst CREATE_PRICE_INDICATION uitvoeren.", "blocked");
  }
  if (latest.status !== "ready") {
    throw new StepExecutionBlockedError(
      `Prijsindicatie niet bruikbaar (status ${latest.status}) — automation stopt; geen websitegeneratie zonder geldige prijs.`,
      "waiting_for_human"
    );
  }
  return { outcome: "success", result: `Prijsindicatie bruikbaar (status ${latest.status}).` };
}

/** GENERATE_WEBSITE — bestaande WebsiteGenerationService (guards, limieten, versie-beheer onverkort). */
export async function executeGenerateWebsite(context: StepContext): Promise<StepExecutionResult> {
  const projectId = (context.context.projectId as string | undefined) ?? requireEntity(context);
  const website = await websiteService.generateWebsite(projectId);
  return {
    outcome: "success",
    result: `Website v${website.version} gegenereerd voor ${website.businessName} (status ${website.status}, build ${website.buildStatus}).`,
    context: { websiteId: website.id, websiteSlug: website.slug },
  };
}

/** RUN_QC — bestaande QualityControlService; QC PASS ≠ APPROVED (mens blijft). */
export async function executeRunQc(context: StepContext): Promise<StepExecutionResult> {
  const websiteId =
    (context.context.websiteId as string | undefined) ??
    (() => {
      throw new StepExecutionBlockedError("Geen website in context voor QC — eerst GENERATE_WEBSITE.", "blocked");
    })();
  const qc = await qcService.runQualityControl(websiteId);
  if (qc.overallResult === "fail" || qc.status === "failed") {
    throw new StepExecutionBlockedError(
      `Kwaliteitscontrole faalde (${qc.overallResult}) — automation stopt; regeneratie is een menselijke beslissing.`,
      "blocked"
    );
  }
  if (qc.overallResult === "needs_revision") {
    throw new StepExecutionBlockedError(
      "Kwaliteitscontrole: NEEDS REVISION — automation stopt; revisie is een menselijke beslissing.",
      "waiting_for_human"
    );
  }
  return {
    outcome: "success",
    result: `QC voltooid: PASS (score ${qc.score}/100) → website is READY FOR SILVIJN. Goedkeuring blijft een menselijke actie.`,
    context: { qcId: qc.id },
  };
}

/** GENERATE_OUTREACH — bestaande OutreachService; alléén draft, NOOIT verzenden (Fase 6-regel). */
export async function executeGenerateOutreach(context: StepContext): Promise<StepExecutionResult> {
  const leadId = requireEntity(context);
  const outreachService = new OutreachService();
  const result = await outreachService.generateDraftForLead(leadId);
  return {
    outcome: "success",
    result: `Outreach-concept gegenereerd (kanaal ${result.draft.channel}, status ${result.draft.status}) — NIET verzonden; verzenden is een menselijke actie.`,
  };
}

/** PROCESS_REPLY — bestaande SalesService (kwalificatie, intent, conservatieve statussync). */
export async function executeProcessReply(context: StepContext): Promise<StepExecutionResult> {
  const leadId = requireEntity(context);
  const salesService = new SalesService();
  const messages = await salesService.listInboundByLead(leadId);
  const latest = messages[0];
  if (!latest) {
    throw new StepExecutionBlockedError("Geen inkomende berichten voor deze lead — niets te verwerken.", "blocked");
  }
  const analysis = await salesService.analyzeInboundMessage(leadId, latest.id);
  return {
    outcome: "success",
    result: `Reactie verwerkt: intent "${analysis.interaction.intent}", kwalificatie "${analysis.interaction.qualification?.status ?? "onbekend"}", status "${analysis.interaction.status}".`,
  };
}
