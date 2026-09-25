import { isOutreachSuppressed } from "@/lib/leads/lifecycle";
import { getDemoRepository } from "@/lib/repositories/demo-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { scoreLead } from "@/lib/agents/lead-scoring";
import { MAX_AI_REQUESTS_PER_RUN_CAP } from "@/lib/ai/config";
import { AIService } from "@/lib/ai/service";
import { getOutreachRepository } from "./repository";
import { checkOutreachQuality } from "./quality-check";
import type { OutreachDraft, OutreachDraftStatus, OutreachGenerationResult } from "./types";

/**
 * OutreachService (Fase 6) — de AI Outreach Engine.
 *
 * Flow: LEAD → OUTREACH ANALYSIS (AI, structured) → QUALITY CHECK
 * → DRAFT (of READY_FOR_REVIEW bij geslaagde check).
 *
 * Er wordt NOOIT een e-mail verzonden; sendEmail() bestaat niet in deze
 * fase (de email-provider-abstraction van Fase 2 blijft onbenut).
 *
 * Kostenveiligheid: elke generatie is één expliciete, gecontroleerde AI-call
 * via de centrale AIService (safety-limiet, run-logging, cost tracking).
 * MAX_OUTREACH_GENERATIONS_PER_RUN (default 5) begrenst deze service per
 * instantie; bulkgeneratie bestaat niet.
 */

export function getMaxOutreachGenerationsPerRun(): number {
  const parsed = Number.parseInt(process.env.MAX_OUTREACH_GENERATIONS_PER_RUN ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 25) : 5;
}

export class OutreachGenerationLimitError extends Error {
  constructor(limit: number) {
    super(`Outreach-generatielimiet bereikt (${limit} per run)`);
    this.name = "OutreachGenerationLimitError";
  }
}

export class OutreachNotFoundError extends Error {
  constructor(message = "Lead of concept niet gevonden") {
    super(message);
    this.name = "OutreachNotFoundError";
  }
}

export class OutreachService {
  private generationsThisRun = 0;
  private readonly maxGenerationsPerRun: number;

  /**
   * Expliciete owner-commando's (Fase E) mogen het generatielimiet verhogen
   * tot hun eigen commando-limiet; de menselijke flow houdt de default (5).
   */
  private readonly aiService: AIService;

  /**
   * Expliciete owner-commando's (Fase E) verhogen úitsluitend voor die
   * commando-instantie het AI-safety-limiet naar hun eigen begrensde
   * commandolimiet; alle andere flows behouden de default (5 per run).
   * MAX_AI_REQUESTS_PER_RUN_CAP blijft de absolute hard cap.
   */
  constructor(options?: { maxGenerationsPerRun?: number }) {
    this.maxGenerationsPerRun = options?.maxGenerationsPerRun ?? getMaxOutreachGenerationsPerRun();
    this.aiService = new AIService(
      options?.maxGenerationsPerRun
        ? { maxRequestsPerRun: Math.min(options.maxGenerationsPerRun, MAX_AI_REQUESTS_PER_RUN_CAP) }
        : undefined
    );
  }

  /**
   * Genereert één outreach-concept voor een lead. Expliciete, gecontroleerde
   * actie — de enige entree is de "Generate Outreach Draft"-server action.
   */
  async generateDraftForLead(
    leadId: string,
    options?: { purpose?: "initial" | "followup" | "demo_offer" }
  ): Promise<OutreachGenerationResult> {
    this.generationsThisRun += 1;
    const max = this.maxGenerationsPerRun;
    if (this.generationsThisRun > max) {
      throw new OutreachGenerationLimitError(max);
    }

    // 1) Leaddata — uitsluitend échte beschikbare informatie
    const leadRepository = getLeadRepository();
    const lead = await leadRepository.get(leadId);
    if (!lead) throw new OutreachNotFoundError("Lead niet gevonden");
    if (isOutreachSuppressed(lead.leadStatus,lead.outreachStatus)) throw new Error("OUTREACH_SUPPRESSED");

    // 2) Demo-data indien beschikbaar (alleen een bestaande READY demo mag genoemd worden).
    //    De EERSTE outreachmail bevat nooit een demo/link (besluit 2026-09-25): demo's
    //    maakt Silvijn handmatig en voegt hij later zelf aan de conversatie toe. Er wordt
    //    hier nooit een demo gegenereerd; alleen gelezen, en voor "initial" zelfs dat niet.
    const purpose = options?.purpose ?? "initial";
    const demoRepository = getDemoRepository();
    const demo = purpose === "initial" ? null : await demoRepository.findByLeadId(leadId);
    const readyDemo =
      demo && demo.status === "ready" && demo.previewUrl
        ? {
            url: demo.previewUrl,
            headline: demo.headline,
            description: demo.description,
            template: demo.template,
          }
        : null;

    // 3) Score factoren via de bestaande rule-based agent (geen AI)
    const { factors } = scoreLead(lead);

    // 4) AI-generatie via de centrale AIService (logging + cost tracking daar)
    const result = await this.aiService.generateOutreachMessage(
      {
        messageKind: options?.purpose ?? "initial",
        businessName: lead.businessName,
        industry: lead.industry,
        city: lead.city,
        province: lead.province,
        websiteStatus: lead.websiteStatus,
        website: lead.website,
        phone: lead.phone,
        email: lead.email,
        leadScore: lead.leadScore,
        scoreFactors: factors.map((f) => `${f.label}: ${f.earned}/${f.max}`),
        leadSource: lead.source,
        discoveryNotes: lead.notes,
        demo: readyDemo,
      },
      leadId
    );

    // 5) Deterministische quality check (geen AI, geen repair-loops)
    const quality = checkOutreachQuality(
      {
        subject: result.data.subject,
        body: result.data.body,
        callToAction: result.data.callToAction,
      },
      { allowMockMarkers: result.mode === "mock", firstOutreach: purpose === "initial" }
    );

    // 6) Draft opslaan — bij geslaagde check READY_FOR_REVIEW, anders DRAFT
    const repository = getOutreachRepository();
    const draft = await repository.create({
      leadId,
      channel: "email",
      purpose: options?.purpose ?? "initial",
      status: quality.passed ? "ready_for_review" : "draft",
      subject: result.data.subject,
      body: result.data.body,
      personalizationReason: result.data.personalizationReason,
      callToAction: result.data.callToAction,
      model: result.model,
      aiRunId: null,
      qualityIssues: quality.issues,
    });

    return {
      draft,
      model: result.model,
      mode: result.mode,
      estimatedCost: result.estimatedCost,
      durationMs: result.durationMs,
      qualityPassed: quality.passed,
    };
  }

  /**
   * Statusupdate door een mens (approve/cancel). "sent" kan in Fase 6 NIET
   * worden gezet — verzenden bestaat nog niet.
   */
  async updateDraftStatus(draftId: string, status: OutreachDraftStatus): Promise<OutreachDraft> {
    if (status === "sent") {
      throw new Error("Verzenden is niet mogelijk in Fase 6 — e-mails worden nog niet verstuurd");
    }
    const repository = getOutreachRepository();
    const draft = await repository.getById(draftId);
    if (!draft) throw new OutreachNotFoundError("Concept niet gevonden");
    if (draft.status === "sent") {
      throw new Error("Dit concept is al verzonden");
    }
    const updated = await repository.update(draftId, { status });
    if (!updated) throw new OutreachNotFoundError("Concept niet gevonden");
    return updated;
  }

  async listByLead(leadId: string): Promise<OutreachDraft[]> {
    return getOutreachRepository().listByLead(leadId);
  }

  async listAll(): Promise<OutreachDraft[]> {
    return getOutreachRepository().list();
  }
}
