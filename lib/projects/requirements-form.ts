import type { ProjectRequirements } from "@/lib/projects/types";

/**
 * Requirements-formulier (Fase 8 UI). Dit module is bewust een puur,
 * React-vrij serialisatiecontract zodat het regressietestbaar is
 * (tests/requirements-form.test.ts).
 *
 * HARTE REGELS (live-incident 2026-09-19, project d1f66ce0):
 * 1. Een formulier-save mag NOOIT velden verliezen die niet in het
 *    formulier zichtbaar zijn (responsive, integrations, photography,
 *    existingWebsite, existingBranding, contentAvailable,
 *    specialRequirements, ...). Vroeger bouwde fromFormState een
 *    compleet nieuw object, waardoor responsive verdween en null-velden
 *    werden bijgeschreven — één onschuldige opslag resette daardoor
 *    requirements_complete (0020-guard) en maakte de goedgekeurde
 *    scope-snapshot ongeldig (production gate 0010).
 * 2. Een save zonder inhoudelijke wijziging moet de requirements
 *    BYTE-EXACT behouden: de 0020-guard vergelijkt met
 *    `new.requirements is distinct from old.requirements` en de
 *    productie-poort vergelijkt `scope_snapshot = requirements`
 *    (JSONB-gelijkheid). Identieke JSONB = geen reset, geen gate-falen.
 * 3. Lege optionele velden volgen het bestaande contract (onbekend =
 *    null), maar een veld dat nog niet bestond wordt NIET als null
 *    toegevoegd — dat zou een onbedoelde scopewijziging zijn.
 */

export interface RequirementsFormState {
  websiteType: string;
  numberOfPages: string;
  designLevel: string;
  responsive: string; // "true" | "false" | "unknown"
  ecommerce: string; // "true" | "false" | "unknown"
  seo: string;
  copywriting: string;
  hosting: string;
  maintenance: string;
  cms: string;
  deadline: string;
  customFunctionality: string;
}

const TRISTATE_KEYS = ["responsive", "ecommerce", "seo", "copywriting", "hosting", "maintenance", "cms"] as const;

export function toFormState(requirements: ProjectRequirements): RequirementsFormState {
  return {
    websiteType: requirements.websiteType ?? "",
    numberOfPages: requirements.numberOfPages != null ? String(requirements.numberOfPages) : "",
    designLevel: requirements.designLevel ?? "",
    responsive: requirements.responsive == null ? "unknown" : String(requirements.responsive),
    ecommerce: requirements.ecommerce == null ? "unknown" : String(requirements.ecommerce),
    seo: requirements.seo == null ? "unknown" : String(requirements.seo),
    copywriting: requirements.copywriting == null ? "unknown" : String(requirements.copywriting),
    hosting: requirements.hosting == null ? "unknown" : String(requirements.hosting),
    maintenance: requirements.maintenance == null ? "unknown" : String(requirements.maintenance),
    cms: requirements.cms == null ? "unknown" : String(requirements.cms),
    deadline: requirements.deadline ?? "",
    customFunctionality: requirements.customFunctionality ?? "",
  };
}

/**
 * Serialiseert het formulier NAAR requirements, gemerged op de HUIDIGE
 * requirements. `current` is de bron van waarheid voor elk veld dat het
 * formulier niet toont; zichtbare velden worden overschreven met de
 * formulierwaarde. null wordt uitsluitend geschreven als het veld al
 * bestond (expliciet onbekend maken is een echte wijziging); een leeg
 * veld dat nog niet bestond wordt niet toegevoegd.
 */
export function fromFormState(form: RequirementsFormState, current: ProjectRequirements): ProjectRequirements {
  // 1. Behoud ALLE bestaande velden — ook de velden zonder formulier-UI.
  const next: ProjectRequirements = { ...current };

  const assign = (key: keyof ProjectRequirements, value: string | number | boolean | null) => {
    if (value === null && !(key in next)) return; // leeg + nog niet bestaand: geen scopewijziging
    (next as Record<string, string | number | boolean | null>)[key] = value;
  };

  const pages = Number.parseInt(form.numberOfPages, 10);
  assign("websiteType", form.websiteType.trim() || null);
  assign("numberOfPages", Number.isFinite(pages) && pages > 0 ? pages : null);
  assign("designLevel", form.designLevel.trim() || null);
  for (const key of TRISTATE_KEYS) {
    const raw = form[key];
    assign(key, raw === "true" ? true : raw === "false" ? false : null);
  }
  assign("deadline", form.deadline.trim() || null);
  assign("customFunctionality", form.customFunctionality.trim() || null);

  return next;
}
