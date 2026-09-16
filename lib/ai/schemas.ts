import { z } from "zod";

/** Zod-schema's voor gestructureerde AI-output. AI-output wordt NOOIT blind vertrouwd. */

export const BusinessAnalysisSchema = z.object({
  businessSummary: z.string().min(20, "businessSummary te kort"),
  opportunity: z.string().min(10, "opportunity te kort"),
  potentialProblems: z.string().min(10, "potentialProblems te kort"),
  recommendedApproach: z.string().min(10, "recommendedApproach te kort"),
});

export const LeadScoreAISchema = z.object({
  score: z.number().int().min(0).max(100),
  category: z.enum(["Excellent", "High", "Medium", "Low"]),
  reasons: z.array(z.string().min(3)).min(1).max(5),
});

export const OutreachMessageSchema = z.object({
  personalizationReason: z.string().min(20, "personalizationReason te kort"),
  approach: z.string().min(10, "approach te kort"),
  subject: z.string().min(5, "subject te kort").max(120, "subject te lang"),
  body: z.string().min(150, "body te kort").max(2500, "body te lang"),
  callToAction: z.string().min(10, "callToAction te kort"),
});

export const SalesAnalysisSchema = z.object({
  intent: z.enum([
    "interested", "question", "price_request", "demo_request", "call_request",
    "more_information", "not_interested", "objection", "not_now",
    "wrong_contact", "opt_out", "unclear",
  ]),
  objectionType: z.enum([
    "price_objection", "timing_objection", "trust_objection", "need_objection",
    "competitor", "existing_provider", "not_interested", "unclear", "none",
  ]),
  qualification: z.object({
    status: z.enum(["unqualified", "qualifying", "qualified", "not_qualified", "needs_human"]),
    interestLevel: z.enum(["none", "low", "medium", "high"]),
    projectType: z.string().nullable(),
    needsWebsite: z.boolean(),
    needsEcommerce: z.boolean(),
    wantsDemo: z.boolean(),
    wantsCall: z.boolean(),
    timeline: z.string().nullable(),
    budgetKnown: z.boolean(),
    decisionMakerKnown: z.boolean(),
    requirementsKnown: z.boolean(),
    missingInformation: z.array(z.string()).max(8),
    qualificationNotes: z.string().min(10),
    confidence: z.number().min(0).max(1),
  }),
  response: z.string().min(50, "response te kort").max(2500, "response te lang"),
  suggestedNextAction: z.string().min(10, "suggestedNextAction te kort"),
  questions: z.array(z.string().min(5)).max(5),
  escalationRequired: z.boolean(),
  escalationReason: z.string().nullable(),
});

export const RequirementsAnalysisSchema = z.object({
  projectType: z.string().nullable(),
  complexity: z.enum(["low", "medium", "high", "custom"]).nullable(),
  requirements: z.object({
    websiteType: z.string().nullable(),
    numberOfPages: z.number().int().positive().nullable(),
    designLevel: z.string().nullable(),
    responsive: z.boolean().nullable(),
    cms: z.boolean().nullable(),
    ecommerce: z.boolean().nullable(),
    customFunctionality: z.string().nullable(),
    integrations: z.array(z.string()).nullable(),
    seo: z.boolean().nullable(),
    copywriting: z.boolean().nullable(),
    photography: z.boolean().nullable(),
    hosting: z.boolean().nullable(),
    maintenance: z.boolean().nullable(),
    deadline: z.string().nullable(),
    existingWebsite: z.boolean().nullable(),
    existingBranding: z.boolean().nullable(),
    contentAvailable: z.boolean().nullable(),
    specialRequirements: z.string().nullable(),
  }),
  missingInformation: z.array(z.string()).max(10),
  questions: z.array(z.string().min(5)).max(5),
  confidence: z.number().min(0).max(1),
});

export const WebsiteSpecificationSchema = z.object({
  template: z.enum(["local_service", "professional_service", "home_improvement", "business_standard"]),
  business: z.object({
    businessName: z.string().min(2),
    industry: z.string().min(2),
    city: z.string().min(2),
    province: z.string().nullable(),
    description: z.string().nullable(),
    targetAudience: z.string().nullable(),
  }),
  branding: z.object({
    primaryColor: z.string().nullable(),
    secondaryColor: z.string().nullable(),
    accentColor: z.string().nullable(),
    backgroundStyle: z.string().nullable(),
    typographyStyle: z.string().nullable(),
    visualStyle: z.string().nullable(),
  }),
  structure: z.object({
    pages: z.array(z.object({ key: z.string().min(1), title: z.string().nullable() })).max(10),
    navigation: z.array(z.string().min(1)).max(8),
    sections: z.array(z.string().min(1)).max(12),
  }),
  content: z.object({
    headline: z.string().min(5),
    subheadline: z.string().nullable(),
    valueProposition: z.string().nullable(),
    services: z
      .array(z.object({ title: z.string().min(2), description: z.string().nullable() }))
      .min(1)
      .max(8),
    about: z.string().nullable(),
    benefits: z.array(z.string().min(3)).max(8),
    faq: z.array(z.object({ question: z.string().min(5), answer: z.string().min(5) })).max(8),
    testimonials: z.array(z.string().min(5)).max(5),
    contactIntro: z.string().nullable(),
    ctaPrimaryText: z.string().min(3),
    ctaSecondaryText: z.string().nullable(),
  }),
  conversion: z.object({
    primaryCta: z.string().min(2),
    secondaryCta: z.string().nullable(),
    contactMethods: z.array(z.string().min(2)).max(6),
    leadCapture: z.boolean(),
  }),
  media: z.object({
    imageRequirements: z
      .array(z.object({ key: z.string().min(2), description: z.string().min(5), required: z.boolean() }))
      .max(10),
    imageDescriptions: z.array(z.string().min(3)).max(10),
    imagePlaceholders: z.array(z.string().min(3)).max(10),
  }),
  seo: z.object({
    title: z.string().min(5),
    metaDescription: z.string().min(20).max(200),
    keywords: z.array(z.string().min(2)).max(12),
    localArea: z.string().nullable(),
  }),
  missingInformation: z.array(z.string().min(5)).max(12),
});

export const QCAssessmentSchema = z.object({
  result: z.enum(["passed", "warning", "failed", "not_checked"]),
  issues: z
    .array(
      z.object({
        severity: z.enum(["info", "warning", "error", "critical"]),
        message: z.string().min(5),
      })
    )
    .max(10),
  notes: z.string().nullable(),
});

export const QCAnalysisSchema = z.object({
  contentAssessment: QCAssessmentSchema,
  designAssessment: QCAssessmentSchema,
  responsiveAssessment: QCAssessmentSchema,
  conversionAssessment: QCAssessmentSchema,
  businessAccuracyAssessment: QCAssessmentSchema,
  recommendations: z.array(z.string().min(5)).max(10),
  summary: z.string().min(20),
});

/** JSON extraheren uit een modelantwoord (tolereert code-fences en whitespace). */
export function extractJSON(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Geen JSON-object gevonden in AI-antwoord");
  }
  return JSON.parse(stripped.slice(start, end + 1));
}
