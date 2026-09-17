import { canCreateProjectForLead } from "@/lib/leads/lifecycle";
import { startProjectProduction } from "@/lib/leads/service";
import { humanRpc } from "@/lib/auth/server";
import { getAIActivityRepository } from "@/lib/repositories/ai-activity-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getSalesInteractionRepository } from "@/lib/sales/repository";
import { AIService } from "@/lib/ai/service";
import { getPricingConfiguration } from "@/lib/config/agency-config";
import { calculatePriceIndication } from "@/lib/pricing/engine";
import { getPriceIndicationRepository } from "@/lib/pricing/repository";
import { getProjectRepository, type ProjectCreateInput, type ProjectUpdateInput } from "./repository";
import { type Project, type ProjectRequirements, type ProjectStatus } from "./types";

/**
 * ProjectService (Fase 8).
 *
 * Lead (qualified) → Create Project (user action) → requirements →
 * PricingEngine (deterministisch, geen AI) → PRICE INDICATION →
 * menselijke goedkeuring.
 *
 * Garanties:
 * - De AI mag productie starten na bevestigde betaling en complete requirements; approved/completed blijven menselijke besluiten.
 * - calculatePrice() vereist GEEN AI-call — puur de PricingEngine + configuratie.
 * - Ontbreekt de pricing configuration → CONFIGURATION_MISSING, geen bedrag.
 * - "Send to Silvijn" is intern escaleren; er bestaat geen klantcommunicatie.
 */

export function getMaxRequirementsAnalysesPerRun(): number {
  const parsed = Number.parseInt(process.env.MAX_PRICING_ANALYSES_PER_RUN ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 25) : 5;
}

export class ProjectLimitError extends Error {
  constructor(limit: number) {
    super(`Requirements-analyse-limiet bereikt (${limit} per run)`);
    this.name = "ProjectLimitError";
  }
}

export class ProjectNotFoundError extends Error {
  constructor(message = "Project niet gevonden") {
    super(message);
    this.name = "ProjectNotFoundError";
  }
}

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

/** Deterministische mapping: laatste kwalificatie → initiële requirements. Geen gokken. */
function requirementsFromQualification(project: { needsEcommerce: boolean; projectType: string | null; timeline: string | null; needsWebsite: boolean }): ProjectRequirements {
  return {
    websiteType: project.needsEcommerce ? "webshop" : project.projectType ?? null,
    ecommerce: project.needsEcommerce ? true : null,
    deadline: project.timeline ?? null,
    existingWebsite: project.needsWebsite ? false : null,
  };
}

export class ProjectService {
  private aiService = new AIService();
  private analysesThisRun = 0;

  async createFromLead(leadId: string): Promise<Project> {
    const lead = await getLeadRepository().get(leadId);
    if (!lead) throw new ProjectValidationError("Lead niet gevonden");

    if (!canCreateProjectForLead(lead.leadStatus)) {
      throw new ProjectValidationError(
        `Project aanmaken is alleen mogelijk bij een gekwalificeerde lead (huidige status: ${lead.leadStatus})`
      );
    }

    const existing = await getProjectRepository().getByLeadId(leadId);
    if (existing) throw new ProjectValidationError("Voor deze lead bestaat al een project");

    // Initiële requirements: deterministisch uit de laatste sales-kwalificatie (geen AI)
    const interactions = await getSalesInteractionRepository().listByLead(leadId);
    const latestQualification = interactions[0]?.qualification ?? null;

    const input: ProjectCreateInput = {
      leadId,
      name: `${lead.businessName} — website`,
      projectType: latestQualification?.projectType ?? lead.industry,
      description: `Project voor ${lead.businessName} (${lead.industry}, ${lead.city}).`,
      requirements: latestQualification
        ? requirementsFromQualification({
            needsEcommerce: Boolean(latestQualification.needsEcommerce),
            projectType: latestQualification.projectType,
            timeline: latestQualification.timeline,
            needsWebsite: Boolean(latestQualification.needsWebsite),
          })
        : {},
      currency: "EUR",
      timeline: latestQualification?.timeline ?? null,
      notes: "",
    };

    const project = await getProjectRepository().create(input);
    await getAIActivityRepository().log({
      leadId,
      type: "project_created",
      status: "completed",
      message: `Project "${project.name}" aangemaakt vanuit lead (status: quotation_pending)`,
    });
    return project;
  }

  async get(id: string): Promise<Project> {
    const project = await getProjectRepository().getById(id);
    if (!project) throw new ProjectNotFoundError();
    return project;
  }

  async getByLeadId(leadId: string): Promise<Project | null> {
    return getProjectRepository().getByLeadId(leadId);
  }

  async list(): Promise<Project[]> {
    return getProjectRepository().list();
  }

  async update(id: string, input: ProjectUpdateInput): Promise<Project> {
    const project = await this.get(id);
    const updated = await getProjectRepository().update(id, input);
    if (!updated) throw new ProjectNotFoundError();
    void project;
    return updated;
  }

  async updateRequirements(id: string, requirements: ProjectRequirements): Promise<Project> {
    await this.get(id); // bestaat
    const updated = await getProjectRepository().updateRequirements(id, requirements);
    if (!updated) throw new ProjectNotFoundError();
    return updated;
  }

  /**
   * AI-assistentie: stelt requirements voor op basis van de lead- en
   * salescontext. Expliciete user action; 1 gecontroleerde AI-call.
   * Bestaande bekende waarden blijven behouden; de AI vult alleen aan.
   */
  async proposeRequirements(id: string): Promise<{ project: Project; missingInformation: string[]; questions: string[]; confidence: number; model: string; mode: string }> {
    this.analysesThisRun += 1;
    const max = getMaxRequirementsAnalysesPerRun();
    if (this.analysesThisRun > max) throw new ProjectLimitError(max);

    const project = await this.get(id);
    const lead = await getLeadRepository().get(project.leadId);
    if (!lead) throw new ProjectValidationError("Lead niet gevonden");

    const interactions = await getSalesInteractionRepository().listByLead(project.leadId);
    const latest = interactions[0];
    const qualificationSummary = latest
      ? `status=${latest.qualification.status}, interesse=${latest.qualification.interestLevel}, e-commerce=${latest.qualification.needsEcommerce ? "ja" : "onbekend"}, projectType=${latest.qualification.projectType ?? "onbekend"}, timeline=${latest.qualification.timeline ?? "onbekend"}`
      : null;

    const inboundExcerpts = interactions
      .slice(0, 3)
      .map((i) => i.responseDraft.slice(0, 120));

    const result = await this.aiService.generateRequirementsAnalysis(
      {
        businessName: lead.businessName,
        industry: lead.industry,
        city: lead.city,
        leadScore: lead.leadScore,
        qualificationSummary,
        inboundExcerpts,
        existingRequirements: project.requirements as Record<string, unknown>,
      },
      project.leadId
    );

    // AI-voorstel toepassen: alléén velden die nu nog onbekend zijn (nooit overschrijven)
    const proposal = result.data.requirements;
    const merged: ProjectRequirements = { ...project.requirements };
    for (const [key, value] of Object.entries(proposal)) {
      const currentValue = (project.requirements as Record<string, unknown>)[key];
      if ((currentValue == null || currentValue === false) && value != null) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    if (result.data.projectType && !project.projectType) {
      await getProjectRepository().update(id, { projectType: result.data.projectType });
    }
    const updated = await getProjectRepository().updateRequirements(id, merged);
    if (!updated) throw new ProjectNotFoundError();

    return {
      project: updated,
      missingInformation: result.data.missingInformation,
      questions: result.data.questions,
      confidence: result.data.confidence,
      model: result.model,
      mode: result.mode,
    };
  }

  /**
   * Deterministische prijsberekening — GEEN AI-call nodig.
   * Configuration leeg → CONFIGURATION_MISSING zonder bedrag.
   */
  async calculatePrice(id: string): Promise<Project> {
    const project = await this.get(id);
    if (project.priceStatus === "approved") throw new ProjectValidationError("Goedgekeurde prijs is vergrendeld. Wijzigingen vereisen expliciete menselijke herbeoordeling.");
    const config = await getPricingConfiguration();
    const indication = calculatePriceIndication(
      { projectId: project.id, requirements: project.requirements },
      config
    );
    await getPriceIndicationRepository().create(indication);

    const priceStatus: Project["priceStatus"] =
      indication.status === "ready"
        ? "ready"
        : indication.status === "missing_information"
          ? "missing_information"
          : indication.status === "configuration_missing"
            ? "configuration_missing"
            : "requires_human";

    const newStatus: ProjectStatus =
      indication.status === "ready" ? "price_ready" : project.status === "quotation_pending" ? "quotation_pending" : project.status;

    const updated = await getProjectRepository().update(id, {
      priceStatus,
      status: newStatus,
      estimatedPrice: indication.status === "ready" ? indication.total : null,
    });
    if (!updated) throw new ProjectNotFoundError();

    const activityRepository = getAIActivityRepository();
    await activityRepository.log({
      leadId: project.leadId,
      type: "price_calculated",
      status: "completed",
      message:
        indication.status === "configuration_missing"
          ? `Prijsberekening voor "${project.name}": PRICING CONFIGURATION MISSING — geen prijs berekend (geen bedrag verzonnen)`
          : indication.status === "ready"
            ? `Prijsindicatie berekend voor "${project.name}": € ${indication.total.toFixed(2)} (${config.pricingVersion}) — wacht op menselijke goedkeuring`
            : `Prijsberekening voor "${project.name}": ${indication.status}`,
      metadata: { pricingVersion: config.pricingVersion, requiresHuman: indication.requiresHuman },
    });

    if (indication.requiresHuman) {
      await activityRepository.log({
        leadId: project.leadId,
        type: "human_escalation",
        status: "completed",
        message: `READY FOR SILVIJN — project "${project.name}": ${indication.escalationReasons.join("; ") || "menselijke beoordeling van de prijsindicatie nodig"}`,
      });
    }

    return updated;
  }

  async getIndications(projectId: string) {
    return getPriceIndicationRepository().listByProject(projectId);
  }

  /** Intern escaleren — geen klantcommunicatie. */
  async sendToSilvijn(id: string, reason?: string): Promise<Project> {
    const project = await this.get(id);
    const updated = await this.updateStatus(id, "awaiting_approval");
    await getAIActivityRepository().log({
      leadId: project.leadId,
      type: "human_escalation",
      status: "completed",
      message: `Project "${project.name}" naar Silvijn geëscaleerd (intern): ${reason ?? "menselijke beoordeling/beslissing gevraagd"}`,
    });
    return updated;
  }

  async approvePrice(id: string): Promise<Project> {
    await humanRpc("approve_project_price", { p_project: id });
    return this.get(id);
  }

  async rejectPrice(id: string, reason?: string): Promise<Project> {
    await humanRpc("reject_project_price", { p_project: id, p_reason: reason ?? "" });
    return this.get(id);
  }

  /** Production can start through its payment/requirements gate; other manual transitions retain their RPC. */
  async updateStatus(id: string, status: ProjectStatus): Promise<Project> {
    if (status === "in_progress") await startProjectProduction(id);
    else await humanRpc("set_studio_project_status", { p_project: id, p_status: status });
    return this.get(id);
  }
}
