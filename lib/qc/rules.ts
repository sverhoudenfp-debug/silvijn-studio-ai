import type {
  CategoryCheckResult,
  QCCategoryCheck,
  QCResult,
  QCIssue,
} from "./types";

/**
 * Automatische result-regels (Fase 10, spec §16) — DETERMINISTISCH.
 *
 * De AI mag deze harde regels NOOIT overrulen (de AI kan alleen issues
 * toevoegen of zwaarder classificeren). De score is een interne
 * kwaliteitsindicator — geen commerciële prijs en nooit een automatisch
 * "goed genoeg voor de klant"-oordeel; de approval blijft menselijk.
 */

/** Fabricatie-regels: ongefundeerde bedrijfsfeiten zijn hard verboden. */
const FABRICATION_RULES = new Set(
  [
    "prijs",
    "garantie",
    "certificering",
    "ervaring",
    "klantaantal",
    "review-claim",
    "openingstijden",
    "testimonials",
    "telefoonnummer",
    "e-mailadres",
  ].map((rule) => `fabrication_${rule}`)
);

export function computeOverallResult(
  checks: QCCategoryCheck[],
  issues: QCIssue[]
): QCResult {
  const byCategory = new Map(checks.map((c) => [c.category, c]));

  // 1. CRITICAL issue → FAIL
  if (issues.some((i) => i.severity === "critical")) return "fail";

  // 2. Security failure → FAIL
  if (byCategory.get("security")?.result === "failed") return "fail";

  // 3. Technical build/structuur failure → FAIL
  if (byCategory.get("technical")?.result === "failed") return "fail";

  // 4. Gefabriceerde bedrijfsinformatie → FAIL
  if (issues.some((i) => FABRICATION_RULES.has(i.rule) && (i.severity === "error" || i.severity === "critical"))) {
    return "fail";
  }

  // 5. Misplaatste bedrijfsnaam is een harde feitelijke fout → FAIL
  if (issues.some((i) => i.rule === "business_name")) return "fail";

  // 6. ERROR issues of FAILED categorieën → NEEDS_REVISION
  if (issues.some((i) => i.severity === "error")) return "needs_revision";
  if (checks.some((c) => c.result === "failed")) return "needs_revision";

  // 7. Alleen warnings (of minder) → kan PASS zijn
  return "pass";
}

/** Interne kwaliteitsindicator 0-100. */
export function computeScore(checks: QCCategoryCheck[], issues: QCIssue[]): number {
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === "critical") score -= 40;
    else if (issue.severity === "error") score -= 15;
    else if (issue.severity === "warning") score -= 3;
  }
  for (const check of checks) {
    if (check.result === "failed") score -= 10;
    if (check.result === "not_checked") score -= 2;
  }
  return Math.max(0, Math.min(100, score));
}

export function summarizeCategoryResults(checks: QCCategoryCheck[]): string {
  return checks
    .map((check) => `${check.category}: ${check.result}${check.issues.length > 0 ? ` (${check.issues.length} issues)` : ""}`)
    .join("; ");
}

/** Categorie-resultaat bepalen na merge van deterministisch + AI. */
export function categoryResultFromIssues(issues: QCIssue[]): CategoryCheckResult {
  if (issues.some((i) => i.severity === "error" || i.severity === "critical")) return "failed";
  if (issues.some((i) => i.severity === "warning")) return "warning";
  return "passed";
}
