import { humanRpc, requireStudioOwner } from "@/lib/auth/server";
import { getAIActivityRepository } from "@/lib/repositories/ai-activity-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getProjectRepository } from "@/lib/projects/repository";
import type { Project } from "@/lib/projects/types";
import { AIService, getWebsiteQCTier } from "@/lib/ai/service";
import { readAIAttemptMetadata } from "@/lib/ai/errors";
import { getGeneratedWebsiteRepository } from "@/lib/websites/repository";
import type { GeneratedWebsite } from "@/lib/websites/types";
import type { QCAnalysis } from "./ai-types";
import { runDeterministicChecks } from "./checks";
import { computeOverallResult, computeScore, summarizeCategoryResults } from "./rules";
import { getQualityControlRepository } from "./repository";
import {
  type QCCategoryCheck,
  type QCIssue,
  type QualityControl,
} from "./types";
import { worstResult } from "./types";

/**
 * QualityControlService (Fase 10).
 *
 * GENERATED WEBSITE → DETERMINISTIC CHECKS + AI QUALITY ANALYSIS →
 * COMBINED QC REPORT → PASS / NEEDS_REVISION / FAIL →
 * READY_FOR_SILVIJN → HUMAN APPROVAL → APPROVED.
 *
 * Harde autonomie-grens: de AI analyseert, classificeert en beveelt aan —
 * maar keurt NOOIT goed namens Silvijn, levert/publiceert nooit, mailt
 * nooit en overrult de deterministische FAIL-regels nooit.
 * READY_FOR_SILVIJN → APPROVED is alléén een menselijke actie
 * (server action). Er is geen override.
 */

export class QualityControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QualityControlError";
  }
}

/**
 * Agency-user-abstraction voor de approver. Een volledig auth-systeem
 * bestaat nog niet; zodra dat er is, wordt dit de echte ingelogde gebruiker.
 */
export async function getApproverName(): Promise<string> {
  return (await requireStudioOwner()).user.id;
}

function summarizeRequirements(project: Project): string {
  const requirements = project.requirements;
  const parts: string[] = [];
  if (requirements.websiteType) parts.push(`type: ${requirements.websiteType}`);
  if (requirements.numberOfPages != null) parts.push(`pagina's: ${requirements.numberOfPages}`);
  if (requirements.designLevel) parts.push(`design: ${requirements.designLevel}`);
  if (requirements.ecommerce === true) parts.push("e-commerce: ja");
  if (requirements.customFunctionality) parts.push(`custom: ${requirements.customFunctionality}`);
  if (requirements.integrations?.length) parts.push(`integraties: ${requirements.integrations.join(", ")}`);
  if (requirements.seo === true) parts.push("seo: ja");
  if (requirements.copywriting != null) parts.push(`teksten: ${requirements.copywriting ? "agency verzorgt" : "klant verzorgt"}`);
  return parts.join("; ") || "geen specifieke requirements bekend";
}

function summarizeSpecification(website: GeneratedWebsite): string {
  const spec = website.specification;
  return [
    `template: ${spec.template}`,
    `headline: ${spec.content.headline}`,
    spec.content.subheadline ? `subheadline: ${spec.content.subheadline}` : "subheadline: ontbreekt",
    `diensten: ${spec.content.services.map((s) => s.title).join(", ") || "geen"}`,
    spec.content.about ? "over-ons: aanwezig" : "over-ons: ontbreekt",
    `testimonials: ${spec.content.testimonials.length}`,
    `primaire CTA: ${spec.content.ctaPrimaryText}`,
    `missingInformation: ${spec.missingInformation.length} punten`,
  ].join(" | ");
}

function summarizeSections(website: GeneratedWebsite): string {
  const sections = website.generatedContent?.sections ?? [];
  return sections
    .map((section) => {
      const data = section.data as Record<string, unknown>;
      const headline = typeof data.headline === "string" ? data.headline : "";
      return `${section.type}${headline ? ` ("${headline.slice(0, 60)}")` : ""}`;
    })
    .join(" | ");
}

export class QualityControlService {
  private readonly aiService: AIService;

  /** Optioneel injecteerbaar voor regressietests; productie gebruikt de echte AIService. */
  constructor(aiService?: AIService) {
    this.aiService = aiService ?? new AIService();
  }

  async getQcById(id: string): Promise<QualityControl> {
    const record = await getQualityControlRepository().getById(id);
    if (!record) throw new QualityControlError("QC-rapport niet gevonden");
    return record;
  }

  async getLatestQcForWebsite(websiteId: string): Promise<QualityControl | null> {
    return getQualityControlRepository().getLatestByWebsiteId(websiteId);
  }

  async listQcHistory(websiteId: string): Promise<QualityControl[]> {
    return getQualityControlRepository().listByWebsiteId(websiteId);
  }

  async listQcByProject(projectId: string): Promise<QualityControl[]> {
    return getQualityControlRepository().listByProjectId(projectId);
  }

  /**
   * Volledige QC-run — expliciete interne actie. Eén gecontroleerde
   * AI-call (adviserend); alle harde regels zijn deterministisch.
   */
  async runQualityControl(websiteId: string): Promise<QualityControl> {
    const website = await getGeneratedWebsiteRepository().getById(websiteId);
    if (!website) throw new QualityControlError("Website niet gevonden");

    if (!["ready_for_qc", "needs_revision"].includes(website.status)) {
      throw new QualityControlError(
        `Kwaliteitscontrole kan alleen op een website met status ready_for_qc of needs_revision (huidig: ${website.status})`
      );
    }
    if (website.buildStatus !== "passed") {
      throw new QualityControlError(`Kwaliteitscontrole vereist een geslaagde build (huidig: ${website.buildStatus})`);
    }

    const runningQc = await getQualityControlRepository().getLatestByWebsiteId(websiteId);
    if (runningQc?.status === "running") {
      throw new QualityControlError("Er draait al een kwaliteitscontrole voor deze websiteversie");
    }

    const lead = await getLeadRepository().get(website.leadId);
    if (!lead) throw new QualityControlError("Lead niet gevonden");
    const project = await getProjectRepository().getById(website.projectId);
    if (!project) throw new QualityControlError("Project niet gevonden");

    await getGeneratedWebsiteRepository().update(website.id, { status: "qc_running" });

    await getAIActivityRepository().log({
      leadId: lead.id,
      type: "website_quality_control",
      status: "started",
      message: `Kwaliteitscontrole gestart voor "${lead.businessName}" website v${website.version}`,
      metadata: { websiteId: website.id, projectId: project.id, websiteVersion: website.version },
    });

    // Fix 2026-09-19: het record start met de DAADWERKELIJK geplande AI-call
    // (mode + model), niet met de misleidende init-waarde "mock"/"n.v.t." —
    // een live run toonde anders mock, ook als de call live faalde.
    const aiAttempt = this.aiService.attemptInfo("website_quality_control", getWebsiteQCTier());
    let qc = await getQualityControlRepository().create({
      generatedWebsiteId: website.id,
      projectId: project.id,
      leadId: lead.id,
      websiteVersion: website.version,
      status: "running",
      mode: aiAttempt.mode,
      model: aiAttempt.mode === "mock" ? `${aiAttempt.model} (mock)` : aiAttempt.model,
    });

    // ---- 1. DETERMINISTISCHE CHECKS (prioriteit voor harde regels)
    const deterministic = runDeterministicChecks({ website, lead, project });
    const mergedChecks: QCCategoryCheck[] = deterministic.checks.map((check) => ({ ...check, issues: [...check.issues] }));
    const mergedIssues: QCIssue[] = [...deterministic.issues];

    // ---- 2. AI QUALITY ANALYSIS (adviserend, 1 gecontroleerde AI-call)
    let aiSummary = "Geen AI-analyse beschikbaar.";
    let recommendations: string[] = [];
    let mode: "mock" | "live" = "mock";
    let model = "geen";

    try {
      const ai = await this.aiService.generateWebsiteQualityAnalysis(
        {
          businessName: lead.businessName,
          industry: lead.industry,
          city: lead.city,
          leadStatus: lead.leadStatus,
          requirementsSummary: summarizeRequirements(project),
          specificationSummary: summarizeSpecification(website),
          generatedSectionsSummary: summarizeSections(website),
          deterministicResults: `${summarizeCategoryResults(deterministic.checks)} | issues: ${
            deterministic.issues.map((i) => `${i.category}/${i.severity}: ${i.message}`).join(" ;; ") || "geen"
          }`,
        },
        lead.id
      );
      const analysis: QCAnalysis = ai.data;
      mode = ai.mode;
      model = ai.model;

      // AI-issues mergen: alléén verzwaren, nooit afzwakken (worst-merge)
      const aiIssuesByCategory = new Map<string, QCIssue[]>();
      for (const [categoryKey, assessment] of [
        ["content", analysis.contentAssessment],
        ["design", analysis.designAssessment],
        ["responsive", analysis.responsiveAssessment],
        ["conversion", analysis.conversionAssessment],
        ["business_accuracy", analysis.businessAccuracyAssessment],
      ] as const) {
        // Fix 2026-09-19: de AI mag de deterministische laag niet onterecht
        // verzwaren (live-incident: AI escaleerde no_contact_methods naar
        // critical terwijl het contactformulier aanwezig was, waardoor een
        // verbeterde website lager scoorde). "critical" is daarom voorbehouden
        // aan de deterministische laag; AI-issues worden gemaximeerd tot "error".
        const aiIssues: QCIssue[] = assessment.issues.map((issue, index) => ({
          id: `ai-${categoryKey}-${index + 1}`,
          category: categoryKey as QCIssue["category"],
          severity: issue.severity === "critical" ? "error" : issue.severity,
          rule: "ai",
          message: issue.message,
        }));
        aiIssuesByCategory.set(categoryKey, aiIssues);
        mergedIssues.push(...aiIssues);

        const check = mergedChecks.find((c) => c.category === categoryKey);
        if (check) {
          check.issues = [...check.issues, ...aiIssues];
          check.result = worstResult(check.result, assessment.result);
          if (assessment.notes) check.notes = [...check.notes, assessment.notes];
        }
      }

      aiSummary = analysis.summary;
      recommendations = analysis.recommendations;
    } catch (error) {
      // AI-failure is géén QC-pass: rapport wordt FAILED en de website keert
      // terug naar ready_for_qc. Deterministische resultaten blijven bewaard.
      const reason = error instanceof Error ? error.message : "Onbekende fout";
      // Fix 2026-09-19: een FAILED live AI-call mag niet als mode=mock in
      // het rapport blijven staan. De AI-service zet de pogings-metadata
      // (echte mode + model) op de fout; die is hier de autoriteit. Zonder
      // metadata (fout vóór de provider) blijft de create-waarde staan.
      const failedAttempt = readAIAttemptMetadata(error);
      qc = (await getQualityControlRepository().update(qc.id, {
        status: "failed",
        ...(failedAttempt
          ? {
              mode: failedAttempt.mode,
              model: failedAttempt.model,
            }
          : {}),
        checks: mergedChecks,
        issues: mergedIssues,
        recommendations: ["Voer de kwaliteitscontrole opnieuw uit nadat de AI-analyse beschikbaar is."],
        aiSummary: `AI-analyse mislukt: ${reason}. Deterministische resultaten zijn bewaard in dit rapport.`,
      })) ?? qc;
      await getGeneratedWebsiteRepository().update(website.id, { status: "ready_for_qc" });
      await getAIActivityRepository().log({
        leadId: lead.id,
        type: "website_quality_control",
        status: "failed",
        message: `Kwaliteitscontrole mislukt voor "${lead.businessName}" website v${website.version}: ${reason}`,
        metadata: { websiteId: website.id, projectId: project.id },
      });
      return qc;
    }

    // ---- 3. COMBINED REPORT + AUTOMATISCHE RESULT-REGELS (deterministisch)
    const overallResult = computeOverallResult(mergedChecks, mergedIssues);
    const score = computeScore(mergedChecks, mergedIssues);
    const warnings = mergedIssues.filter((i) => i.severity === "warning").map((i) => i.message);
    const passedChecks = mergedChecks.filter((c) => c.result === "passed" || c.result === "warning").map((c) => c.category);
    const failedChecks = mergedChecks.filter((c) => c.result === "failed").map((c) => c.category);

    const finalStatus: QualityControl["status"] = "completed";
    const websiteStatus: GeneratedWebsite["status"] =
      overallResult === "pass" ? "ready_for_silvijn" : overallResult === "needs_revision" ? "needs_revision" : "failed";

    qc = (await getQualityControlRepository().update(qc.id, {
      status: finalStatus,
      overallResult,
      checks: mergedChecks,
      issues: mergedIssues,
      warnings,
      passedChecks,
      failedChecks,
      recommendations,
      aiSummary,
      score,
      mode,
      model,
    })) ?? qc;

    await getGeneratedWebsiteRepository().update(website.id, { status: websiteStatus });

    await getAIActivityRepository().log({
      leadId: lead.id,
      type: "website_quality_control",
      status: "completed",
      message: `Kwaliteitscontrole voltooid voor "${lead.businessName}" website v${website.version}: ${overallResult.toUpperCase()} (score ${score}/100) → ${websiteStatus.toUpperCase()}`,
      metadata: {
        websiteId: website.id,
        projectId: project.id,
        qcId: qc.id,
        overallResult,
        score,
        model,
        mode,
      },
    });

    return qc;
  }

  /**
   * MENSelijke approval — de harde gate. Server action only; de AI kan
   * deze status nooit zetten. Guards: QC voltooid + PASS + geen critical
   * issues + build geslaagd + security niet failed.
   */
  async approveWebsite(websiteId: string): Promise<{ website: GeneratedWebsite; qc: QualityControl }> {
    await humanRpc("approve_studio_website", { p_website: websiteId });
    const website = await getGeneratedWebsiteRepository().getById(websiteId);
    const qc = await getQualityControlRepository().getLatestByWebsiteId(websiteId);
    if (!website || !qc) throw new QualityControlError("Goedgekeurde versie kon niet worden geladen");
    return { website, qc };
  }

  /**
   * REVISION REQUEST — menselijke actie met reden. De bestaande versie
   * blijft bewaard; een nieuwe generatie (v{n+1}) kan daarna via de
   * bestaande websitegeneratie-flow ontstaan. Nooit overschrijven.
   */
  async requestWebsiteRevision(
    websiteId: string,
    reason: string,
    options?: { selectedIssueIds?: string[]; notes?: string }
  ): Promise<{ website: GeneratedWebsite; qc: QualityControl }> {
    await humanRpc("review_studio_website", { p_website: websiteId, p_action: "revision_requested", p_reason: reason, p_issues: options?.selectedIssueIds ?? [], p_notes: options?.notes ?? "" });
    const website = await getGeneratedWebsiteRepository().getById(websiteId);
    const qc = await getQualityControlRepository().getLatestByWebsiteId(websiteId);
    if (!website || !qc) throw new QualityControlError("Revisiebesluit kon niet worden geladen");
    return { website, qc };
  }

  /** ARCHIVE — menselijke actie; de versie blijft bewaard en terugvindbaar. */
  async archiveWebsite(websiteId: string): Promise<GeneratedWebsite> {
    await humanRpc("review_studio_website", { p_website: websiteId, p_action: "archived" });
    const website = await getGeneratedWebsiteRepository().getById(websiteId);
    if (!website) throw new QualityControlError("Gearchiveerde versie kon niet worden geladen");
    return website;
  }
}
