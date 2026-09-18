import type { ProjectRequirements } from "./types";

/**
 * DETERMINISTISCHE requirements-completeness (Fase I.1).
 *
 * Dit is de applicatielaag-spiegel van de SQL-functie
 * public.evaluate_project_requirements_complete (migratie 0020). De SQL-functie
 * is de enige instantie die requirements_complete KAN zetten (via de owner-RPC
 * set_project_requirements_complete); deze module geeft de UI dezelfde
 * uitspraak leesbaar weer, zonder zelf iets te muteren.
 *
 * SPIEGELVERSPREKING — de zes blokkerende checks zijn 1-op-1 hetzelfde als in
 * SQL (zelfde keys, zelfde logica):
 *   1. website_type      — requirements.websiteType bekend (niet leeg)
 *   2. page_count        — requirements.numberOfPages een geheel getal ≥ 1
 *   3. design_level      — requirements.designLevel bekend (niet leeg)
 *   4. ecommerce_known   — requirements.ecommerce bekend (boolean)
 *   5. copywriting_known — requirements.copywriting bekend (boolean)
 *   6. questionnaire_completion — geen actieve questionnaire van deze lead
 *                          die nog niet QUESTIONNAIRE_COMPLETE is (open,
 *                          follow-up of aandachtspunt blokkeert; gesloten
 *                          questionnaires blokkeren niet).
 *
 * Aandachtspunten (niet blokkerend, wel in de UI): deadline onbekend,
 * huisstijl onbekend, content-beschikbaarheid onbekend. Ontbrekende
 * informatie wordt getoond — nooit gegokt.
 */

export interface QuestionnaireCompletenessSummary {
  status: string;
  completionStatus: string | null;
}

export interface CompletenessCheck {
  key:
    | "website_type"
    | "page_count"
    | "design_level"
    | "ecommerce_known"
    | "copywriting_known"
    | "questionnaire_completion";
  label: string;
  passed: boolean;
  detail: string;
  blocking: true;
}

export interface CompletenessEvaluation {
  complete: boolean;
  /** Blokkerende missende informatie (keys). */
  blockingMissing: string[];
  /** Niet-blokkerende aandachtspunten (leesbare zinnen). */
  attention: string[];
  checks: CompletenessCheck[];
}

const BLOCKING_CHECK_KEYS: ReadonlySet<CompletenessCheck["key"]> = new Set([
  "website_type",
  "page_count",
  "design_level",
  "ecommerce_known",
  "copywriting_known",
  "questionnaire_completion",
]);

export function evaluateRequirementsCompleteness(
  requirements: ProjectRequirements,
  questionnaires: QuestionnaireCompletenessSummary[]
): CompletenessEvaluation {
  const checks: CompletenessCheck[] = [];

  const websiteType = (requirements.websiteType ?? "").trim();
  checks.push({
    key: "website_type",
    label: "Type website bekend",
    passed: websiteType.length > 0,
    detail: websiteType.length > 0 ? `Type: ${websiteType}` : "websiteType ontbreekt in de requirements",
    blocking: true,
  });

  const pages = requirements.numberOfPages;
  const pagesValid = typeof pages === "number" && Number.isInteger(pages) && pages >= 1;
  checks.push({
    key: "page_count",
    label: "Aantal pagina's bekend (geheel getal ≥ 1)",
    passed: pagesValid,
    detail: pagesValid ? `Aantal pagina's: ${pages}` : "numberOfPages ontbreekt of is geen geheel getal ≥ 1",
    blocking: true,
  });

  const designLevel = (requirements.designLevel ?? "").trim();
  checks.push({
    key: "design_level",
    label: "Designniveau bekend",
    passed: designLevel.length > 0,
    detail: designLevel.length > 0 ? `Designniveau: ${designLevel}` : "designLevel ontbreekt in de requirements",
    blocking: true,
  });

  const ecommerceKnown = typeof requirements.ecommerce === "boolean";
  checks.push({
    key: "ecommerce_known",
    label: "E-commerce-wens bekend",
    passed: ecommerceKnown,
    detail: ecommerceKnown
      ? requirements.ecommerce
        ? "E-commerce: ja"
        : "E-commerce: nee"
      : "ecommerce ontbreekt in de requirements (onbekend ≠ nee)",
    blocking: true,
  });

  const copywritingKnown = typeof requirements.copywriting === "boolean";
  checks.push({
    key: "copywriting_known",
    label: "Tekstverzorging bekend",
    passed: copywritingKnown,
    detail: copywritingKnown
      ? requirements.copywriting
        ? "Teksten: agency verzorgt"
        : "Teksten: klant verzorgt"
      : "copywriting ontbreekt in de requirements",
    blocking: true,
  });

  const openQuestionnaire = questionnaires.find(
    (q) => q.status === "active" && q.completionStatus !== "QUESTIONNAIRE_COMPLETE"
  );
  checks.push({
    key: "questionnaire_completion",
    label: "Vragenlijst afgerond (of niet nodig)",
    passed: !openQuestionnaire,
    detail: openQuestionnaire
      ? "Er is nog een actieve questionnaire die niet (volledig) is afgerond — voltooi of sluit deze eerst."
      : "Geen openstaande questionnaire die productie blokkeert.",
    blocking: true,
  });

  // ---- Niet-blokkerende aandachtspunten
  const attention: string[] = [];
  if (!requirements.deadline) attention.push("Deadline is niet bekend");
  if (requirements.existingBranding == null) attention.push("Huisstijl/merkmaterialen zijn niet bekend");
  if (requirements.contentAvailable == null) attention.push("Beschikbaarheid van content (teksten/beeld) is niet bekend");

  const blockingMissing = checks.filter((c) => !c.passed && BLOCKING_CHECK_KEYS.has(c.key)).map((c) => c.key);

  return {
    complete: blockingMissing.length === 0,
    blockingMissing,
    attention,
    checks,
  };
}
