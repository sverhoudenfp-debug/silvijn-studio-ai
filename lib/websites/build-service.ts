import { getWebsiteTemplateConfig, isWebsiteTemplateType } from "./templates";
import { checkWebsiteSpecificationSafety, type WebsiteSafetyContext } from "./safety-check";
import type { GeneratedWebsiteContent, WebsiteSpecification } from "./types";

/**
 * WebsiteBuildService (Fase 9) — deterministische build/validatie, zonder
 * een ongecontroleerde buildomgeving te nodig te hebben. De "build" valideert:
 * specification geldig, vereiste velden aanwezig, componenten/sections geldig
 * voor het template, geen malformed data, geen verboden content, geen secrets.
 * Wordt de specificatie of content ongeldig → buildStatus FAILED met errors.
 */

export interface WebsiteBuildResult {
  passed: boolean;
  errors: string[];
}

const VALID_SECTION_TYPES = new Set([
  "header",
  "hero",
  "services",
  "about",
  "benefits",
  "faq",
  "cta",
  "contact",
  "footer",
]);

export class WebsiteBuildService {
  /** Volledige build: specification → veiligheid → gegenereerde content. */
  build(
    specification: WebsiteSpecification,
    content: GeneratedWebsiteContent,
    safetyContext: WebsiteSafetyContext
  ): WebsiteBuildResult {
    const errors: string[] = [
      ...this.validateSpecification(specification),
      ...this.validateSafety(specification, safetyContext).map((issue) => issue.reason),
      ...this.validateContent(content),
    ];
    return { passed: errors.length === 0, errors };
  }

  validateSpecification(specification: WebsiteSpecification): string[] {
    const errors: string[] = [];
    const spec = specification;

    if (!isWebsiteTemplateType(spec.template)) {
      errors.push(`Onbekend template "${String(spec.template)}" — geldige templates: local_service, professional_service, home_improvement, business_standard.`);
      return errors;
    }

    if (!spec.business?.businessName || spec.business.businessName.trim().length < 2) {
      errors.push("businessName ontbreekt of is te kort — vereist voor elke website.");
    }
    if (!spec.business?.city || spec.business.city.trim().length < 2) {
      errors.push("Plaats (city) ontbreekt — vereist voor een lokale zakelijke website.");
    }
    if (!spec.business?.industry || spec.business.industry.trim().length < 2) {
      errors.push("Branche (industry) ontbreekt — vereist voor correcte positionering.");
    }
    if (!spec.content?.headline || spec.content.headline.trim().length < 5) {
      errors.push("Headline ontbreekt of is te kort — de hero heeft een headline nodig.");
    }
    if (!spec.content?.services || spec.content.services.length === 0) {
      errors.push("Minimaal één dienst/product vereist — een website zonder diensten heeft geen inhoud.");
    }
    if (spec.content?.ctaPrimaryText == null || spec.content.ctaPrimaryText.trim().length < 3) {
      errors.push("Primaire CTA-tekst ontbreekt — conversie vereist een duidelijke call-to-action.");
    }
    if (!spec.seo?.title || spec.seo.title.trim().length < 5) {
      errors.push("SEO-titel ontbreekt.");
    }
    if (!spec.seo?.metaDescription || spec.seo.metaDescription.trim().length < 20) {
      errors.push("SEO-meta-description ontbreekt of is te kort (minimaal 20 tekens).");
    }

    // Structuur: alleen geldige section-keys, maximaal zoals het template aangeeft.
    const templateConfig = getWebsiteTemplateConfig(spec.template);
    const unknownSections = (spec.structure?.sections ?? []).filter(
      (section) => !VALID_SECTION_TYPES.has(section as string) && section !== "home"
    );
    if (unknownSections.length > 0) {
      errors.push(`Onbekende sections in de structuur: ${unknownSections.join(", ")} — de generator kent alleen gecontroleerde componenten.`);
    }
    if ((spec.structure?.pages ?? []).length === 0) {
      errors.push("Minimaal één pagina (home) vereist in de structuur.");
    }
    void templateConfig;
    return errors;
  }

  validateSafety(specification: WebsiteSpecification, safetyContext: WebsiteSafetyContext) {
    return checkWebsiteSpecificationSafety(specification, safetyContext).issues;
  }

  /** Gegenereerde content moet uit geldige, gecontroleerde componenten bestaan. */
  validateContent(content: GeneratedWebsiteContent): string[] {
    const errors: string[] = [];
    if (!content || !Array.isArray(content.sections) || content.sections.length === 0) {
      errors.push("Gegenereerde content bevat geen sections — generatie mislukt.");
      return errors;
    }
    const seen = new Set<string>();
    for (const section of content.sections) {
      if (!VALID_SECTION_TYPES.has(section.type)) {
        errors.push(`Ongeldige component "${String(section.type)}" in gegenereerde content — alleen vooraf gecontroleerde componenten zijn toegestaan.`);
        continue;
      }
      if (seen.has(section.type)) {
        errors.push(`Component "${section.type}" komt dubbel voor in de gegenereerde content.`);
      }
      seen.add(section.type);
      if (!section.data || typeof section.data !== "object") {
        errors.push(`Component "${section.type}" heeft geen geldige data.`);
      }
    }
    for (const required of ["header", "hero", "contact", "footer"] as const) {
      if (!seen.has(required)) {
        errors.push(`Vereiste component "${required}" ontbreekt in de gegenereerde website.`);
      }
    }
    return errors;
  }
}
