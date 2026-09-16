import type { z } from "zod";
import { getAIConfig, getModelForTier } from "./config";
import { AI_AGENTS } from "./agents";
import {
  AISafetyLimitError,
  userFacingAIMessage,
} from "./errors";
import { estimateCost } from "./pricing";
import { getAIProvider } from "./provider";
import { withRetry } from "./retry";
import {
  BusinessAnalysisSchema,
  OutreachMessageSchema,
  RequirementsAnalysisSchema,
  SalesAnalysisSchema,
  WebsiteSpecificationSchema,
  QCAnalysisSchema,
  extractJSON,
} from "./schemas";
import {
  getAIActivityRepository,
  type AIActivityRepository,
} from "@/lib/repositories/ai-activity-repository";
import {
  getAIRunRepository,
  type AIRunRepository,
} from "@/lib/repositories/ai-run-repository";
import { getAgencyConfiguration, getOutreachRules } from "@/lib/config/agency-config";
import type {
  AIServiceResult,
  AIUsage,
  AITaskType,
  AgentType,
  AIModelTier,
  BusinessAnalysis,
  BusinessAnalysisInput,
  OutreachMessage,
  OutreachMessageInput,
  SalesAnalysis,
  SalesAnalysisInput,
  RequirementsAnalysis,
  RequirementsAnalysisInput,
  WebsiteSpecificationInput,
  WebsiteQualityAnalysisInput,
} from "./types";
import type { ProjectRequirements } from "@/lib/projects/types";
import type { WebsiteSpecification } from "@/lib/websites/types";
import type { QCAnalysis } from "@/lib/qc/ai-types";
import {
  AIInvalidResponseError,
} from "./errors";

/**
 * AIService — dé centrale entree naar AI in de applicatie. Components, pages en
 * toekomstige agents werken alleen met deze service; de provider (Anthropic of
 * mock) blijft volledig geïsoleerd.
 *
 * Kostenveiligheid (Fase 4):
 * - geen enkele automatische AI-aanroep: alles verloopt via expliciete calls
 * - AI_MAX_REQUESTS_PER_RUN begrenst het aantal calls per service-instantie
 * - mock mode (default) kost niets en voert geen enkele API-aanroep uit
 */

export interface AIServiceCall {
  agent: AgentType;
  tier?: AIModelTier;
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  leadId?: string | null;
}

export class AIService {
  private readonly provider = getAIProvider();
  private readonly runRepository: AIRunRepository = getAIRunRepository();
  private readonly activityRepository: AIActivityRepository = getAIActivityRepository();
  private requestsThisRun = 0;
  private readonly config = getAIConfig();

  /** Expliciete, gecontroleerde AI-aanroep. Telt tegen de safety-limiet. */
  async generateText(call: AIServiceCall): Promise<AIServiceResult<string>> {
    const agent = AI_AGENTS[call.agent];
    const task: AITaskType = "generate_text";
    const model = getModelForTier(call.tier ?? agent.defaultTier);
    const started = Date.now();

    try {
      this.guardSafetyLimit();
      const result = await withRetry(
        () =>
          this.provider.generateText({
            task,
            model,
            system: call.system,
            prompt: call.prompt,
            maxTokens: call.maxTokens ?? 1024,
            temperature: call.temperature ?? 0.7,
          }),
        { maxRetries: this.config.maxRetries }
      );

      const usage: AIUsage = result.usage;
      const output = {
        data: result.text,
        model: result.model,
        mode: result.mode,
        usage,
        estimatedCost: result.mode === "live" ? estimateCost(result.model, usage.inputTokens, usage.outputTokens) : 0,
        durationMs: Date.now() - started,
      };

      await this.logRun(call, task, output);
      return output;
    } catch (error) {
      await this.logFailedRun(call, task, model, started, error);
      throw error;
    }
  }

  /** Gestructureerde output: AI-antwoord wordt geëxtraheerd en via Zod gevalideerd. */
  async generateStructured<T>(call: AIServiceCall, schema: z.ZodType<T>): Promise<AIServiceResult<T>> {
    const agent = AI_AGENTS[call.agent];
    const task: AITaskType =
      call.agent === "business_analysis"
        ? "business_analysis"
        : call.agent === "outreach"
          ? "outreach_generation"
          : call.agent === "sales"
            ? "sales_analysis"
            : call.agent === "pricing"
            ? "requirements_analysis"
            : call.agent === "website_generation"
              ? "website_planning"
              : call.agent === "website_quality_control"
                ? "website_quality_analysis"
                : "generate_structured";
    const model = getModelForTier(call.tier ?? agent.defaultTier);
    const started = Date.now();

    try {
      this.guardSafetyLimit();
      const result = await withRetry(
        async () => {
          const providerResult = await this.provider.generateText({
            task,
            model,
            system: call.system,
            prompt: call.prompt,
            maxTokens: call.maxTokens ?? 1500,
            temperature: call.temperature ?? 0.4,
          });
          let parsed: unknown;
          try {
            parsed = extractJSON(providerResult.text);
          } catch {
            throw new AIInvalidResponseError("AI-antwoord bevat geen geldige JSON");
          }
          const validated = schema.safeParse(parsed);
          if (!validated.success) {
            throw new AIInvalidResponseError(
              `AI-output voldoet niet aan het schema: ${validated.error.issues[0]?.message ?? "onbekend"}`
            );
          }
          return { providerResult, data: validated.data };
        },
        { maxRetries: this.config.maxRetries }
      );

      const usage: AIUsage = result.providerResult.usage;
      const output = {
        data: result.data,
        model: result.providerResult.model,
        mode: result.providerResult.mode,
        usage,
        estimatedCost:
          result.providerResult.mode === "live"
            ? estimateCost(result.providerResult.model, usage.inputTokens, usage.outputTokens)
            : 0,
        durationMs: Date.now() - started,
      };

      await this.logRun(call, task, output);
      return output;
    } catch (error) {
      await this.logFailedRun(call, task, model, started, error);
      throw error;
    }
  }

  /**
   * Business Analysis — de eerste echte AI-agent-service van de agency.
   * Analyseert een (fictief) bedrijf en geeft gevalideerde output die direct
   * op het Lead-type aansluit (aiAnalysis). Wordt uitsluitend expliciteit
   * aangeroepen, nooit in bulk of automatisch.
   */
  async analyzeBusiness(input: BusinessAnalysisInput, leadId?: string | null): Promise<AIServiceResult<BusinessAnalysis>> {
    await this.activityRepository.log({
      leadId: leadId ?? null,
      type: "business_analysis",
      status: "started",
      message: `Business analysis gestart voor ${input.businessName}`,
    });

    try {
      const result = await this.generateStructured<BusinessAnalysis>(
        {
          agent: "business_analysis",
          tier: AI_AGENTS.business_analysis.defaultTier,
          leadId: leadId ?? null,
          system: BUSINESS_ANALYSIS_SYSTEM,
          prompt: buildBusinessAnalysisPrompt(input),
          maxTokens: 1200,
          temperature: 0.4,
        },
        BusinessAnalysisSchema
      );

      await this.activityRepository.log({
        leadId: leadId ?? null,
        type: "business_analysis",
        status: "completed",
        message: `Business analysis voltooid voor ${input.businessName}`,
        metadata: { model: result.model, mode: result.mode, cost: result.estimatedCost },
      });

      return result;
    } catch (error) {
      await this.activityRepository.log({
        leadId: leadId ?? null,
        type: "business_analysis",
        status: "failed",
        message: `Business analysis mislukt voor ${input.businessName}`,
        metadata: { reason: userFacingAIMessage(error) },
      });
      throw error;
    }
  }

  /**
   * Outreach Agent — genereert een gepersonaliseerd outreach-concept op basis
   * van uitsluitend échte leaddata (Fase 6). Het resultaat is een CONCEPT:
   * verzenden gebeurt nooit automatisch en niet in deze fase.
   * Tier: standaard balanced; powerful alléén via expliciete env-override
   * (OUTREACH_AI_TIER).
   */
  async generateOutreachMessage(
    input: OutreachMessageInput,
    leadId?: string | null
  ): Promise<AIServiceResult<OutreachMessage>> {
    await this.activityRepository.log({
      leadId: leadId ?? null,
      type: "outreach_generation",
      status: "started",
      message: `Outreach-concept gestart voor ${input.businessName}`,
    });

    try {
      const result = await this.generateStructured<OutreachMessage>(
        {
          agent: "outreach",
          tier: getOutreachTier(),
          leadId: leadId ?? null,
          system: OUTREACH_SYSTEM,
          prompt: buildOutreachPrompt(input),
          maxTokens: 1500,
          temperature: 0.5,
        },
        OutreachMessageSchema
      );

      await this.activityRepository.log({
        leadId: leadId ?? null,
        type: "outreach_generation",
        status: "completed",
        message: `Outreach-concept gegenereerd voor ${input.businessName}`,
        metadata: {
          model: result.model,
          mode: result.mode,
          durationMs: result.durationMs,
          cost: result.estimatedCost,
          tokens: result.usage,
        },
      });

      return result;
    } catch (error) {
      await this.activityRepository.log({
        leadId: leadId ?? null,
        type: "outreach_generation",
        status: "failed",
        message: `Outreach-concept mislukt voor ${input.businessName}`,
        metadata: { reason: userFacingAIMessage(error) },
      });
      throw error;
    }
  }

  /**
   * Sales Agent (Fase 7) — analyseert een inkomende klantreactie: intent,
   * bezwaar, kwalificatie, antwoord-DRAFT, vervolgvragen en escalatie.
   * Alles is concept: er wordt nooit automatisch verzonden of toegezegd.
   * Tier: standaard balanced; override via SALES_AI_TIER (expliciet).
   */
  async generateSalesResponse(
    input: SalesAnalysisInput,
    leadId?: string | null
  ): Promise<AIServiceResult<SalesAnalysis>> {
    await this.activityRepository.log({
      leadId: leadId ?? null,
      type: "sales_analysis",
      status: "started",
      message: `Sales-analyse gestart voor ${input.businessName}`,
    });

    try {
      const result = await this.generateStructured<SalesAnalysis>(
        {
          agent: "sales",
          tier: getSalesTier(),
          leadId: leadId ?? null,
          system: SALES_SYSTEM,
          prompt: buildSalesPrompt(input),
          maxTokens: 2000,
          temperature: 0.4,
        },
        SalesAnalysisSchema
      );

      await this.activityRepository.log({
        leadId: leadId ?? null,
        type: "sales_analysis",
        status: "completed",
        message: `Sales-analyse voltooid voor ${input.businessName} (intent: ${result.data.intent})`,
        metadata: {
          model: result.model,
          mode: result.mode,
          durationMs: result.durationMs,
          cost: result.estimatedCost,
          tokens: result.usage,
          escalationRequired: result.data.escalationRequired,
        },
      });

      return result;
    } catch (error) {
      await this.activityRepository.log({
        leadId: leadId ?? null,
        type: "sales_analysis",
        status: "failed",
        message: `Sales-analyse mislukt voor ${input.businessName}`,
        metadata: { reason: userFacingAIMessage(error) },
      });
      throw error;
    }
  }

  /**
   * Pricing Agent (Fase 8) — interpreteert beschikbare context tot een
   * requirements-voorstel + ontbrekende informatie + complexiteit.
   * De AI berekent NOOIT een prijs: de deterministische PricingEngine
   * doet de berekening (configuratiedriftig, geen AI-call nodig).
   * Tier: standaard balanced; override via PRICING_AI_TIER (expliciet).
   */
  async generateRequirementsAnalysis(
    input: RequirementsAnalysisInput,
    leadId?: string | null
  ): Promise<AIServiceResult<RequirementsAnalysis>> {
    await this.activityRepository.log({
      leadId: leadId ?? null,
      type: "requirements_analysis",
      status: "started",
      message: `Requirements-analyse gestart voor ${input.businessName}`,
    });

    try {
      const result = await this.generateStructured<RequirementsAnalysis>(
        {
          agent: "pricing",
          tier: getPricingTier(),
          leadId: leadId ?? null,
          system: REQUIREMENTS_SYSTEM,
          prompt: buildRequirementsPrompt(input),
          maxTokens: 1500,
          temperature: 0.3,
        },
        RequirementsAnalysisSchema
      );

      await this.activityRepository.log({
        leadId: leadId ?? null,
        type: "requirements_analysis",
        status: "completed",
        message: `Requirements-analyse voltooid voor ${input.businessName} (complexiteit: ${result.data.complexity ?? "onbekend"})`,
        metadata: {
          model: result.model,
          mode: result.mode,
          durationMs: result.durationMs,
          cost: result.estimatedCost,
          tokens: result.usage,
        },
      });

      return result;
    } catch (error) {
      await this.activityRepository.log({
        leadId: leadId ?? null,
        type: "requirements_analysis",
        status: "failed",
        message: `Requirements-analyse mislukt voor ${input.businessName}`,
        metadata: { reason: userFacingAIMessage(error) },
      });
      throw error;
    }
  }

  /**
   * Website Generation Agent (Fase 9) — plant de website als een
   * gestructureerde WebsiteSpecification. De AI levert alléén de
   * specificatie (Zod-gevalideerd); de deterministische generator bouwt
   * daarna de site via gecontroleerde componenten. De AI schrijft NOOIT
   * productiecode en er wordt nooit AI-code uitgevoerd.
   *
   * Tier: standaard balanced; POWERFUL alléén bij aantoonbaar complexe
   * requirements (e-commerce, custom functionaliteit, integraties) of
   * expliciete override via WEBSITE_GENERATION_AI_TIER.
   */
  async generateWebsiteSpecification(
    input: WebsiteSpecificationInput,
    requirements: ProjectRequirements,
    leadId?: string | null
  ): Promise<AIServiceResult<WebsiteSpecification>> {
    await this.activityRepository.log({
      leadId: leadId ?? null,
      type: "website_planning",
      status: "started",
      message: `Websiteplanning gestart voor ${input.businessName}`,
    });

    try {
      const result = await this.generateStructured<WebsiteSpecification>(
        {
          agent: "website_generation",
          tier: getWebsiteGenerationTier(requirements),
          leadId: leadId ?? null,
          system: WEBSITE_PLANNING_SYSTEM,
          prompt: buildWebsitePlanningPrompt(input),
          maxTokens: 4000,
          temperature: 0.4,
        },
        WebsiteSpecificationSchema
      );

      await this.activityRepository.log({
        leadId: leadId ?? null,
        type: "website_planning",
        status: "completed",
        message: `Websiteplanning voltooid voor ${input.businessName} (template: ${result.data.template}, ${result.data.missingInformation.length} ontbrekende punten)`,
        metadata: {
          model: result.model,
          mode: result.mode,
          durationMs: result.durationMs,
          cost: result.estimatedCost,
          tokens: result.usage,
        },
      });

      return result;
    } catch (error) {
      await this.activityRepository.log({
        leadId: leadId ?? null,
        type: "website_planning",
        status: "failed",
        message: `Websiteplanning mislukt voor ${input.businessName}`,
        metadata: { reason: userFacingAIMessage(error) },
      });
      throw error;
    }
  }

  /**
   * Website Quality Control Agent (Fase 10) — ADVISERENDE AI-analyse van
   * content, UX, design, conversion en business-consistentie, bovenop de
   * deterministische checks. De AI mag issues classificeren en
   * aanbevelingen doen, maar NOOIT: goedkeuren, leveren, publiceren,
   * prijzen noemen of de harde FAIL-regels (security/technical/fabricatie)
   * overrulen. Die regels worden deterministisch toegepast.
   */
  async generateWebsiteQualityAnalysis(
    input: WebsiteQualityAnalysisInput,
    leadId?: string | null
  ): Promise<AIServiceResult<QCAnalysis>> {
    await this.activityRepository.log({
      leadId: leadId ?? null,
      type: "website_quality_analysis",
      status: "started",
      message: `AI-kwaliteitsanalyse gestart voor ${input.businessName}`,
    });

    try {
      const result = await this.generateStructured<QCAnalysis>(
        {
          agent: "website_quality_control",
          tier: getWebsiteQCTier(),
          leadId: leadId ?? null,
          system: WEBSITE_QC_SYSTEM,
          prompt: buildWebsiteQCPrompt(input),
          maxTokens: 2500,
          temperature: 0.3,
        },
        QCAnalysisSchema
      );

      await this.activityRepository.log({
        leadId: leadId ?? null,
        type: "website_quality_analysis",
        status: "completed",
        message: `AI-kwaliteitsanalyse voltooid voor ${input.businessName} (${result.data.recommendations.length} aanbevelingen)`,
        metadata: {
          model: result.model,
          mode: result.mode,
          durationMs: result.durationMs,
          cost: result.estimatedCost,
          tokens: result.usage,
        },
      });

      return result;
    } catch (error) {
      await this.activityRepository.log({
        leadId: leadId ?? null,
        type: "website_quality_analysis",
        status: "failed",
        message: `AI-kwaliteitsanalyse mislukt voor ${input.businessName}`,
        metadata: { reason: userFacingAIMessage(error) },
      });
      throw error;
    }
  }

  private guardSafetyLimit(): void {
    this.requestsThisRun += 1;
    if (this.requestsThisRun > this.config.maxRequestsPerRun) {
      throw new AISafetyLimitError(
        `AI-safety-limiet bereikt (${this.config.maxRequestsPerRun} verzoeken per run)`
      );
    }
  }

  private async logRun(
    call: AIServiceCall,
    task: AITaskType,
    output: { model: string; mode: "mock" | "live"; usage: AIUsage; estimatedCost: number; durationMs: number }
  ): Promise<void> {
    await this.runRepository.log({
      agentType: call.agent,
      taskType: task,
      model: output.model,
      mode: output.mode,
      status: "completed",
      leadId: call.leadId ?? null,
      inputTokens: output.usage.inputTokens,
      outputTokens: output.usage.outputTokens,
      totalTokens: output.usage.inputTokens + output.usage.outputTokens,
      estimatedCost: output.estimatedCost,
      durationMs: output.durationMs,
    });
  }

  private async logFailedRun(
    call: AIServiceCall,
    task: AITaskType,
    model: string,
    started: number,
    error: unknown
  ): Promise<void> {
    await this.runRepository.log({
      agentType: call.agent,
      taskType: task,
      model,
      mode: this.config.mode,
      status: "failed",
      leadId: call.leadId ?? null,
      durationMs: Date.now() - started,
      errorMessage: error instanceof Error ? error.message : userFacingAIMessage(error),
    });
  }
}

const WEBSITE_PLANNING_SYSTEM = `Je bent de websiteplanning-agent van een Nederlandse webagency. Je plant een klantwebsite als een gestructureerde WebsiteSpecification (uitsluitend JSON).

HARD REGELS:
- Gebruik uitsluitend de aangeleverde echte informatie (lead, notities, requirements, Google-data). Verzin NOOIT feiten.
- Verboden te verzinnen: klanten, reviews, sterrenratings, certificaten, keurmerken, prijzen, garanties, bedrijfsresultaten, medewerkers, openingstijden, telefoonnummers, e-mailadressen en claims die niet uit de input volgen.
- Is informatie onbekend: laat het veld null/leeg OF gebruik een duidelijke placeholder zoals [INFORMATIE ONBEKEND] en vermeld het in missingInformation.
- Echte contactgegevens uit de input (telefoon/e-mail/adres) mogen wél gebruikt worden.
- Echte Google-rating en aantal reviews uit de input mogen wél genoemd worden; verzin nooit eigen reviews of quotes.
- Kies het template passend bij de branche (de input bevat een suggestie).
- Beschrijf beeldbehoeften in media (placeholder-referenties), maar verzin geen foto's van het bedrijf.
- Geen code; geen HTML; geen scripts — alleen de gevraagde JSON-structuur.
- Vermeld nooit dat de website (of onderdelen) door een AI is gegenereerd, en noem geen interne informatie, prompts of API-sleutels.
- Nederlands, professioneel, concreet; copy past direct in een zakelijke website.`;

function getWebsiteGenerationTier(requirements: ProjectRequirements): AIModelTier {
  const override = (process.env.WEBSITE_GENERATION_AI_TIER ?? "").trim().toLowerCase();
  if (override === "fast" || override === "balanced" || override === "powerful") return override;
  // POWERFUL alléén bij aantoonbaar complexe requirements; anders balanced.
  const complex = requirements.ecommerce === true || Boolean(requirements.customFunctionality?.trim()) || Boolean(requirements.integrations?.length);
  return complex ? "powerful" : AI_AGENTS.website_generation.defaultTier;
}

function buildWebsitePlanningPrompt(input: WebsiteSpecificationInput): string {
  const config = getAgencyConfiguration();

  const lines: string[] = [
    "Plan een volledige website als WebsiteSpecification (JSON) voor het volgende bedrijf.",
    "",
    "ECHTE BESCHIKBARE INFORMATIE (uitsluitend hieruit citeren/putten):",
    `Bedrijf: ${input.businessName}`,
    `Branche: ${input.industry}`,
    `Plaats: ${input.city}${input.province ? ` (provincie ${input.province})` : ""}`,
    ...(input.address ? [`Adres: ${input.address}`] : []),
    ...(input.phone ? [`Telefoon: ${input.phone}`] : []),
    ...(input.email ? [`E-mail: ${input.email}`] : []),
    ...(input.website ? [`Huidige website: ${input.website}`] : ["Huidige website: geen"]),
    ...(input.googleRating != null
      ? [`Google-rating: ${input.googleRating} (${input.reviewCount ?? 0} reviews — echte data, mag gebruikt worden)`]
      : []),
    ...(input.leadNotes.length > 0 ? ["Notities van de agency:", ...input.leadNotes.map((note) => `- ${note}`)] : []),
    "",
    "PROJECT REQUIREMENTS (samenvatting):",
    input.requirementsSummary || "Geen specifieke requirements bekend.",
    "",
    `TEMPLATESUGGESTIE (deterministisch): ${input.suggestedTemplate}`,
    "",
  ];

  if (config.websiteDesignRules?.length) {
    lines.push("DESIGNREGELS:", ...config.websiteDesignRules.map((rule, i) => `${i + 1}. ${rule}`), "");
  }
  if (config.technologyRules?.length) {
    lines.push("TECHNOLOGIE-REGELS:", ...config.technologyRules.map((rule, i) => `${i + 1}. ${rule}`), "");
  }
  if (config.communicationTone) {
    lines.push(`COMMUNICATIETOON: ${config.communicationTone}`, "");
  }

  lines.push(
    "AFWIJKINGEN: verzin niets dat hierboven niet staat; ontbrekende informatie → null of [INFORMATIE ONBEKEND] + missingInformation.",
    "",
    "Output: uitsluitend JSON conform het schema: template, business, branding, structure, content, conversion, media, seo, missingInformation."
  );

  return lines.join("\n");
}

const WEBSITE_QC_SYSTEM = `Je bent de kwaliteitscontrole-agent van een Nederlandse webagency. Je beoordeelt een gegenereerde klantwebsite op content, UX, design, conversion en business-consistentie.

HARD REGELS:
- Je bent ADVISEREND: je rapporteert en classificeert, maar keurt NOOIT goed namens de eigenaar, start nooit levering/publicatie en noemt nooit prijzen, garanties of contractvoorwaarden.
- Gebruik alleen de aangeleverde informatie. Verzin geen feiten, problemen of claims.
- Herbeoordeel fabricatie-risico's: noem alleen reviews, certificaten, keurmerken, prijzen, garanties, klantaantallen of contactgegevens als feit als deze uit de aangeleverde echte data volgen. Anders: severity error of critical.
- Ontbrekende informatie markeer je als MISSING_INFORMATION (info/warning) — nooit als feit.
- Neem de deterministische checkresultaten serieus: je kunt zwaardere severity voorstellen, maar nooit afzwakken wat deterministisch is gevonden.
- Geen rankingclaims ("op #1 in Google") — die kunnen uit deze analyse niet volgen.
- Beoordeel Nederlands zakelijk taalgebruik: grammatica, duidelijkheid, professionele toon, consistente tone of voice.
- Geef concrete, uitvoerbare aanbevelingen in het Nederlands.
- Output uitsluitend als JSON conform het schema.`;

function getWebsiteQCTier(): AIModelTier {
  const override = (process.env.WEBSITE_QC_AI_TIER ?? "").trim().toLowerCase();
  if (override === "fast" || override === "balanced" || override === "powerful") return override;
  return AI_AGENTS.website_quality_control.defaultTier;
}

function buildWebsiteQCPrompt(input: WebsiteQualityAnalysisInput): string {
  return [
    "Beoordeel de volgende gegenereerde website op content, UX, design, conversion en business-consistentie.",
    "",
    "ECHTE BEDRIJFSDATA:",
    `Bedrijf: ${input.businessName}`,
    `Branche: ${input.industry}`,
    `Plaats: ${input.city}`,
    `Lead-status: ${input.leadStatus}`,
    "",
    "PROJECT REQUIREMENTS (samenvatting):",
    input.requirementsSummary,
    "",
    "WEBSITE SPECIFICATION (samenvatting):",
    input.specificationSummary,
    "",
    "GEGENEERDE SECTIES (samenvatting):",
    input.generatedSectionsSummary,
    "",
    "DETERMINISTISCHE CHECKRESULTATEN (serieus nemen — niet afzwakken):",
    input.deterministicResults,
    "",
    "Lever JSON met: contentAssessment, designAssessment, responsiveAssessment, conversionAssessment, businessAccuracyAssessment (elk met result/issues/notes), recommendations en summary.",
  ].join("\n");
}

const REQUIREMENTS_SYSTEM = `Je bent de pricing-agent van een Nederlandse webagency. Je analyseert de beschikbare lead- en salescontext en stelt projectrequirements voor.

Regels:
- Gebruik uitsluitend de aangeleverde context; verzin geen feiten, wensen of functionaliteiten.
- Zet velden op null zodra de informatie er niet is — NOOIT gokken of invullen.
- Som in missingInformation precies op wat er ontbreekt voor een betrouwbaar prijsvoorstel.
- Stel maximaal 3 concrete vervolgvragen.
- Bepaal complexiteit: custom functionaliteit, integraties of webshops zijn "custom".
- Je berekent NOOIT een prijs en noemt geen bedragen — de prijs komt uit de configuratie.
- Output: uitsluitend geldig JSON conform het gevraagde schema.`;

function getPricingTier(): AIModelTier {
  const override = (process.env.PRICING_AI_TIER ?? "").trim().toLowerCase();
  if (override === "fast" || override === "balanced" || override === "powerful") return override;
  return AI_AGENTS.pricing.defaultTier;
}

function buildRequirementsPrompt(input: RequirementsAnalysisInput): string {
  const config = getAgencyConfiguration();

  const lines: string[] = [
    "Stel projectrequirements voor op basis van de beschikbare context.",
    "",
    "LEADCONTEXT:",
    `Bedrijf: ${input.businessName}`,
    `Branche: ${input.industry}`,
    `Stad: ${input.city}`,
    ...(typeof input.leadScore === "number" ? [`Lead score: ${input.leadScore}`] : []),
    ...(input.demoUrl ? [`Demo-website: ${input.demoUrl}`] : []),
  ];

  if (input.qualificationSummary) {
    lines.push("", "LAATSTE KWALIFICATIE (samenvatting):", input.qualificationSummary);
  }
  if (input.inboundExcerpts?.length) {
    lines.push("", "CITATEN UIT INKOMENDE BERICHTEN:", ...input.inboundExcerpts.map((excerpt) => `- "${excerpt}"`));
  }
  if (input.existingRequirements && Object.keys(input.existingRequirements).length > 0) {
    lines.push("", "BESTAANDE REQUIREMENTS (respecteer deze tenzij context ze tegenspreekt):", JSON.stringify(input.existingRequirements));
  }

  lines.push(
    "",
    "REGELS:",
    ...(config.qualificationRules?.length
      ? config.qualificationRules.map((rule, i) => `${i + 1}. ${rule}`)
      : [
          "1. Vul alleen velden in die uit de context volgen; de rest null.",
          "2. Gok nooit; onbekend = null + vermeld in missingInformation.",
          "3. Noem geen bedragen of prijzen.",
          "4. Nederlands, concreet, maximaal 3 vervolgvragen.",
        ]),
    "",
    'Output: JSON met "projectType", "complexity", "requirements" (alle velden expliciet, null indien onbekend), "missingInformation", "questions", "confidence".'
  );

  return lines.join("\n");
}

const SALES_SYSTEM = `Je bent de sales-agent van een Nederlandse webagency. Je analyseert inkomende reacties van leads en bereidt een antwoord CONCEPT voor — nooit een definitieve toezegging, nooit automatisch verzenden.

Regels:
- Classificeer de intent en eventuele bezwaren eerlijk; twijfel je, kies "unclear" en zet escalationRequired op true. Gok nooit.
- Kwalificeer voorzichtig: markeer een lead alleen als "qualified" als cruciale informatie echt bekend is; anders "qualifying".
- Stel alleen antwoorden op basis van de aangeleverde context; verzin geen feiten, namen of afspraken.
- Geef NOOIT prijzen, korting, garanties, deadlines, contractuele of juridische toezeggingen — markeer die vragen voor menselijke opvolging (escalationRequired).
- Vermeld niet richting de klant dat deze tekst AI-gegenereerd is en deel geen interne systeeminfo.
- Noem de demo-website alléén als die in de context staat (met de gegeven URL).
- Output: uitsluitend geldig JSON conform het gevraagde schema.`;

function getSalesTier(): AIModelTier {
  const override = (process.env.SALES_AI_TIER ?? "").trim().toLowerCase();
  if (override === "fast" || override === "balanced" || override === "powerful") return override;
  return AI_AGENTS.sales.defaultTier;
}

function buildSalesPrompt(input: SalesAnalysisInput): string {
  const config = getAgencyConfiguration();

  const lines: string[] = [
    "Analyseer de inkomende reactie van deze lead en bereid een antwoord-concept voor.",
    "",
    "LEADCONTEXT (uitsluitend hieruit putten, niets verzinnen):",
    `Bedrijf: ${input.businessName}`,
    `Branche: ${input.industry}`,
    `Stad: ${input.city}`,
    `Websitestatus: ${input.websiteStatus}${input.website ? ` (huidige site: ${input.website})` : ""}`,
    ...(typeof input.leadScore === "number" ? [`Lead score: ${input.leadScore}`] : []),
    ...(input.demoUrl ? [`Demo-website beschikbaar: ${input.demoUrl} (${input.demoHeadline ?? "geen headline"})`] : ["Er is GEEN demo-website — noem geen demo."]),
  ];

  if (input.outreachHistory?.length) {
    lines.push("", "EERDERE OUTREACH (concepten; verzenden bestaat nog niet, dus beschouw als voorgeschiedenis):", ...input.outreachHistory.map((h) => `- ${h}`));
  }
  if (input.previousInbound?.length) {
    lines.push("", "EERDERE INKOMENDE BERICHTEN (oudste eerst):");
    for (const m of input.previousInbound) {
      lines.push(`- [${m.receivedAt}] ${m.subject || "(geen onderwerp)"}: ${m.body.slice(0, 300)}`);
    }
  }
  if (input.previousInteractions?.length) {
    lines.push("", "EERDERE SALES-ANALYSES (samenvattingen):", ...input.previousInteractions.map((h) => `- ${h}`));
  }

  lines.push(
    "",
    "INKOMEND BERICHT (de te analyseren reactie):",
    `Afzender: ${input.inbound.sender}`,
    `Kanaal: ${input.inbound.channel}`,
    `Onderwerp: ${input.inbound.subject || "(geen onderwerp)"}`,
    `Ontvangen: ${input.inbound.receivedAt}`,
    `Body:`,
    input.inbound.body,
    "",
    "REGELS:",
    ...(config.salesRules?.length ? config.salesRules.map((r, i) => `${i + 1}. ${r}`) : [
      "1. Geef geen prijzen, kortingen, garanties, deadlines of contractuele toezeggingen.",
      "2. Gebruik uitsluitend de beschikbare context; verzin niets.",
      "3. Vraag bij onduidelijkheid NA — niet gokken; zet escalationRequired op true.",
      "4. Houd het antwoord kort, vriendelijk en professioneel in het Nederlands.",
    ]),
    ...(config.forbiddenClaims?.length ? [`Verboden claims: ${config.forbiddenClaims.join("; ")}`] : []),
    "",
    'Output: JSON met "intent", "objectionType", "qualification", "response" (antwoord-concept, 50-400 woorden), "suggestedNextAction", "questions" (max 3 relevante vervolgvragen), "escalationRequired", "escalationReason" (null als niet nodig).'
  );

  return lines.join("\n");
}

const OUTREACH_SYSTEM = `Je bent de outreach-agent van een Nederlandse webagency die websites maakt voor lokale bedrijven.
Je schrijft korte, professionele Nederlandse outreach-e-mails (concept — nooit direct verzenden).

Regels:
- Gebruik uitsluitend de aangeleverde leaddata; verzin geen feiten, cijfers of namen.
- Noem geen contactpersoon bij naam; spreek het bedrijf aan.
- Doe geen claims die niet uit de data volgen.
- Noem de demo-website alléén als die in de input staat (met de gegeven URL).
- Vermeld niet richting de ontvanger dat deze tekst AI-gegenereerd is.
- Beloof geen prijzen, contracten of resultaten.
- Output: uitsluitend geldig JSON conform het gevraagde schema.`;

function getOutreachTier(): AIModelTier {
  const override = (process.env.OUTREACH_AI_TIER ?? "").trim().toLowerCase();
  if (override === "fast" || override === "balanced" || override === "powerful") return override;
  return AI_AGENTS.outreach.defaultTier;
}

function buildOutreachPrompt(input: OutreachMessageInput): string {
  const config = getAgencyConfiguration();
  const rules = getOutreachRules();

  const lines: string[] = [
    "Schrijf een gepersonaliseerd outreach-concept (e-mail) voor het volgende bedrijf.",
    "",
    "BESCHIKBARE LEADDATA (uitsluitend hieruit putten, niets verzinnen):",
    `Bedrijf: ${input.businessName}`,
    `Branche: ${input.industry}`,
    `Stad: ${input.city}`,
    `Provincie: ${input.province}`,
    `Websitestatus: ${input.websiteStatus}${input.website ? ` (huidige site: ${input.website})` : ""}`,
  ];
  if (input.phone) lines.push(`Telefoon: aanwezig`);
  if (input.email) lines.push(`E-mail: aanwezig`);
  if (typeof input.leadScore === "number") lines.push(`Lead score: ${input.leadScore}`);
  if (input.scoreFactors?.length) lines.push(`Score factoren: ${input.scoreFactors.join("; ")}`);
  if (input.leadSource) lines.push(`Bron: ${input.leadSource}`);
  if (input.discoveryNotes?.length) lines.push(`Discovery-notities: ${input.discoveryNotes.join("; ")}`);

  if (input.demo) {
    lines.push(
      "",
      "BESCHIKBARE DEMO-WEBSITE (bestaat echt en mag genoemd worden):",
      `URL: ${input.demo.url}`,
      `Headline: ${input.demo.headline}`,
      `Template: ${input.demo.template}`
    );
  } else {
    lines.push("", "Er is GEEN demo-website beschikbaar — noem geen demo of voorbeeldwebsite.");
  }

  lines.push(
    "",
    "STIJL & REGELS:",
    ...(config.communicationTone ? [`Toon: ${config.communicationTone}`] : []),
    ...(config.companyName ? [`Onderteken namens: ${config.companyName}`] : []),
    ...(config.forbiddenClaims?.length ? [`Verboden claims: ${config.forbiddenClaims.join("; ")}`] : []),
    ...rules.map((rule, index) => `${index + 1}. ${rule}`)
  );

  lines.push(
    "",
    'Output: JSON met de velden "personalizationReason" (waarom dit bedrijf relevant is, uitsluitend gebaseerd op de data), "approach" (gedachte achter de aanpak), "subject" (onderwerpregel), "body" (e-mailtekst, 150-400 woorden, gewone tekst met regeleinden als \\n) en "callToAction" (de concrete volgende stap).'
  );

  return lines.join("\n");
}

const BUSINESS_ANALYSIS_SYSTEM = `Je bent een business-analist voor een webagency die websites maakt voor lokale Nederlandse bedrijven.
Analyseer het bedrijf en geef een korte, concrete analyse in het Nederlands.
Antwoord ALTIJD met uitsluitend een geldig JSON-object (geen markdown, geen uitleg) met exact deze velden:
{"businessSummary": string, "opportunity": string, "potentialProblems": string, "recommendedApproach": string}
Elke waarde is 1-3 zinnen, concreet en gericht op het aanhouden van dit bedrijf als lead voor een website.`;

function buildBusinessAnalysisPrompt(input: BusinessAnalysisInput): string {
  const parts = [
    `Bedrijf: ${input.businessName}`,
    `Branche: ${input.industry}`,
    `Locatie: ${input.location}`,
    `Website-status: ${input.websiteStatus}`,
  ];
  if (input.website) parts.push(`Huidige website: ${input.website}`);
  if (input.googleRating != null) parts.push(`Google-beoordeling: ${input.googleRating.toFixed(1)}`);
  if (input.reviewCount != null) parts.push(`Aantal reviews: ${input.reviewCount}`);

  return [
    "Analyseer dit bedrijf voor onze webagency.",
    ...parts,
    "Geef het JSON-object met businessSummary, opportunity, potentialProblems en recommendedApproach.",
  ].join("\n");
}
