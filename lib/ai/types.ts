import type { z } from "zod";

/** Model-tiers — exacte model-ID's worden centraal geconfigureerd (lib/ai/config.ts). */
export type AIModelTier = "fast" | "balanced" | "powerful";

/** Mock (voorspelbaar, geen kosten) of live (echte Anthropic API). */
export type AIMode = "mock" | "live";

export type AgentType =
  | "lead_research"
  | "business_analysis"
  | "lead_scoring"
  | "demo_generation"
  | "outreach"
  | "sales"
  | "qualification"
  | "pricing"
  | "website_generation"
  | "quality_control";

export type AITaskType =
  | "generate_text"
  | "business_analysis"
  | "outreach_generation"
  | "lead_score"
  | "classify_lead"
  | "generate_structured";

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Provider-agonstisch verzoek — alleen de provider kent Anthropic-details. */
export interface AIProviderRequest {
  task: AITaskType;
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
}

export interface AIProviderResult {
  text: string;
  model: string;
  mode: AIMode;
  usage: AIUsage;
}

export interface AIProvider {
  readonly id: string;
  readonly mode: AIMode;
  generateText(request: AIProviderRequest): Promise<AIProviderResult>;
}

export interface AIServiceResult<T> {
  data: T;
  model: string;
  mode: AIMode;
  usage: AIUsage;
  estimatedCost: number;
  durationMs: number;
}

/** Input voor de business-analysis service. */
export interface BusinessAnalysisInput {
  businessName: string;
  industry: string;
  location: string;
  websiteStatus: string;
  website?: string | null;
  googleRating?: number | null;
  reviewCount?: number | null;
}

/** Gelijkt aan Lead["aiAnalysis"] — de bestaande UI kan hier direct mee overweg. */
export interface BusinessAnalysis {
  businessSummary: string;
  opportunity: string;
  potentialProblems: string;
  recommendedApproach: string;
}

/** Input voor de outreach-berichtgeneratie — uitsluitend échte leaddata, nooit verzinnen. */
export interface OutreachMessageInput {
  businessName: string;
  industry: string;
  city: string;
  province: string;
  websiteStatus: string;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  leadScore?: number | null;
  scoreFactors?: string[];
  leadSource?: string | null;
  discoveryNotes?: string[];
  demo?: {
    url: string;
    headline: string;
    description: string;
    template: string;
  } | null;
}

/** Gestructureerde outreach-output; gevalideerd via OutreachMessageSchema. */
export interface OutreachMessage {
  personalizationReason: string;
  approach: string;
  subject: string;
  body: string;
  callToAction: string;
}

export interface AIJSONOutput<T> {
  data: T;
  schema: z.ZodType<T>;
}
