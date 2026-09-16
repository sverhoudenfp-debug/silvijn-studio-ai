import { getAIActivityRepository } from "@/lib/repositories/ai-activity-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getProjectRepository } from "@/lib/projects/repository";
import type { Project } from "@/lib/projects/types";
import { AIService } from "@/lib/ai/service";
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
export function getApproverName(): string {
  return (process.env.AGENCY_APPROVER_NAME ?? "").trim() || "Silvijn";
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
  private aiService = new AIService();

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

    let qc = await getQualityControlRepository().create({
      generatedWebsiteId: website.id,
      projectId: project.id,
      leadId: lead.id,
      websiteVersion: website.version,
      status: "running",
      mode: "mock",
      model: "n.v.t. (nog geen AI-call)",
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
        const aiIssues: QCIssue[] = assessment.issues.map((issue, index) => ({
          id: `ai-${categoryKey}-${index + 1}`,
          category: categoryKey as QCIssue["category"],
          severity: issue.severity,
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
      qc = (await getQualityControlRepository().update(qc.id, {
        status: "failed",
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
    const website = await getGeneratedWebsiteRepository().getById(websiteId);
    if (!website) throw new QualityControlError("Website niet gevonden");
    if (website.status !== "ready_for_silvijn") {
      throw new QualityControlError(
        `Alleen een website met status READY_FOR_SILVIJN kan worden goedgekeurd (huidig: ${website.status})`
      );
    }

    const qc = await getQualityControlRepository().getLatestByWebsiteId(websiteId);
    if (!qc) throw new QualityControlError("Er is geen kwaliteitscontrole uitgevoerd — goedkeuring is geblokkeerd");
    if (qc.status !== "completed") {
      throw new QualityControlError(`Kwaliteitscontrole is niet voltooid (status: ${qc.status}) — goedkeuring is geblokkeerd`);
    }
    if (qc.overallResult !== "pass") {
      throw new QualityControlError(`QC-resultaat is ${qc.overallResult.toUpperCase()} — alleen PASS kan worden goedgekeurd`);
    }
    if (qc.issues.some((i) => i.severity === "critical")) {
      throw new QualityControlError("Er bestaat nog een CRITICAL issue — goedkeuring is geblokkeerd (geen override in deze fase)");
    }
    if (website.buildStatus !== "passed") {
      throw new QualityControlError(`Build-status is ${website.buildStatus} — goedkeuring is geblokkeerd`);
    }
    const securityCheck = qc.checks.find((c) => c.category === "security");
    if (securityCheck?.result === "failed") {
      throw new QualityControlError("De security-check is FAILED — goedkeuring is geblokkeerd");
    }

    const approval = {
      action: "approved" as const,
      by: getApproverName(),
      at: new Date().toISOString(),
      websiteVersion: website.version,
    };
    const updatedQc = (await getQualityControlRepository().update(qc.id, { approval })) ?? qc;
    const updatedWebsite = await getGeneratedWebsiteRepository().update(website.id, { status: "approved" });
    if (!updatedWebsite) throw new QualityControlError("Website bijwerken mislukt");

    await getAIActivityRepository().log({
      leadId: website.leadId,
      type: "website_quality_control",
      status: "completed",
      message: `WEBSITE GOEDGEKEURD door ${approval.by}: "${website.businessName}" v${website.version} (QC ${qc.id})`,
      metadata: { websiteId: website.id, projectId: website.projectId, qcId: qc.id, action: "approved", by: approval.by },
    });

    // Belangrijk: approval betekent NIET dat het project is geleverd.
    // Project.status wordt hier bewust NIET gewijzigd (delivery = latere fase).
    return { website: updatedWebsite, qc: updatedQc };
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
    const website = await getGeneratedWebsiteRepository().getById(websiteId);
    if (!website) throw new QualityControlError("Website niet gevonden");
    if (!["ready_for_silvijn", "needs_revision"].includes(website.status)) {
      throw new QualityControlError(
        `Revisie kan alleen worden aangevraagd voor een website met status ready_for_silvijn of needs_revision (huidig: ${website.status})`
      );
    }
    if (!reason || reason.trim().length < 5) {
      throw new QualityControlError("Een revisieverzoek vereist een reden (minimaal 5 tekens)");
    }
    const qc = await getQualityControlRepository().getLatestByWebsiteId(websiteId);
    if (!qc || qc.status !== "completed") {
      throw new QualityControlError("Revisieverzoek vereist een voltooide kwaliteitscontrole");
    }

    const approval = {
      action: "revision_requested" as const,
      by: getApproverName(),
      at: new Date().toISOString(),
      reason: reason.trim(),
      selectedIssueIds: options?.selectedIssueIds ?? [],
      notes: options?.notes,
      websiteVersion: website.version,
    };
    const updatedQc = (await getQualityControlRepository().update(qc.id, { approval })) ?? qc;
    const updatedWebsite = await getGeneratedWebsiteRepository().update(website.id, { status: "needs_revision" });
    if (!updatedWebsite) throw new QualityControlError("Website bijwerken mislukt");

    await getAIActivityRepository().log({
      leadId: website.leadId,
      type: "website_quality_control",
      status: "completed",
      message: `REVISIE AANGEVRAAGD door ${approval.by}: "${website.businessName}" v${website.version} — ${reason.trim()}`,
      metadata: {
        websiteId: website.id,
        projectId: website.projectId,
        qcId: qc.id,
        action: "revision_requested",
        selectedIssueIds: approval.selectedIssueIds,
      },
    });

    return { website: updatedWebsite, qc: updatedQc };
  }

  /** ARCHIVE — menselijke actie; de versie blijft bewaard en terugvindbaar. */
  async archiveWebsite(websiteId: string): Promise<GeneratedWebsite> {
    const website = await getGeneratedWebsiteRepository().getById(websiteId);
    if (!website) throw new QualityControlError("Website niet gevonden");
    if (website.status === "archived") throw new QualityControlError("Website is al gearchiveerd");

    const updated = await getGeneratedWebsiteRepository().update(website.id, { status: "archived" });
    if (!updated) throw new QualityControlError("Website bijwerken mislukt");

    const qc = await getQualityControlRepository().getLatestByWebsiteId(websiteId);
    if (qc && qc.status === "completed") {
      await getQualityControlRepository().update(qc.id, {
        approval: {
          action: "archived",
          by: getApproverName(),
          at: new Date().toISOString(),
          websiteVersion: website.version,
        },
      });
    }

    await getAIActivityRepository().log({
      leadId: website.leadId,
      type: "website_quality_control",
      status: "completed",
      message: `WEBSITE GEARCHIVEERD door ${getApproverName()}: "${website.businessName}" v${website.version}`,
      metadata: { websiteId: website.id, projectId: website.projectId, action: "archived" },
    });

    return updated;
  }
}
