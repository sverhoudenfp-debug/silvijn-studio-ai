import "server-only";
import { createHash } from "node:crypto";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAIActivityRepository } from "@/lib/repositories/ai-activity-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getProjectRepository } from "@/lib/projects/repository";
import { getGeneratedWebsiteRepository } from "../repository";
import { getDesignPlanRepository } from "../design-plan-repository";
import { ContentPlanService, ContentPlanStaleError } from "../content/content-plan-service";
import { contentPlanTrustedClaims } from "../content/content-plan-consumption";
import type { ContentPlan } from "../content/content-plan";
import { validateDesignPlanConsistency, type DesignPlan, type DesignPlanRecord } from "../design-plan";
import type { ProjectRequirements } from "@/lib/projects/types";
import type { GeneratedWebsite } from "../types";
import type { WebsiteContactContext } from "../generator";
import { buildShopifyTheme } from "./theme-builder";
import { createThemeZip } from "./theme-zip";
import { certifyThemeFiles } from "./preflight";

import {
  getThemeZipArtifactRepository,
  type ThemeZipArtifact,
  type ThemeZipArtifactPreflight,
  type ThemeZipArtifactRepository,
} from "./repository";

/**
 * ThemeZipService (Fase I.2) — de Shopify theme-ZIP-generator.
 *
 * FLOW: gevalideerde GeneratedWebsite (framework shopify, inclusief
 * WebsiteSpecification) + voltooid intern Design Plan → deterministische
 * themabouw → ZIP → volledige validatie → privé opslag (Supabase Storage,
 * signed URLs) → artefact-record met versiebeheer.
 *
 * GARANTIES:
 * - De productie-poort (goedgekeurde scope/prijs, betaalplan, bevestigde
 *   betaling, complete requirements) geldt óók hier: zonder geldige
 *   menselijke goedkeuring/betaling wordt er géén ZIP gebouwd.
 * - Het ZIP is een INTERN artefact: geen download-URL's naar klanten, geen
 *   levering, geen handover (latere fases).
 * - Elke generatie is een nieuw versienummer; oudere ZIPs blijven bewaard.
 * - Alleen gevalideerde ZIPs worden opgeslagen in Storage; mislukte pogingen
 *   worden als artefact-record met fouten geregistreerd (audit-baar).
 */

export class ThemeZipGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThemeZipGenerationError";
  }
}

export const THEME_ZIP_BUCKET = "theme-artifacts";
const THEME_ZIP_MAX_DOWNLOAD_SECONDS = 300;

/** Website-statussen waarin een theme-ZIP (her)gegenereerd mag worden. */
const ZIP_ALLOWED_WEBSITE_STATUSES = new Set(["building", "ready_for_qc", "needs_revision"]);

function hashToHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface ThemeZipServiceOptions {
  /**
   * PRODUCTIE-POORT — verplicht injecteerd. De aanroeper (de websiteflow of
   * een interne action) geeft de bestaande poort mee (assertProductionAuthorized);
   * de service zelf importeert de poort-implementatie niet: losse koppeling
   * houdt de laag testbaar en voorkomt dubbele gate-implementaties.
   */
  productionGate: (projectId: string) => Promise<unknown>;
  artifactRepository?: ThemeZipArtifactRepository;
}

export class ThemeZipService {
  private readonly productionGate: (projectId: string) => Promise<unknown>;
  private readonly artifactRepository: ThemeZipArtifactRepository;

  constructor(options: ThemeZipServiceOptions) {
    this.productionGate = options.productionGate;
    this.artifactRepository = options.artifactRepository ?? getThemeZipArtifactRepository();
  }

  async listArtifacts(websiteId: string): Promise<ThemeZipArtifact[]> {
    return this.artifactRepository.listByWebsite(websiteId);
  }

  async getArtifact(id: string): Promise<ThemeZipArtifact | null> {
    return this.artifactRepository.getById(id);
  }

  /** Tijdelijke signed download-URL voor een opgeslagen ZIP (intern gebruik). */
  async createArtifactSignedUrl(artifactId: string): Promise<string> {
    const artifact = await this.artifactRepository.getById(artifactId);
    if (!artifact) throw new ThemeZipGenerationError("Theme-artefact niet gevonden");
    if (
      (artifact.status !== "certified" && artifact.status !== "passed") ||
      !artifact.storagePath ||
      !artifact.storageBucket
    ) {
      throw new ThemeZipGenerationError("Dit artefact heeft geen opgeslagen, gevalideerde ZIP.");
    }
    if (!isSupabaseConfigured()) {
      throw new ThemeZipGenerationError("Signed URL vereist een geconfigureerde Supabase-opslag.");
    }
    const { data, error } = await getSupabaseServerClient()
      .storage.from(artifact.storageBucket)
      .createSignedUrl(artifact.storagePath, THEME_ZIP_MAX_DOWNLOAD_SECONDS, { download: true });
    if (error || !data?.signedUrl) {
      throw new ThemeZipGenerationError(`Signed URL aanmaken mislukt: ${error?.message ?? "onbekend"}`);
    }
    return data.signedUrl;
  }

  /**
   * Genereert (of hergenereert) het theme-ZIP voor een website.
   * Volledig deterministisch: dezelfde specification + Design Plan leveren
   * byte-identieke ZIPs (op de vastgelegde ZIP-metadatum na).
   */
  async generateForWebsite(websiteId: string): Promise<ThemeZipArtifact> {
    // ---- 1. Website + guards
    const website = await getGeneratedWebsiteRepository().getById(websiteId);
    if (!website) throw new ThemeZipGenerationError("Website niet gevonden");
    if (website.framework !== "shopify") {
      throw new ThemeZipGenerationError("Theme-ZIPs worden alleen gegenereerd voor Shopify-websites.");
    }
    if (website.generationStatus !== "completed") {
      throw new ThemeZipGenerationError(
        "De websitegeneratie is nog niet geldig afgerond — er is geen gevalideerde WebsiteSpecification beschikbaar."
      );
    }
    if (!ZIP_ALLOWED_WEBSITE_STATUSES.has(website.status)) {
      throw new ThemeZipGenerationError(
        `Theme-ZIP-generatie is niet toegestaan voor een website met status "${website.status}" (toegestaan: building, ready_for_qc, needs_revision).`
      );
    }

    // ---- 2. PRODUCTIE-POORT (menselijke goedkeuring + betaling + requirements)
    await this.productionGate(website.projectId);

    // ---- 3. Project + voltooid Design Plan (verplichte input)
    const project = await getProjectRepository().getById(website.projectId);
    if (!project) throw new ThemeZipGenerationError("Project niet gevonden");
    const designPlan = await this.requireCompletedDesignPlan(website.projectId, project.requirements);

    // ---- 3a. C3d: ACTUEEL CONTENTPLAN (optioneel — géén plan = legacy-flow).
    //      Een completed maar verouderd plan is een expliciete, fail-loud
    //      weigering: nooit stilletjes content leveren die afwijkt van wat
    //      de owner in het ContentPlan-paneel zag. Alleen een actueel plan
    //      (source-fingerprint identiek aan de bronnen) wordt geconsumeerd;
    //      het plan vult uitsluitend bestaande blueprint-slots per exact
    //      pad — secties worden nooit toegevoegd, verwijderd of herordend.
    let contentPlan: ContentPlan | null = null;
    const contentPlanService = new ContentPlanService();
    try {
      contentPlan = await contentPlanService.getConsumablePlan(designPlan.id);
    } catch (error) {
      if (error instanceof ContentPlanStaleError) {
        throw new ThemeZipGenerationError(
          `ContentPlan v${error.existing.version} is verouderd — de bronnen zijn gewijzigd sinds de laatste content-pass. Genereer het ContentPlan opnieuw op de projectdetailpagina voordat het theme-ZIP wordt opgebouwd (geen verzonnen of afwijkende content leveren).`
        );
      }
      throw error;
    }

    // ---- 4. Echte contactcontext (nooit door de AI verzonnen)
    const lead = await getLeadRepository().get(website.leadId);
    if (!lead) throw new ThemeZipGenerationError("Lead niet gevonden");
    const contact: WebsiteContactContext = {
      phone: lead.phone,
      email: lead.email,
      address: lead.address,
      city: lead.city,
      province: lead.province,
    };

    // ---- 5. Deterministisch bouwen + zippen + valideren
    const version = await this.nextVersion(websiteId);
    const fileName = `${website.slug}-theme-v${version}.zip`;
    const built = buildShopifyTheme({
      specification: website.specification,
      designPlan: designPlan.plan,
      contact,
      contentPlan,
    });
    // Fase C: trustElements uit het blueprint zijn bewezen echte claims
    // (bron-verplicht, upstream Zod-gevalideerd); zij mogen de
    // fabricatie-net-scan rechtvaardig passeren.
    const trustedClaims = designPlan.plan.blueprint
      ? [
          ...designPlan.plan.blueprint.trustElements.usps.map((u) => u.label),
          ...designPlan.plan.blueprint.trustElements.stats.map((s) => `${s.value} ${s.label}`),
          ...designPlan.plan.blueprint.trustElements.badges.map((b) => b.label),
        ]
      : [];
    // C3d: fact-locked ContentPlan-units zijn verbatim brondata (met
    // sourceOrigin) — dezelfde eerlijke status als trustElements: zij
    // mogen de fabricatie-scan passeren. AI-geformuleerde copy (generated)
    // blijft ONtrusting: de scan beoordeelt die gewoon.
    if (contentPlan) {
      trustedClaims.push(...contentPlanTrustedClaims(contentPlan));
    }
    // Theme Certification: de ZIP wordt pas gebouwd nadat de volledige
    // preflight (deterministische contractchecks + extern Shopify Theme
    // Check + veilige zelfreparatie) is doorstaan. De ZIP-bytes komen uit
    // de gecertificeerde bestanden: wat bewezen is, is wat geleverd wordt.
    const certification = await certifyThemeFiles(built.files, { trustedClaims });
    const zipBytes = await createThemeZip(certification.files);

    const preflightReport: ThemeZipArtifactPreflight = {
      status: certification.result.status,
      criticalErrors: certification.result.criticalErrors,
      warnings: certification.result.warnings,
      checks: certification.result.checks.map((c) => ({
        id: c.id,
        title: c.title,
        result: c.result,
        errors: c.errors,
        warnings: c.warnings,
        ...(c.note ? { note: c.note } : {}),
      })),
      externalRan: certification.result.external?.ran ?? false,
      ...(certification.result.external?.note ? { externalNote: certification.result.external.note } : {}),
      repairs: certification.repairs.map((r) => `${r.id}: ${r.description}`),
    };
    const validation = {
      passed: certification.result.passed,
      errors: certification.result.criticalErrors,
      fileCount: certification.result.fileCount,
      totalBytes: certification.result.totalBytes,
    };

    if (!validation.passed) {
      const artifact = await this.artifactRepository.create({
        websiteId: website.id,
        projectId: website.projectId,
        leadId: website.leadId,
        version,
        status: "preflight_failed",
        fileName,
        sizeBytes: zipBytes.byteLength,
        fileCount: validation.fileCount,
        checksumSha256: hashToHex(zipBytes),
        validationErrors: validation.errors,
        preflight: preflightReport,
      });
      await getAIActivityRepository().log({
        leadId: website.leadId,
        type: "theme_zip_generation",
        status: "failed",
        message: `Theme-ZIP voor "${website.businessName}" (v${version}) faalde validatie: ${validation.errors[0]}`,
        metadata: { websiteId: website.id, projectId: website.projectId, version, errors: validation.errors.slice(0, 10) },
      });
      return artifact;
    }

    // ---- 6. Privé opslag (Supabase Storage; in mock-mode zonder opslag)
    let storageBucket: string | null = null;
    let storagePath: string | null = null;
    if (isSupabaseConfigured()) {
      storageBucket = THEME_ZIP_BUCKET;
      storagePath = `${website.projectId}/${website.id}/theme-v${version}.zip`;
      const { error } = await getSupabaseServerClient()
        .storage.from(THEME_ZIP_BUCKET)
        .upload(storagePath, zipBytes, {
          contentType: "application/zip",
          upsert: false,
        });
      if (error) {
        throw new ThemeZipGenerationError(`Theme-ZIP opslaan mislukt: ${error.message}`);
      }
    }

    const artifact = await this.artifactRepository.create({
      websiteId: website.id,
      projectId: website.projectId,
      leadId: website.leadId,
      version,
      status: "certified",
      fileName,
      sizeBytes: zipBytes.byteLength,
      fileCount: validation.fileCount,
      checksumSha256: hashToHex(zipBytes),
      storageBucket,
      storagePath,
      validationErrors: [],
      preflight: preflightReport,
    });

    await getAIActivityRepository().log({
      leadId: website.leadId,
      type: "theme_zip_generation",
      status: "completed",
      message: `Theme-ZIP gegenereerd en GECERTIFICEERD voor "${website.businessName}" (v${version}, ${validation.fileCount} bestanden, intern artefact — geen levering)${contentPlan ? ` — content uit ContentPlan op ${built.notes.length} compositie-notitie(s), ${contentPlanTrustedClaims(contentPlan).length} fact-locked claim(s) vertrouwd richting validatie` : " — geen ContentPlan, content uit de specification (legacy-flow)"}`,
      metadata: {
        websiteId: website.id,
        projectId: website.projectId,
        version,
        sizeBytes: zipBytes.byteLength,
        fileCount: validation.fileCount,
        checksumSha256: artifact.checksumSha256,
        ...(contentPlan ? { contentPlanConsumed: true } : { contentPlanConsumed: false }),
      },
    });
    return artifact;
  }

  /** Nieuw versienummer: eerdere artefacten blijven onaangeroerd bewaard. */
  private async nextVersion(websiteId: string): Promise<number> {
    const existing = await this.artifactRepository.listByWebsite(websiteId);
    return existing.length > 0 ? Math.max(...existing.map((a) => a.version)) + 1 : 1;
  }

  private async requireCompletedDesignPlan(
    projectId: string,
    requirements: ProjectRequirements
  ): Promise<DesignPlanRecord & { plan: DesignPlan }> {
    const records = await getDesignPlanRepository().listByProject(projectId);
    const completed = records.find((r) => r.status === "completed" && r.plan !== null);
    if (!completed || !completed.plan) {
      throw new ThemeZipGenerationError(
        "Er is geen voltooid Design Plan voor dit project — het theme-ZIP vereist een gevalideerd intern ontwerpplan (genereer het plan eerst op de projectdetailpagina)."
      );
    }
    // Opnieuw deterministisch controleren: het plan moet nog steeds consistent
    // zijn met de actuele requirements (scope/prijsintegriteit).
    const consistency = validateDesignPlanConsistency(completed.plan, requirements);
    if (!consistency.passed) {
      throw new ThemeZipGenerationError(
        `Het voltooide Design Plan is niet meer consistent met de actuele requirements: ${consistency.errors[0]}`
      );
    }
    return completed as DesignPlanRecord & { plan: DesignPlan };
  }
}

/** Artefacten van een website (voor interne weergave). */
export async function listThemeZipArtifacts(website: GeneratedWebsite): Promise<ThemeZipArtifact[]> {
  const service = new ThemeZipService({ productionGate: () => Promise.resolve() });
  return service.listArtifacts(website.id);
}
