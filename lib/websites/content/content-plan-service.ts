import { getAIActivityRepository } from "@/lib/repositories/ai-activity-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getProjectRepository } from "@/lib/projects/repository";
import { findQuestionnairesByLead } from "@/lib/questionnaire/service";
import { getQuestionnaireRepository, type Questionnaire } from "@/lib/questionnaire/repository";
import type { QuestionnaireResponseLike } from "@/lib/questionnaire/summary";
import { AIService } from "@/lib/ai/service";
import { getDesignPlanRepository } from "../design-plan-repository";
import type { DesignPlanRecord } from "../design-plan";
import { websiteBlueprintSchema, type WebsiteBlueprint } from "../blueprint/blueprint";
import {
  assembleContentSourceBundle,
  type ContentSourceInput,
  type QuestionnaireSourceInput,
} from "./content-source";
import { validateContentPlanConsistency, contentPlanSchema } from "./content-plan";
import type { ContentPlan } from "./content-plan";
import {
  finalizeRawContentPlan,
  ContentPlanFinalizeError,
} from "./content-plan-finalizer";
import { getContentPlanRepository } from "./content-plan-repository";
import type { ContentPlanRecord } from "./content-plan-repository";

/**
 * ContentPlanService (C3b) — vult het interne ContentPlan per blueprint-
 * sectie met commerciële copy.
 *
 * DESIGN PLAN (completed + blueprint) + LEAD + REQUIREMENTS + QUESTIONNAIRE
 * (beide rondes) → DETERMINISTISCHE SOURCEBUNDLE → ÉÉN AI-CALL →
 * DETERMINISTISCHE FINALIZER (fact-locked verbatim, evidence verplicht,
 * copywriting=false → customer_slot, coverage) → C3A-CONSISTENCY →
 * VERSIEGED CONTENTPLAN (per design-plan-versie).
 *
 * Garanties:
 * - INTERN: geen enkel pad hier levert aan een klant, publiceert, verstuurt
 *   of raakt Shopify/rendering aan (C3d consumeert pas later).
 * - De AI voegt nooit secties toe: paden en slot-kinds zijn bindend; de
 *   finalizer laat hallucinaties failen.
 * - Stale-detectie: de source-fingerprint van de bundel bepaalt of de
 *   bronnen zijn gewijzigd sinds de laatste pass — een gelijke vingerafdruk
 *   bij een completed plan weigert (niets te doen), een nieuwe genereert
 *   een nieuwe versie (oude blijven bewaard).
 * - Ontbrekende klantinformatie is expliciet (customer_slot-instructies +
 *   missingInformation), nooit gefabriceerd.
 */

export class ContentPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentPlanError";
  }
}

export class ContentPlanValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`ContentPlan is inconsistent met blueprint of bronnen: ${errors.join(" ")}`);
    this.name = "ContentPlanValidationError";
  }
}

/** Bronnen ongewijzigd sinds de laatste completed pass — niets te doen. */
export class ContentPlanUpToDateError extends ContentPlanError {
  constructor(public readonly existing: ContentPlanRecord) {
    super(
      `Content voor dit Design Plan is actueel (source-fingerprint ongewijzigd sinds v${existing.version}) — her-generatie is niet nodig.`
    );
    this.name = "ContentPlanUpToDateError";
  }
}

/**
 * C3d: het completed ContentPlan is verouderd — de bronnen (lead, notes,
 * questionnaire, requirements, Design Plan) zijn gewijzigd sinds de laatste
 * pass. Consumenten (theme-generatie) mogen een stale plan NOOIT stil
 * gebruiken; dit is een expliciete, fail-loud weigering.
 */
export class ContentPlanStaleError extends ContentPlanError {
  constructor(public readonly existing: ContentPlanRecord) {
    super(
      `ContentPlan v${existing.version} is verouderd (source-fingerprint wijkt af van de actuele bronnen) — genereer het ContentPlan opnieuw op de projectdetailpagina voordat de websitecontent wordt opgebouwd.`
    );
    this.name = "ContentPlanStaleError";
  }
}

/**
 * C3d (puur, apart testbaar): beslist of een completed record consumeerbaar
 * is. null = geen completed plan (legacy-flow van de aanroeper), een
 * actueel plan = parsen en teruggeven, stale = ContentPlanStaleError.
 */
export function resolveConsumablePlan(
  records: ContentPlanRecord[],
  currentFingerprint: string
): ContentPlan | null {
  const latestCompleted =
    records
      .filter((r) => r.status === "completed" && r.plan !== null)
      .sort((a, b) => b.version - a.version)[0] ?? null;
  if (!latestCompleted) return null;
  if (latestCompleted.sourceFingerprint !== currentFingerprint) {
    throw new ContentPlanStaleError(latestCompleted);
  }
  return contentPlanSchema.parse(latestCompleted.plan);
}

/** Deterministische stale-check (puur, apart testbaar). */
export function isContentStale(
  latestCompleted: ContentPlanRecord | undefined,
  fingerprint: string
): boolean {
  if (!latestCompleted || latestCompleted.status !== "completed") return true;
  return latestCompleted.sourceFingerprint !== fingerprint;
}

export function nextContentPlanVersion(versions: number[]): number {
  return versions.length > 0 ? Math.max(...versions) + 1 : 1;
}

/** Vaststaande architectuur-eis: een plan zonder blueprint heeft niets te vullen. */
export function requireBlueprint(record: DesignPlanRecord): WebsiteBlueprint {
  if (record.status !== "completed" || !record.plan) {
    throw new ContentPlanError(
      `Design Plan v${record.version} is niet completed — content kan alleen op een voltooid plan gegenereerd worden.`
    );
  }
  if (!record.plan.blueprint) {
    throw new ContentPlanError(
      `Design Plan v${record.version} heeft geen blueprint (v1-plan) — content vereist de vaststaande sectie-architectuur (Fase A+B).`
    );
  }
  return websiteBlueprintSchema.parse(record.plan.blueprint);
}

/** Questionnaire-bron (beide rondes) voor de bundel — mirror van DesignPlanService. */
async function buildQuestionnaireSource(
  questionnaires: Questionnaire[]
): Promise<QuestionnaireSourceInput | null> {
  const answered = questionnaires.filter((q) => q.completionStatus != null);
  if (answered.length === 0) return null;

  const questions = answered[0].questions;
  const followUpQuestions = answered[0].followUpQuestions ?? [];
  const responses: QuestionnaireResponseLike[] = [];
  for (const questionnaire of answered) {
    const rows = await getQuestionnaireRepository().listResponses(questionnaire.id);
    for (const row of rows) {
      responses.push({
        round: row.round,
        answers: row.answers as Record<string, string>,
        uploads: (row.uploads as Array<{ questionId: string }> | null) ?? null,
      });
    }
  }
  if (responses.length === 0) return null;
  return { questions, followUpQuestions, responses };
}

export class ContentPlanService {
  private aiService = new AIService();

  async get(id: string): Promise<ContentPlanRecord> {
    const record = await getContentPlanRepository().getById(id);
    if (!record) throw new ContentPlanError("ContentPlan niet gevonden");
    return record;
  }

  async listByDesignPlan(designPlanId: string): Promise<ContentPlanRecord[]> {
    return getContentPlanRepository().listByDesignPlan(designPlanId);
  }

  async listByProject(projectId: string): Promise<ContentPlanRecord[]> {
    return getContentPlanRepository().listByProject(projectId);
  }

  /**
   * C3d: het actuele, consumeerbare ContentPlan voor een Design Plan — de
   * EENige lees-entree voor consumenten (theme-generatie). Her-gebruikt
   * exact dezelfde source-bundel als generateContentPlan, dus de
   * stale-beslissing kan nooit divergeren van de generatiekant.
   *
   * - Geen completed plan → null (aanroeper valt terug op de legacy-flow,
   *   byte-identiek aan vóór C3d).
   * - Completed maar verouderd → ContentPlanStaleError (fail-loud: nooit
   *   stilletjes afwijkende content leveren van wat de owner zag).
   * - Completed én actueel → het geparsede, gevalideerde plan.
   */
  async getConsumablePlan(designPlanId: string): Promise<ContentPlan | null> {
    const records = await getContentPlanRepository().listByDesignPlan(designPlanId);

    // Zonder completed plan is er niets te consumeren (legacy-flow).
    const hasCompleted = records.some((r) => r.status === "completed" && r.plan !== null);
    if (!hasCompleted) return null;

    // Zelfde bundelbouw als generateContentPlan (stap 1-3) — geen duplicatie
    // van beslislogica, wél van data-lading: de fingerprint moet identiek
    // berekend worden, anders is de stale-check zinloos.
    const designPlan = await getDesignPlanRepository().getById(designPlanId);
    if (!designPlan) throw new ContentPlanError("Design Plan niet gevonden");
    const project = await getProjectRepository().getById(designPlan.projectId);
    if (!project) throw new ContentPlanError("Project niet gevonden");
    const lead = await getLeadRepository().get(designPlan.leadId);
    if (!lead) throw new ContentPlanError("Lead niet gevonden");

    const questionnaires = await findQuestionnairesByLead(lead.id);
    const questionnaire = await buildQuestionnaireSource(questionnaires);
    const bundle = assembleContentSourceBundle({
      lead: {
        businessName: lead.businessName,
        industry: lead.industry,
        address: lead.address,
        city: lead.city,
        province: lead.province,
        phone: lead.phone,
        email: lead.email,
        website: lead.website,
        websiteStatus: lead.websiteStatus,
        googleRating: lead.googleRating,
        reviewCount: lead.reviewCount,
      },
      qualificationNotes: lead.notes ?? [],
      questionnaire,
      requirements: project.requirements,
      designPlan: designPlan.plan!,
    } satisfies ContentSourceInput);

    return resolveConsumablePlan(records, bundle.fingerprint);
  }

  /**
   * Volledige content-pass — expliciete interne actie (owner-geïnitieerd via
   * de server action). Één gecontroleerde AI-call; alles daarna is
   * deterministisch.
   */
  async generateContentPlan(designPlanId: string): Promise<ContentPlanRecord> {
    // ---- 1. Design Plan + vaststaande architectuur
    const designPlan = await getDesignPlanRepository().getById(designPlanId);
    if (!designPlan) throw new ContentPlanError("Design Plan niet gevonden");
    const blueprint = requireBlueprint(designPlan);

    // ---- 2. Project + lead (bestaansgarantie's)
    const project = await getProjectRepository().getById(designPlan.projectId);
    if (!project) throw new ContentPlanError("Project niet gevonden");
    const lead = await getLeadRepository().get(designPlan.leadId);
    if (!lead) throw new ContentPlanError("Lead niet gevonden");

    // ---- 3. DETERMINISTISCHE SOURCEBUNDLE (één bron van waarheid)
    const questionnaires = await findQuestionnairesByLead(lead.id);
    const questionnaire = await buildQuestionnaireSource(questionnaires);
    const bundle = assembleContentSourceBundle({
      lead: {
        businessName: lead.businessName,
        industry: lead.industry,
        address: lead.address,
        city: lead.city,
        province: lead.province,
        phone: lead.phone,
        email: lead.email,
        website: lead.website,
        websiteStatus: lead.websiteStatus,
        googleRating: lead.googleRating,
        reviewCount: lead.reviewCount,
      },
      qualificationNotes: lead.notes ?? [],
      questionnaire,
      requirements: project.requirements,
      designPlan: designPlan.plan!,
    } satisfies ContentSourceInput);

    // ---- 4. STALE-CHECK + versie (versions bewaard, nooit overschreven)
    const existing = await getContentPlanRepository().listByDesignPlan(designPlanId);
    const latestCompleted = existing.find((r) => r.status === "completed");
    if (!isContentStale(latestCompleted, bundle.fingerprint)) {
      throw new ContentPlanUpToDateError(latestCompleted!);
    }
    const version = nextContentPlanVersion(existing.map((r) => r.version));
    const record = await getContentPlanRepository().create({
      projectId: designPlan.projectId,
      leadId: designPlan.leadId,
      designPlanId,
      version,
      status: "draft",
      mode: "mock",
      sourceFingerprint: bundle.fingerprint,
    });

    await getAIActivityRepository().log({
      leadId: lead.id,
      type: "content_generation",
      status: "started",
      message: `ContentPlan-generatie gestart voor "${lead.businessName}" (v${version} op Design Plan v${designPlan.version})`,
      metadata: { projectId: designPlan.projectId, designPlanId, version, copywriting: project.requirements.copywriting ?? false },
    });

    try {
      // ---- 5. ÉÉN AI-CALL (raw units binnen het bindende pad-contract)
      const raw = await this.aiService.generateContentPlan(
        {
          businessName: lead.businessName,
          copywriting: project.requirements.copywriting === true,
          bundle,
          blueprint,
        },
        lead.id
      );

      // ---- 6. DETERMINISTISCHE FINALIZER (fact-locked verbatim, evidence,
      //          copywriting=false → customer_slot, coverage)
      let plan: ContentPlan;
      let corrections: string[] = [];
      let addedMissing: string[] = [];
      try {
        const finalized = finalizeRawContentPlan({
          raw: raw.data,
          blueprint,
          bundle,
          copywriting: project.requirements.copywriting === true,
          designPlanId,
        });
        plan = finalized.plan;
        corrections = finalized.corrections;
        addedMissing = finalized.addedMissing;
      } catch (error) {
        if (error instanceof ContentPlanFinalizeError) {
          await getContentPlanRepository().update(record.id, {
            status: "failed",
            validationErrors: error.errors,
            model: raw.model,
            mode: raw.mode,
            generationNotes: `ContentPlan v${version} verworpen door de deterministische finalizer: ${error.errors.length} fout(en).`,
          });
          await getAIActivityRepository().log({
            leadId: lead.id,
            type: "content_generation",
            status: "failed",
            message: `ContentPlan voor "${lead.businessName}" (v${version}) faalde de finalizer: ${error.errors[0]}`,
            metadata: { designPlanId, version, errors: error.errors.slice(0, 5) },
          });
          throw new ContentPlanValidationError(error.errors);
        }
        throw error;
      }

      // ---- 7. C3A-CONSISTENCY (schema + slot-conformance + coverage dubbel)
      const consistency = validateContentPlanConsistency(plan, blueprint, bundle);
      if (!consistency.passed) {
        await getContentPlanRepository().update(record.id, {
          status: "failed",
          validationErrors: consistency.errors,
          model: raw.model,
          mode: raw.mode,
          generationNotes: `ContentPlan v${version} verworpen door de C3a-consistencychecks.`,
        });
        await getAIActivityRepository().log({
          leadId: lead.id,
          type: "content_generation",
          status: "failed",
          message: `ContentPlan voor "${lead.businessName}" (v${version}) faalde de consistencychecks: ${consistency.errors[0]}`,
          metadata: { designPlanId, version, errors: consistency.errors.slice(0, 5) },
        });
        throw new ContentPlanValidationError(consistency.errors);
      }

      // ---- 8. COMPLETED — intern plan, bewaard als versie
      const notesParts: string[] = [
        `ContentPlan v${version} gegenereerd op Design Plan v${designPlan.version} (intern — nooit klantzichtbaar; geen Shopify/rendering).`,
        `${plan.pages.reduce((sum, page) => sum + page.units.length, 0)} units, ${addedMissing.length} coverage-aanvullingen, ${plan.missingInformation.length} ontbrekende informatiepunten.`,
      ];
      if (corrections.length > 0) {
        notesParts.push(`Deterministische correcties (${corrections.length}): ${corrections.slice(0, 5).join(" | ")}`);
      }
      const completed = await getContentPlanRepository().update(record.id, {
        status: "completed",
        plan,
        missingInformation: plan.missingInformation,
        model: raw.model,
        mode: raw.mode,
        generationNotes: notesParts.join(" "),
      });
      await getAIActivityRepository().log({
        leadId: lead.id,
        type: "content_generation",
        status: "completed",
        message: `ContentPlan gegenereerd voor "${lead.businessName}" (v${version}, ${plan.pages.length} pagina('s), ${plan.missingInformation.length} ontbrekende punten)`,
        metadata: {
          projectId: designPlan.projectId,
          designPlanId,
          version,
          model: raw.model,
          mode: raw.mode,
          durationMs: raw.durationMs,
          cost: raw.estimatedCost,
          tokens: raw.usage,
        },
      });
      return completed!;
    } catch (error) {
      if (error instanceof ContentPlanValidationError || error instanceof ContentPlanFinalizeError) throw error;
      // Onverwachte fouten (AI-timeout e.d.): het draft-record markeert de
      // poging; de oorzaak wordt gemeld via de error-klasse van de AI-laag.
      await getContentPlanRepository().update(record.id, {
        status: "failed",
        validationErrors: [`Generatie afgebroken: ${error instanceof Error ? error.message : "onbekende fout"}`],
      });
      await getAIActivityRepository().log({
        leadId: lead.id,
        type: "content_generation",
        status: "failed",
        message: `ContentPlan-generatie voor "${lead.businessName}" (v${version}) mislukt`,
        metadata: { designPlanId, version, reason: error instanceof Error ? error.message : "onbekende fout" },
      });
      throw error;
    }
  }
}
