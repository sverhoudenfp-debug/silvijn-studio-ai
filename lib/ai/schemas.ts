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
