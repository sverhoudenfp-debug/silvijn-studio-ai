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
  | "design_planning"
  | "website_quality_control"
  | "quality_control"
  | "content_generation"
  | "questionnaire";

export type AITaskType =
  | "generate_text"
  | "business_analysis"
  | "outreach_generation"
  | "sales_analysis"
  | "requirements_analysis"
  | "website_planning"
  | "design_planning"
  | "website_quality_analysis"
  | "content_generation"
  | "lead_score"
  | "classify_lead"
  | "questionnaire_generation"
  | "questionnaire_completion"
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
  /** Optioneel: alleen meesturen als het model sampling ondersteunt (zie config). */
  temperature?: number;
  /**
   * Optioneel: expliciete thinking-cap (Anthropic budget_tokens, minimaal 1024).
   * Zonder cap mag een thinking-model de VOLLEDIGE max_tokens aan redeneren
   * besteden, waardoor de eigenlijke output afbreekt (live-les contentpass
   * 2026-09-20: max_tokens 20000 bereikt vóór enige JSON). Bij een gezette
   * cap stuurt de provider géén temperature (Anthropic vereist dan 1).
   */
  thinkingBudget?: number;
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
  /** Soort bericht: eerste contact, natuurlijke follow-up, of demo-aanbod. */
  messageKind?: "initial" | "followup" | "demo_offer";
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

/** Inkomend klantbericht voor de sales-agent. */
export interface InboundMessageForAI {
  sender: string;
  subject: string;
  body: string;
  receivedAt: string;
  channel: string;
}

/** Input voor de sales-agent — uitsluitend échte beschikbare context, niets verzinnen. */
export interface SalesAnalysisInput {
  businessName: string;
  industry: string;
  city: string;
  websiteStatus: string;
  website?: string | null;
  leadScore?: number | null;
  demoUrl?: string | null;
  demoHeadline?: string | null;
  outreachHistory?: string[];
  previousInbound?: InboundMessageForAI[];
  previousInteractions?: string[];
  missingInfoHints?: string[];
  inbound: InboundMessageForAI;
}

export type SalesIntent =
  | "interested"
  | "question"
  | "price_request"
  | "demo_request"
  | "call_request"
  | "more_information"
  | "not_interested"
  | "objection"
  | "not_now"
  | "wrong_contact"
  | "opt_out"
  | "unclear";

export type ObjectionType =
  | "price_objection"
  | "timing_objection"
  | "trust_objection"
  | "need_objection"
  | "competitor"
  | "existing_provider"
  | "not_interested"
  | "unclear";

export interface SalesQualificationAI {
  status: "unqualified" | "qualifying" | "qualified" | "not_qualified" | "needs_human";
  interestLevel: "none" | "low" | "medium" | "high";
  projectType: string | null;
  needsWebsite: boolean;
  needsEcommerce: boolean;
  wantsDemo: boolean;
  wantsCall: boolean;
  timeline: string | null;
  budgetKnown: boolean;
  decisionMakerKnown: boolean;
  requirementsKnown: boolean;
  missingInformation: string[];
  qualificationNotes: string;
  confidence: number;
}

/** Gestructureerde sales-output; gevalideerd via SalesAnalysisSchema. */
export interface SalesAnalysis {
  intent: SalesIntent;
  objectionType: ObjectionType | "none";
  qualification: SalesQualificationAI;
  response: string;
  suggestedNextAction: string;
  questions: string[];
  escalationRequired: boolean;
  escalationReason: string | null;
}

/** Input voor de requirements-analyse — uitsluitend beschikbare context. */
export interface RequirementsAnalysisInput {
  businessName: string;
  industry: string;
  city: string;
  leadScore?: number | null;
  qualificationSummary?: string | null; // samenvatting laatste SalesInteraction
  inboundExcerpts?: string[]; // korte citaten uit inkomende berichten
  demoUrl?: string | null;
  existingRequirements?: Record<string, unknown> | null;
}

/**
 * AI-voorstel voor projectrequirements. De AI interpreteert informatie,
 * identificeert ontbrekende informatie en schat complexiteit in —
 * maar berekent NOOIT de prijs; dat doet de deterministische PricingEngine.
 */
export interface RequirementsAnalysis {
  projectType: string | null;
  complexity: "low" | "medium" | "high" | "custom" | null;
  requirements: {
    websiteType: string | null;
    numberOfPages: number | null;
    designLevel: string | null;
    responsive: boolean | null;
    cms: boolean | null;
    ecommerce: boolean | null;
    customFunctionality: string | null;
    integrations: string[] | null;
    seo: boolean | null;
    copywriting: boolean | null;
    photography: boolean | null;
    hosting: boolean | null;
    maintenance: boolean | null;
    deadline: string | null;
    existingWebsite: boolean | null;
    existingBranding: boolean | null;
    contentAvailable: boolean | null;
    specialRequirements: string | null;
  };
  missingInformation: string[];
  questions: string[];
  confidence: number;
}
export interface QuestionnaireGeneration {
  title: string;
  intro: string;
  questions: {
    id: string;
    label: string;
    type: "text" | "textarea" | "email" | "tel" | "select" | "upload";
    options?: string[];
    required?: boolean;
    help?: string;
  }[];
}

export interface QuestionnaireCompletion {
  sufficient: boolean;
  summary: string;
  resolvedInformation: { key: string; value: string }[];
  missingInformation: string[];
  followUpQuestions: QuestionnaireGeneration["questions"];
  /** C1: per dimensie herleide inhoud ("" = onbekend; NIET_BESCHIKBAAR-prefix = expliciet afgezegd). */
  contentDimensions: {
    offering: string;
    usps: string;
    proof: string;
    audience: string;
    toneOfVoice: string;
    branding: string;
    media: string;
  };
}


/**
 * Context voor de AI-websiteplanning — uitsluitend beschikbare, echte
 * informatie uit lead, project, requirements en configuratie. De AI
 * verzint hier GEEN feiten aan toe.
 */
export interface WebsiteSpecificationInput {
  businessName: string;
  industry: string;
  city: string;
  province: string | null;
  address: string | null;
  phone: string | null; // echte contactgegevens mogen getoond worden
  email: string | null;
  website: string | null;
  leadNotes: string[]; // menselijke notities — betrouwbare bron
  requirementsSummary: string;
  existingWebsite: boolean;
  googleRating: number | null; // échte Google-data; mag gebruikt worden
  reviewCount: number | null;
  suggestedTemplate: string; // deterministische suggestie (engine)
  /**
   * Compacte samenvatting van het INTERNE Design Plan (Fase I.1) — optionele
   * AANVULLENDE bron. Geplande functionaliteit hieruit (bijv. contactformulier)
   * moet in de specificatie terugkomen; de samenvatting bevat uitsluitend
   * feiten uit het plan zelf en is nooit een vrijbrief om data te verzinnen.
   */
  designPlanSummary?: string | null;
}

/**
 * Context voor de AI-kwaliteitsanalyse (Fase 10) — de AI ontvangt
 * uitsluitend echte data + de uitkomsten van de deterministische checks.
 * De AI is ADVISEREND: ze mag analyseren en classificeren, maar nooit
 * goedkeuren, leveren, publiceren of harde FAIL-regels overrulen.
 */
/**
 * Context voor de AI-designplanning (Fase I.1) — uitsluitend beschikbare,
 * echte informatie uit lead, project, requirements, questionnaires en
 * salescontext. De AI verzint hier GEEN feiten aan toe; het plan is intern
 * en nooit klantzichtbaar.
 */
export interface DesignPlanInput {
  businessName: string;
  industry: string;
  city: string;
  province: string | null;
  leadNotes: string[];
  requirementsSummary: string;
  numberOfPages: number | null;
  ecommerce: boolean | null;
  specialRequirements: string | null;
  existingWebsite: boolean;
  googleRating: number | null;
  reviewCount: number | null;
  questionnaireSummary: string[];
  hasCompletedQuestionnaire: boolean;
  suggestedTemplate: string;
}

export interface WebsiteQualityAnalysisInput {
  businessName: string;
  industry: string;
  city: string;
  leadStatus: string;
  requirementsSummary: string;
  specificationSummary: string;
  generatedSectionsSummary: string;
  deterministicResults: string;
}

export interface AIJSONOutput<T> {
  data: T;
  schema: z.ZodType<T>;
}
