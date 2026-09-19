import type { DesignPlan } from "./design-plan";
import type { WebsiteSpecification } from "./types";

/**
 * Design Plan → Website Generation-koppeling (fix 2026-09-19).
 *
 * Tot nu toe was het Design Plan (Fase I.1) uitsluitend intern: de enige
 * consument was de theme-ZIP-builder (kleuren/typografie/navigatie/
 * paginastructuur). De websitegeneratie kreeg het plan NOOIT te zien, dus
 * kon het plan expliciet een contactformulier plannen terwijl de AI
 * specificatie conversion.leadCapture=false zette — het React-preview
 * toonde dan géén formulier (het af te leveren theme-ZIP had er wél één,
 * want show_form staat daar deterministisch aan).
 *
 * Deze module bevat de PUURE, deterministische brug:
 * - summarizeDesignPlanForGeneration: compacte, feitelijke samenvatting
 *   voor de AI-planning-input (aanvullende bron, niets verzonnen);
 * - applyDesignPlanToSpecification: NÁ de AI-call wordt expliciet geplande
 *   functionaliteit deterministisch afgedwongen. De AI-uitkomst kan hier
 *   alleen VERZWAARD worden (aan), nooit afgezwakt of gevuld met
 *   verzonnen data.
 *
 * Hard regels:
 * - Nooit informatie verzinnen: een geplande functie zonder echte gegevens
 *   (bijv. socialmedia-URL's) wordt NIET naar de specificatie geschreven,
 *   maar expliciet in missingInformation gemeld.
 * - Bestaande deterministische/veiligheidschecks blijven ongewijzigd; deze
 *   module raakt geen gates, geen ZIP-builder en geen rendering.
 */

/** Normaliseert een plan-key: lowercase, zonder scheidingstekens. */
export function normalizeDesignPlanKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s\-_.]+/g, "");
}

/** True als de genormaliseerde key op een contactformulier duidt. */
function isContactFormKey(normalized: string): boolean {
  return (
    normalized.includes("contactform") ||
    (normalized.includes("contact") && normalized.includes("form"))
  );
}

/** True als de genormaliseerde key op socialmediaknoppen/-links duidt. */
function isSocialMediaKey(normalized: string): boolean {
  return normalized.includes("social");
}

/**
 * Het Design Plan vereist expliciet een contactformulier als:
 * - een gepland component erop duidt (components[].key),
 * - een geplande functionaliteitsfeature erop duidt (functionality.features[].key),
 * - of de CTA-strategie leadCapture expliciet aanzet (ctaStrategy.leadCapture === true).
 */
export function designPlanRequiresContactForm(plan: DesignPlan): boolean {
  if (plan.components.some((c) => isContactFormKey(normalizeDesignPlanKey(c.key)))) return true;
  if (plan.functionality.features.some((f) => isContactFormKey(normalizeDesignPlanKey(f.key)))) return true;
  return plan.ctaStrategy.leadCapture === true;
}

/**
 * Socialmediaknoppen/-links staan als geplande functionaliteit in het plan
 * (component- of feature-key).NB: de WebsiteSpecification kent géén veld voor
 * socialmedia-URL's en echte URL's zijn vrijwel nooit beschikbaar — deze
 * functie signaleert de planning alleen; applyDesignPlanToSpecification
 * schrijft hem eerlijk naar missingInformation i.p.v. data te verzinnen.
 */
export function designPlanPlansSocialLinks(plan: DesignPlan): boolean {
  if (plan.components.some((c) => isSocialMediaKey(normalizeDesignPlanKey(c.key)))) return true;
  return plan.functionality.features.some((f) => isSocialMediaKey(normalizeDesignPlanKey(f.key)));
}

/**
 * Compacte, feitelijke samenvatting van het plan voor de AI-input. Bevat
 * uitsluitend wat in het plan staat: geplande componenten (key + purpose),
 * geplande functionaliteit (key + description) en de leadCapture-instelling
 * van de CTA-strategie. Geen interpretatie, geen toevoegingen.
 */
export function summarizeDesignPlanForGeneration(plan: DesignPlan): string {
  const components = plan.components
    .map((c) => `${c.key} (${c.purpose})`)
    .join("; ");
  const features = plan.functionality.features
    .map((f) => `${f.key}: ${f.description} [bron: ${f.source}]`)
    .join("; ");
  const integrations = plan.functionality.integrations.join("; ");
  return [
    `Geplande componenten: ${components || "geen expliciet gepland"}`,
    `Geplande functionaliteit: ${features || "geen expliciet gepland"}`,
    integrations ? `Geplande integraties: ${integrations}` : null,
    `CTA-strategie leadCapture: ${plan.ctaStrategy.leadCapture == null ? "niet expliciet" : plan.ctaStrategy.leadCapture ? "true (lead-capture vereist)" : "false"}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export interface ApplyDesignPlanResult {
  specification: WebsiteSpecification;
  /** Toegepaste plan-afdwongen wijzigingen (mens-leesbaar, voor generation_notes). */
  appliedNotes: string[];
  /** Geplande functionaliteit die NIET naar de specificatie kon doorwerken (eerlijk gemeld). */
  unsupportedNotes: string[];
}

/** Maximaal aantal missingInformation-items uit het AI-contract. */
const MISSING_INFORMATION_LIMIT = 12;

/**
 * Dwingt expliciet geplande Design Plan-functionaliteit deterministisch af
 * op de AI-specificatie. Verandert de specificatie uitsluitend in de richting
 * van het plan; verzint nooit data en zwakt niets af.
 */
export function applyDesignPlanToSpecification(
  specification: WebsiteSpecification,
  plan: DesignPlan | null | undefined
): ApplyDesignPlanResult {
  const appliedNotes: string[] = [];
  const unsupportedNotes: string[] = [];

  if (!plan) {
    return { specification, appliedNotes, unsupportedNotes };
  }

  // 1. Contactformulier: gepland in het plan → leadCapture MOET aan.
  //    (Detour via AI-instructies is onvoldoende: de AI kan het missen —
  //    productiebug 2026-09-19. Dit is de harde, deterministische waarborg.)
  if (designPlanRequiresContactForm(plan) && specification.conversion.leadCapture !== true) {
    specification.conversion.leadCapture = true;
    appliedNotes.push(
      "Design Plan plant expliciet een contactformulier → conversion.leadCapture aangezet in de specificatie."
    );
  }

  // 2. Socialmediaknoppen: géén specificatieveld + vrijwel nooit echte URL's.
  //    Eerlijk melden i.p.v. verzinnen. De AI kan dit via de plan-samenvatting
  //    al in missingInformation hebben gezet — niet dupliceren.
  if (designPlanPlansSocialLinks(plan)) {
    const alreadyNoted = specification.missingInformation.some((item) =>
      item.toLowerCase().includes("socialmedia")
    );
    if (!alreadyNoted) {
      if (specification.missingInformation.length < MISSING_INFORMATION_LIMIT) {
        specification.missingInformation.push(
          "Socialmediaknoppen staan als geplande functionaliteit in het Design Plan, maar er zijn geen echte socialmedia-URL's beschikbaar."
        );
      }
      unsupportedNotes.push(
        "Design Plan plant socialmediaknoppen, maar er zijn geen echte URL's: eerlijk als ontbrekende informatie gemeld i.p.v. verzonnen links."
      );
    }
  }

  return { specification, appliedNotes, unsupportedNotes };
}
