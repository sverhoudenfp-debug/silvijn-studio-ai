import { getAIActivityRepository } from "@/lib/repositories/ai-activity-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getProjectRepository } from "@/lib/projects/repository";
import { getQuestionnaireRepository } from "@/lib/questionnaire/repository";
import {
  buildQuestionnaireAnswerLines,
  MAX_QUESTIONNAIRE_LINES,
} from "@/lib/questionnaire/summary";
import type { Project } from "@/lib/projects/types";
import type { Lead } from "@/lib/types";
import { AIService } from "@/lib/ai/service";
import { selectTemplateForIndustry } from "./templates";
import { validateDesignPlanConsistency, type DesignPlan } from "./design-plan";
import { getDesignPlanRepository } from "./design-plan-repository";
import type { DesignPlanRecord } from "./design-plan";

/**
 * DesignPlanService (Fase I.1).
 *
 * PROJECT → (LEAD + REQUIREMENTS + QUESTIONNAIRES) → AI DESIGN PLANNING →
 * ZOD-VALIDATIE → DETERMINISTISCHE CONSISTENTIECHECKS → VERSIEGED DESIGN PLAN.
 *
 * Garanties:
 * - Het plan is INTERN: geen enkele actie van deze service levert aan een
 *   klant, publiceert iets of stuurt iets — er bestaat geen leverpad.
 * - De AI levert alléén Zod-gevalideerde JSON; de consistentiechecks
 *   (scope/prijsintegriteit, navigatieverwijzingen, fabricatie-scan) zijn
 *   deterministisch en kunnen de AI-output laten falen.
 * - Versies worden bewaard: elke generatie is een nieuw record met een
 *   oplopend versienummer; niets wordt overschreven of verwijderd.
 * - Ontbrekende informatie is expliciet (missingInformation), nooit een
 *   gefabriceerd feit.
 */

export class DesignPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignPlanError";
  }
}

export class DesignPlanValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Design Plan is inconsistent met de projectrequirements: ${errors.join(" ")}`);
    this.name = "DesignPlanValidationError";
  }
}

const BLOCKED_PROJECT_STATUSES = new Set(["cancelled", "completed"]);

/** Deterministische versienummering: hoogste bestaande versie + 1. */
export function nextDesignPlanVersion(versions: number[]): number {
  return versions.length > 0 ? Math.max(...versions) + 1 : 1;
}

function summarizeRequirements(project: Project): string {
  const requirements = project.requirements;
  const parts: string[] = [];
  if (requirements.websiteType) parts.push(`type: ${requirements.websiteType}`);
  if (requirements.numberOfPages != null) parts.push(`pagina's: ${requirements.numberOfPages}`);
  if (requirements.designLevel) parts.push(`design: ${requirements.designLevel}`);
  if (requirements.ecommerce === true) parts.push("e-commerce: ja");
  if (requirements.ecommerce === false) parts.push("e-commerce: nee");
  if (requirements.customFunctionality) parts.push(`custom: ${requirements.customFunctionality}`);
  if (requirements.integrations?.length) parts.push(`integraties: ${requirements.integrations.join(", ")}`);
  if (requirements.seo === true) parts.push("seo: ja");
  if (requirements.copywriting === true) parts.push("teksten: agency verzorgt");
  if (requirements.copywriting === false) parts.push("teksten: klant verzorgt");
  if (requirements.deadline) parts.push(`deadline: ${requirements.deadline}`);
  return parts.join("; ") || "geen specifieke requirements bekend";
}

/** Echte questionnaire-informatie: voltooiingsstatus + antwoorden (nooit lead-/dashboarddata). */
async function buildQuestionnaireSummary(leadId: string): Promise<{
  lines: string[];
  hasCompletedQuestionnaire: boolean;
}> {
  const questionnaires = await getQuestionnaireRepository().findByLeadId(leadId);
  const lines: string[] = [];
  let hasCompletedQuestionnaire = false;

  for (const questionnaire of questionnaires) {
    if (questionnaire.completionStatus === "QUESTIONNAIRE_COMPLETE") {
      hasCompletedQuestionnaire = true;
    }
    if (questionnaire.completionStatus == null) continue; // geen antwoorden ontvangen
    const responses = await getQuestionnaireRepository().listResponses(questionnaire.id);
    if (responses.length === 0) continue;
    // C1/C2-doorvoer (2026-09-20): antwoorden uit álle rondes (incl. de
    // follow-upronde) plus upload-aantallen — eerlijke bevestigingen
    // ("geen reviews beschikbaar") stromen zo mee naar het Design Plan,
    // waar de A3-conversieketen ze als trust-disclosure kan gebruiken.
    const answerLines = buildQuestionnaireAnswerLines(
      questionnaire.questions,
      questionnaire.followUpQuestions ?? [],
      responses
    );
    for (const line of answerLines) lines.push(`${line.label}: ${line.value}`);
  }

  return { lines: lines.slice(0, MAX_QUESTIONNAIRE_LINES), hasCompletedQuestionnaire };
}

export class DesignPlanService {
  private aiService = new AIService();

  async get(id: string): Promise<DesignPlanRecord> {
    const record = await getDesignPlanRepository().getById(id);
    if (!record) throw new DesignPlanError("Design Plan niet gevonden");
    return record;
  }

  async listByProject(projectId: string): Promise<DesignPlanRecord[]> {
    return getDesignPlanRepository().listByProject(projectId);
  }

  /**
   * Volledige designplanning — expliciete interne actie (owner-geïnitieerd
   * via de server action). Eén gecontroleerde AI-call; de rest is
   * deterministisch.
   */
  async generateDesignPlan(projectId: string): Promise<DesignPlanRecord> {
    // ---- 1. Project + guards (guard-failures consumeren geen AI-budget)
    const project = await getProjectRepository().getById(projectId);
    if (!project) throw new DesignPlanError("Project niet gevonden");
    if (BLOCKED_PROJECT_STATUSES.has(project.status)) {
      throw new DesignPlanError(
        `Designplanning is niet toegestaan voor een ${project.status === "cancelled" ? "geannuleerd" : "afgerond"} project`
      );
    }

    // ---- 2. Lead ophalen (bestaansgarantie)
    const lead: Lead | null = await getLeadRepository().get(project.leadId);
    if (!lead) throw new DesignPlanError("Lead niet gevonden");

    // ---- 3. Versie + record (status: generating)
    const previousVersions = await getDesignPlanRepository().listByProject(projectId);
    const version = nextDesignPlanVersion(previousVersions.map((v) => v.version));
    const record = await getDesignPlanRepository().create({
      projectId,
      leadId: lead.id,
      version,
      status: "generating",
      mode: "mock",
    });

    await getAIActivityRepository().log({
      leadId: lead.id,
      type: "design_plan_generation",
      status: "started",
      message: `Design Plan-generatie gestart voor "${lead.businessName}" (v${version})`,
      metadata: { projectId, version },
    });

    try {
      // ---- 4. Echte context samenstellen (questionnaires, requirements, lead)
      const { lines: questionnaireLines, hasCompletedQuestionnaire } = await buildQuestionnaireSummary(lead.id);
      const suggestedTemplate = selectTemplateForIndustry(lead.industry);

      // ---- 5. AI DESIGN PLANNING (enige AI-call)
      const planning = await this.aiService.generateDesignPlan(
        {
          businessName: lead.businessName,
          industry: lead.industry,
          city: lead.city,
          province: lead.province,
          leadNotes: lead.notes,
          requirementsSummary: summarizeRequirements(project),
          numberOfPages: project.requirements.numberOfPages ?? null,
          ecommerce: project.requirements.ecommerce ?? null,
          specialRequirements: project.requirements.specialRequirements ?? null,
          existingWebsite: lead.websiteStatus === "has_website" || lead.websiteStatus === "website_poor",
          googleRating: lead.googleRating,
          reviewCount: lead.reviewCount,
          questionnaireSummary: questionnaireLines,
          hasCompletedQuestionnaire,
          suggestedTemplate,
        },
        lead.id
      );
      const plan: DesignPlan = planning.data;

      // ---- 6. DETERMINISTISCHE CONSISTENTIECHECKS
      //      (scope/prijsintegriteit, navigatieverwijzingen, fabricatie-scan)
      const consistency = validateDesignPlanConsistency(plan, project.requirements);
      if (!consistency.passed) {
        await getDesignPlanRepository().update(record.id, {
          status: "failed",
          validationErrors: consistency.errors,
          model: planning.model,
          mode: planning.mode,
          generationNotes: `Design Plan v${version} verworpen door de deterministische consistentiechecks.`,
        });
        await getAIActivityRepository().log({
          leadId: lead.id,
          type: "design_plan_generation",
          status: "failed",
          message: `Design Plan voor "${lead.businessName}" (v${version}) faalde de consistentiechecks: ${consistency.errors[0]}`,
          metadata: { projectId, version, errors: consistency.errors.slice(0, 5) },
        });
        throw new DesignPlanValidationError(consistency.errors);
      }

      // ---- 7. COMPLETED — intern plan, bewaard als versie
      const completed = await getDesignPlanRepository().update(record.id, {
        status: "completed",
        plan,
        missingInformation: plan.missingInformation,
        model: planning.model,
        mode: planning.mode,
        generationNotes: `Design Plan v${version} gegenereerd (intern — nooit klantzichtbaar). ${plan.missingInformation.length} ontbrekende informatiepunten expliciet doorgegeven.`,
      });
      await getAIActivityRepository().log({
        leadId: lead.id,
        type: "design_plan_generation",
        status: "completed",
        message: `Design Plan gegenereerd voor "${lead.businessName}" (v${version}, ${plan.pageStructure.length} pagina('s), ${plan.missingInformation.length} ontbrekende punten)`,
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
      return completed ?? this.get(record.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Onbekende fout";
      // Record alleen nog markeren als failed als dat nog niet is gebeurd
      const current = await getDesignPlanRepository().getById(record.id);
      if (current?.status === "generating") {
        await getDesignPlanRepository().update(record.id, {
          status: "failed",
          validationErrors: [reason],
          generationNotes: `Design Plan-generatie mislukt (v${version}).`,
        });
      }
      await getAIActivityRepository().log({
        leadId: lead.id,
        type: "design_plan_generation",
        status: "failed",
        message: `Design Plan-generatie voor "${lead.businessName}" mislukt (v${version}): ${reason}`,
        metadata: { projectId, version },
      });
      throw error;
    }
  }
}
