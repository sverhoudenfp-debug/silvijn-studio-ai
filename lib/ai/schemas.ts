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
