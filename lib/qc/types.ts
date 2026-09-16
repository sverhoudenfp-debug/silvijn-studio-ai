/**
 * Quality Control-domein types (Fase 10).
 *
 * Hybride QC: DETERMINISTISCHE checks (technisch/security/structureel —
 * betrouwbaar codeerbaar) + AI Quality Analysis (content, UX, design,
 * conversion, business-consistentie) → gecombineerd QC-rapport.
 *
 * De AI mag analyseren, classificeren en aanbevelen — maar NOOIT:
 * - een website goedkeuren namens Silvijn
 * - een project/contract goedkeuren
 * - een klant informeren of een levering starten
 * - harde veiligheidsregels (FAIL-regels) overrulen.
 *
 * De absolute eindcontrole (READY_FOR_SILVIJN → APPROVED) is een
 * MENSELIJKE actie via een server action. Er is geen override.
 */

export type QCStatus = "pending" | "running" | "completed" | "failed";

export type QCResult = "pass" | "needs_revision" | "fail" | "blocked";

export type IssueSeverity = "info" | "warning" | "error" | "critical";

export type QCCategory =
  | "technical"
  | "content"
  | "design"
  | "responsive"
  | "conversion"
  | "seo"
  | "accessibility"
  | "security"
  | "business_accuracy";

export type CategoryCheckResult = "passed" | "warning" | "failed" | "not_checked";

export interface QCIssue {
  id: string;
  category: QCCategory;
  severity: IssueSeverity;
  /** Deterministische regel-ID of "ai" voor AI-gevonden issues. */
  rule: string;
  message: string;
}

export interface QCCategoryCheck {
  category: QCCategory;
  result: CategoryCheckResult;
  issues: QCIssue[];
  notes: string[];
}

/** Deterministische resultaten mogen door de AI niet worden afgezwakt. */
export function worstResult(a: CategoryCheckResult, b: CategoryCheckResult): CategoryCheckResult {
  const order: CategoryCheckResult[] = ["passed", "not_checked", "warning", "failed"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

export function severityWorst(a: IssueSeverity, b: IssueSeverity): IssueSeverity {
  const order: IssueSeverity[] = ["info", "warning", "error", "critical"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

export const SEVERITY_ORDER: IssueSeverity[] = ["info", "warning", "error", "critical"];

/** Menselijke actie op een QC-rapport (hard gelogd, nooit automatisch). */
export interface QCApprovalAction {
  action: "approved" | "revision_requested" | "archived";
  /** Agency-user-abstraction — volledig auth-systeem is een latere fase. */
  by: string;
  at: string;
  reason?: string;
  selectedIssueIds?: string[];
  notes?: string;
  websiteVersion: number;
}

export interface QualityControl {
  id: string;
  generatedWebsiteId: string;
  projectId: string;
  leadId: string;
  /** Versie van de website die gecontroleerd is. */
  websiteVersion: number;
  status: QCStatus;
  overallResult: QCResult;
  checks: QCCategoryCheck[];
  issues: QCIssue[];
  /** Warning-level berichten (afgeleid uit issues) voor snelle weergave. */
  warnings: string[];
  passedChecks: QCCategory[];
  failedChecks: QCCategory[];
  recommendations: string[];
  aiSummary: string;
  /** Interne kwaliteitsindicator 0-100 — GEEN commerciële prijs en GEEN
   * automatisch "goed genoeg voor klant"-oordeel; approval blijft menselijk. */
  score: number;
  aiRunId?: string | null;
  mode: "mock" | "live";
  model: string;
  /** Laatste menselijke actie (approve/revision/archive) op dit rapport. */
  approval: QCApprovalAction | null;
  createdAt: string;
  updatedAt: string;
}

export const QC_CATEGORIES: QCCategory[] = [
  "technical",
  "content",
  "design",
  "responsive",
  "conversion",
  "seo",
  "accessibility",
  "security",
  "business_accuracy",
];

export const QC_CATEGORY_LABELS: Record<QCCategory, string> = {
  technical: "Technical",
  content: "Content",
  design: "Design",
  responsive: "Responsive",
  conversion: "Conversion",
  seo: "SEO",
  accessibility: "Accessibility",
  security: "Security",
  business_accuracy: "Business Accuracy",
};

export function issuesWithSeverity(qc: QualityControl, severities: IssueSeverity[]): QCIssue[] {
  return qc.issues.filter((issue) => severities.includes(issue.severity));
}
