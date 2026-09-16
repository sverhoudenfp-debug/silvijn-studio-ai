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
import { BusinessAnalysisSchema, OutreachMessageSchema, extractJSON } from "./schemas";
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
} from "./types";
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
