import { assertProductionAuthorized } from "@/lib/payments/service";
import { getAIActivityRepository } from "@/lib/repositories/ai-activity-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getProjectRepository } from "@/lib/projects/repository";
import { AIService } from "@/lib/ai/service";
import type { ProjectRequirements } from "@/lib/projects/types";
import { selectTemplateForIndustry } from "./templates";
import { getWebsiteGeneratorProvider, type WebsiteContactContext } from "./generator";
import { WebsiteBuildService } from "./build-service";
import { getGeneratedWebsiteRepository } from "./repository";
import { ThemeZipService } from "./theme-zip/service";
import type { GeneratedWebsite, WebsiteSpecification } from "./types";

/**
 * WebsiteGenerationService (Fase 9).
 *
 * PROJECT → REQUIREMENTS → AI PLANNING → WebsiteSpecification →
 * VALIDATION → DETERMINISTISCHE GENERATOR → GeneratedWebsite →
 * BUILD/VALIDATION → READY_FOR_QC.
 *
 * Garanties:
 * - De AI levert alleen een Zod-gevalideerde specificatie — géén code.
 * - Generatie is een expliciete interne actie; er is NOOIT klantdelivery:
 *   geen deployment, geen e-mail, geen publicatie — de output eindigt bij
 *   READY_FOR_QC (menselijke quality control volgt in Fase 10).
 * - Versies worden bewaard: regeneratie archiveert de vorige versie en
 *   vernietigt nooit data.
 * - Guards: project moet bestaan en niet cancelled/completed zijn; de lead
 *   moet een geschikte status hebben (qualified/interested/contacted/won).
 */

export class WebsiteGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebsiteGenerationError";
  }
}

export class WebsiteLimitError extends Error {
  constructor(limit: number) {
    super(`Websitegeneratie-limiet bereikt (${limit} per run)`);
    this.name = "WebsiteLimitError";
  }
}

export function getMaxWebsiteGenerationsPerRun(): number {
  const parsed = Number.parseInt(process.env.MAX_WEBSITE_GENERATIONS_PER_RUN ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10) : 3;
}

/** Lead-statussen waarin websitegeneratie is toegestaan. */
const ALLOWED_LEAD_STATUSES = new Set(["qualified", "contacted", "interested", "won"]);
/** Project-statussen waarin generatie is toegestaan (NOT cancelled/completed). */
const BLOCKED_PROJECT_STATUSES = new Set(["cancelled", "completed"]);

// Slugify is gecentraliseerd in ./slug (gedeeld met de QC-security-check).
export { slugifyBusinessName } from "./slug";
import { slugifyBusinessName } from "./slug";

function summarizeRequirements(requirements: ProjectRequirements): string {
  const parts: string[] = [];
  if (requirements.websiteType) parts.push(`type: ${requirements.websiteType}`);
  if (requirements.numberOfPages != null) parts.push(`pagina's: ${requirements.numberOfPages}`);
  if (requirements.designLevel) parts.push(`design: ${requirements.designLevel}`);
  if (requirements.ecommerce === true) parts.push("e-commerce: ja");
  if (requirements.customFunctionality) parts.push(`custom: ${requirements.customFunctionality}`);
  if (requirements.integrations?.length) parts.push(`integraties: ${requirements.integrations.join(", ")}`);
  if (requirements.seo === true) parts.push("seo: ja");
  if (requirements.copywriting === true) parts.push("teksten: te verzorgen");
  if (requirements.deadline) parts.push(`deadline: ${requirements.deadline}`);
  return parts.join("; ") || "geen specifieke requirements bekend";
}

export class WebsiteGenerationService {
  private aiService = new AIService();
  private buildService = new WebsiteBuildService();
  private generationsThisRun = 0;

  async get(id: string): Promise<GeneratedWebsite> {
    const website = await getGeneratedWebsiteRepository().getById(id);
    if (!website) throw new WebsiteGenerationError("Website niet gevonden");
    return website;
  }

  async getBySlug(slug: string): Promise<GeneratedWebsite | null> {
    return getGeneratedWebsiteRepository().getBySlug(slug);
  }

  async list(): Promise<GeneratedWebsite[]> {
    return getGeneratedWebsiteRepository().list();
  }

  async listByProject(projectId: string): Promise<GeneratedWebsite[]> {
    return getGeneratedWebsiteRepository().listByProject(projectId);
  }

  /**
   * Volledige websitegeneratie — expliciete interne actie.
   * Eén gecontroleerde AI-call voor de planning; de rest is deterministisch.
   */
  async generateWebsite(projectId: string, framework: "nextjs" | "shopify" = "shopify"): Promise<GeneratedWebsite> {
    await assertProductionAuthorized(projectId);
    // ---- 1. Project ophalen + guards (guard-failures consumeren géén AI-budget)
    const project = await getProjectRepository().getById(projectId);
    if (!project) throw new WebsiteGenerationError("Project niet gevonden");
    if (BLOCKED_PROJECT_STATUSES.has(project.status)) {
      throw new WebsiteGenerationError(
        `Websitegeneratie is niet toegestaan voor een ${project.status === "cancelled" ? "geannuleerd" : "afgerond"} project`
      );
    }

    // ---- 2. Lead ophalen + statusguard
    const lead = await getLeadRepository().get(project.leadId);
    if (!lead) throw new WebsiteGenerationError("Lead niet gevonden");
    if (!ALLOWED_LEAD_STATUSES.has(lead.leadStatus)) {
      throw new WebsiteGenerationError(
        `Lead-status "${lead.leadStatus}" is niet geschikt voor websitegeneratie (vereist: qualified, interested, contacted of won)`
      );
    }

    // ---- 2b. Generatie-limiet (pas na de guards — guards kosten geen AI)
    this.generationsThisRun += 1;
    const max = getMaxWebsiteGenerationsPerRun();
    if (this.generationsThisRun > max) throw new WebsiteLimitError(max);

    // ---- 3. Versie + slug (regeneratie archiveert de vorige versie, niets wordt verwijderd)
    const previousVersions = await getGeneratedWebsiteRepository().listByProject(projectId);
    const version = previousVersions.length > 0 ? Math.max(...previousVersions.map((w) => w.version)) + 1 : 1;
    const slug = await this.generateUniqueSlug(lead.businessName, version);
    const previewUrl = `/generated-websites/${slug}`;

    // Alleen nog-lopende versies archiveren; APPROVED (menselijk besluit),
    // FAILED en reeds gearchiveerde versies blijven ongemoeerd — de
    // versiegeschiedenis is de bron van waarheid (Fase 10).
    const archivableStatuses = new Set(["ready_for_qc", "qc_running", "needs_revision"]);
    for (const previous of previousVersions) {
      if (archivableStatuses.has(previous.status)) {
        await getGeneratedWebsiteRepository().update(previous.id, { status: "archived" });
      }
    }

    // ---- 4. Record aanmaken (status: generating)
    const suggestedTemplate = selectTemplateForIndustry(lead.industry);
    const website = await getGeneratedWebsiteRepository().create({
      projectId,
      leadId: lead.id,
      slug,
      businessName: lead.businessName,
      websiteType: suggestedTemplate,
      framework,
      template: suggestedTemplate,
      specification: {} as WebsiteSpecification,
      previewUrl,
      version,
    });

    await getAIActivityRepository().log({
      leadId: lead.id,
      type: "website_generation",
      status: "started",
      message: `Websitegeneratie gestart voor "${lead.businessName}" (v${version}, template-suggestie: ${suggestedTemplate})`,
      metadata: { projectId, version, framework },
    });

    try {
      // ---- 5. AI WEBSITE PLANNING (enige AI-call)
      await getGeneratedWebsiteRepository().update(website.id, { generationStatus: "planning" });
      const planning = await this.aiService.generateWebsiteSpecification(
        {
          businessName: lead.businessName,
          industry: lead.industry,
          city: lead.city,
          province: lead.province,
          address: lead.address,
          phone: lead.phone,
          email: lead.email,
          website: lead.website,
          leadNotes: lead.notes,
          requirementsSummary: summarizeRequirements(project.requirements),
          existingWebsite: lead.websiteStatus === "has_website" || lead.websiteStatus === "website_poor",
          googleRating: lead.googleRating,
          reviewCount: lead.reviewCount,
          suggestedTemplate,
        },
        project.requirements,
        lead.id
      );
      const specification = planning.data;

      // ---- 6. DETERMINISTISCHE GENERATIE (gecontroleerde componenten)
      await getGeneratedWebsiteRepository().update(website.id, {
        generationStatus: "generating",
        specification,
      });
      const provider = getWebsiteGeneratorProvider(framework);
      const contact: WebsiteContactContext = {
        phone: lead.phone,
        email: lead.email,
        address: lead.address,
        city: lead.city,
        province: lead.province,
      };
      const generated = provider.generate(specification, contact);

      // ---- 7. BUILD / VALIDATION
      await getGeneratedWebsiteRepository().update(website.id, {
        generationStatus: "validating",
        generatedContent: generated.content,
        status: "building",
        buildStatus: "building",
      });
      const build = this.buildService.build(
        specification,
        generated.content,
        {
          allowedPhone: lead.phone,
          allowedEmail: lead.email,
          allowedRating: lead.googleRating,
          allowedReviewCount: lead.reviewCount,
          leadNotes: lead.notes,
        }
      );

      if (!build.passed) {
        const failed = await getGeneratedWebsiteRepository().update(website.id, {
          status: "failed",
          generationStatus: "failed",
          buildStatus: "failed",
          buildErrors: build.errors,
          generationNotes: `Generatie mislukt bij build/validatie (v${version}): ${generated.notes.join(" ")}`,
        });
        await getAIActivityRepository().log({
          leadId: lead.id,
          type: "website_generation",
          status: "failed",
          message: `Websitegeneratie voor "${lead.businessName}" mislukt bij validatie (v${version}): ${build.errors[0]}`,
          metadata: { projectId, version, buildErrors: build.errors.slice(0, 5) },
        });
        return failed ?? this.get(website.id);
      }

      // ---- 8. SHOPIFY THEME-ZIP (Fase I.2): het echte productie-artefact.
      //      De productie-poort geldt al (stap 0); het ZIP is intern en wordt
      //      pas na volledige validatie privé opgeslagen. Validatie-falen
      //      maakt de website FAILED met de ZIP-fouten — nooit een kap theme.
      if (framework === "shopify") {
        const zipArtifact = await new ThemeZipService({ productionGate: assertProductionAuthorized }).generateForWebsite(website.id);
        if (zipArtifact.status !== "passed") {
          const zipErrors = zipArtifact.validationErrors.length > 0
            ? zipArtifact.validationErrors
            : ["Theme-ZIP-validatie faalde zonder foutdetails."];
          const failedZip = await getGeneratedWebsiteRepository().update(website.id, {
            status: "failed",
            generationStatus: "failed",
            buildStatus: "failed",
            buildErrors: zipErrors,
            generationNotes: `Generatie mislukt bij theme-ZIP-validatie (v${version}): ${zipErrors[0]}`,
          });
          await getAIActivityRepository().log({
            leadId: lead.id,
            type: "website_generation",
            status: "failed",
            message: `Websitegeneratie voor "${lead.businessName}" faalde bij theme-ZIP-validatie (v${version}): ${zipErrors[0]}`,
            metadata: { projectId, version, zipErrors: zipErrors.slice(0, 5) },
          });
          return failedZip ?? this.get(website.id);
        }
      }

      // ---- 9. READY FOR QUALITY CONTROL (eindpunt van Fase 9)
      const ready = await getGeneratedWebsiteRepository().update(website.id, {
        status: "ready_for_qc",
        generationStatus: "completed",
        buildStatus: "passed",
        buildErrors: [],
        generationNotes: generated.notes.join(" ") + ` Model: ${planning.model}. Status: READY FOR QC — wacht op menselijke quality control.`,
      });
      await getAIActivityRepository().log({
        leadId: lead.id,
        type: "website_generation",
        status: "completed",
        message: `Website gegenereerd voor "${lead.businessName}" (v${version}) — READY FOR QC (geen klantdelivery)`,
        metadata: {
          projectId,
          version,
          model: planning.model,
          mode: planning.mode,
          durationMs: planning.durationMs,
          cost: planning.estimatedCost,
          tokens: planning.usage,
        },
      });
      return ready ?? this.get(website.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Onbekende fout";
      await getGeneratedWebsiteRepository().update(website.id, {
        status: "failed",
        generationStatus: "failed",
        buildErrors: [reason],
        generationNotes: `Generatie mislukt (v${version}).`,
      });
      await getAIActivityRepository().log({
        leadId: lead.id,
        type: "website_generation",
        status: "failed",
        message: `Websitegeneratie voor "${lead.businessName}" mislukt (v${version}): ${reason}`,
        metadata: { projectId, version },
      });
      throw error;
    }
  }

  private async generateUniqueSlug(businessName: string, version: number): Promise<string> {
    const base = slugifyBusinessName(businessName);
    let slug = `${base}-v${version}`;
    let suffix = 2;
    while (await getGeneratedWebsiteRepository().getBySlug(slug)) {
      slug = `${base}-v${version}-${suffix}`;
      suffix += 1;
    }
    return slug;
  }
}
