import type { z } from "zod";
import type { QCAnalysisSchema } from "@/lib/ai/schemas";

/** AI-kwaliteitsanalyse-output (Zod-gevalideerd) — adviserend, nooit goedkeurend. */
export type QCAnalysis = z.infer<typeof QCAnalysisSchema>;
export type QCAssessment = QCAnalysis["contentAssessment"];
