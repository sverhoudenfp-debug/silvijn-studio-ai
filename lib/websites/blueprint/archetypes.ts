/**
 * BRANCHE-ARCHETYPEN (Design Intelligence, 2026-09-19) — een kleine
 * DETERMINISTISCHE compositielaag bovenop de gesloten SECTION-REGISTRY.
 *
 * ARCHITECTUUR: archetypen geven uitsluitend COMPOSITIE- EN UX-RICHTING
 * voor de designplanning-prompt. Ze bevatten:
 * - géén copy, géén branding, géén verzonnen bedrijfsfeiten;
 * - géén nieuwe sectietypes/layouts (de registry blijft leidend);
 * - géén verplichting: de AI blijft verantwoordelijk voor de uiteindelijke
 *   compositie; de bestaande blueprint-consistencycheck blijft de harde
 *   vloer.
 *
 * Selectie is deterministisch op basis van de branche-industry-string uit
 * echte input (keyword-matching, kleine letters, NL-gericht). Herkent geen
 * enkele set → val terug op het breedste archetype (dienstverlener).
 */

import type { BlueprintSectionType } from "./section-registry";

export const BLUEPRINT_ARCHETYPES = [
  "service_provider",
  "creative_studio",
  "practice_appointment",
  "retail_product",
] as const;
export type BlueprintArchetype = (typeof BLUEPRINT_ARCHETYPES)[number];

export interface BlueprintArchetypeDefinition {
  key: BlueprintArchetype;
  /** Nederlands label (mens-leesbaar, voor UI en logs). */
  label: string;
  /** Korte NL-omschrijving van het archetype. */
  description: string;
  /** NL-branchemerken voor de deterministische herkenning (kleine letters). */
  industryKeywords: string[];
  /**
   * Positieve compositierichting voor de homepage (sectietypes uit de
   * registry, in logische volgorde). RICHTING, geen verplichting: de AI
   * kiest, laat weg wat geen echte basis heeft, en houdt de harde
   * compositie-vloer (hero eerst, minimaal één conversiesectie).
   */
  homepageFlow: BlueprintSectionType[];
  /** Conversievoorkeur die bij dit archetype past (richting). */
  conversionPreference: "form" | "call" | "booking";
  /**
   * Extra waardevolle secties voor dit archetype (richting) — altijd onder
   * de planning-target-regels van de registry (evidence_only = echte data).
   */
  strengths: BlueprintSectionType[];
}

export const BLUEPRINT_ARCHETYPE_REGISTRY: Record<BlueprintArchetype, BlueprintArchetypeDefinition> = {
  service_provider: {
    key: "service_provider",
    label: "Dienstverlener",
    description:
      "Bedrijf dat een vakmatige dienst of opdracht levert (uitvoerend of adviserend); conversie = aanvraag/offerte.",
    industryKeywords: [
      "dienst", "service", "klus", "installatie", "onderhoud", "reparatie", "schoonmaak", "tuin",
      "schilder", "loodgieter", "elektric", "dakdek", "aannemer", "bouw", "klussen",
      "advies", "adviesbureau", "consult", "bureau", "ict", "informatica", "automatisering",
      "computer", "software", "accountant", "boekhoud", "makelaar", "transport", "logistiek",
      "verhuur", "beveiliging", "verzekering", "notaris", "juris", "recycling", "afval",
      "monteur", "vloeren", "vloerleg", "stukadoor", "isolatie", "verwarming", "hvac", "airco",
      "solar", "zonnepanelen", "chauffeur", "bezorg",
    ],
    homepageFlow: ["hero", "services", "process", "benefits", "about", "faq", "cta", "contact"],
    conversionPreference: "form",
    strengths: ["process", "benefits", "faq"],
  },
  creative_studio: {
    key: "creative_studio",
    label: "Studio/creatief",
    description:
      "Creatief/vormgevend bedrijf dat werk laat spreken; conversie = portfolio-overtuiging + aanvraag.",
    industryKeywords: [
      "studio", "creatie", "creatief", "design", "vormgev", "fotograf", "fotograaf", "videograf",
      "video", "film", "reclame", "marketing", "branding", "communicatie", "architect",
      "interieur", "inricht", "grafisch", "illustra", "webdesign", "muziek", "podcast", "radio",
      "theater", "kunst", "galerie", "copywriting", "tekstschrijver",
    ],
    homepageFlow: ["hero", "projects", "services", "about", "gallery", "process", "cta", "contact"],
    conversionPreference: "form",
    strengths: ["projects", "gallery", "about"],
  },
  practice_appointment: {
    key: "practice_appointment",
    label: "Praktijk/afspraak",
    description:
      "Afspraakgebonden praktijk of salon; conversie = direct een afspraak boeken of bellen.",
    industryKeywords: [
      "praktijk", "salon", "kapper", "coiffeur", "barbier", "barber", "nagel", "nail", "beauty",
      "schoonheid", "massage", "fysio", "fysiotherapie", "tandarts", "tandheel", "arts", "medisch",
      "kliniek", "therapie", "therapeut", "coach", "begeleiding", "psycholog", "dietist", "diëtist",
      "podotherapie", "podoloog", "osteopathie", "chiropractie", "huidtherapie", "spa", "wellness",
      "yoga", "pilates", "sportschool", "fitness", "personal trainer", "dierenarts", "dierenkliniek",
    ],
    homepageFlow: ["hero", "services", "benefits", "about", "booking", "faq", "contact"],
    conversionPreference: "booking",
    strengths: ["booking", "benefits", "faq"],
  },
  retail_product: {
    key: "retail_product",
    label: "Retail/product",
    description:
      "Winkel of productgericht bedrijf; conversie = bezoek (winkel/product) of productaanvraag.",
    industryKeywords: [
      "winkel", "retail", "webshop", "webwinkel", "boutique", "boetiek", "product", "bakker", "bakkerij",
      "patisserie", "slager", "mode", "kleding", "meubel", "wooninrichting", "tuincentrum",
      "bloemen", "bloemist", "speciaalzaak", "slijter", "kaas", "delicatessen", "horeca",
      "restaurant", "cafetaria", "lunchroom", "koffie", "thee", "webwinkel", "verkoop",
    ],
    homepageFlow: ["hero", "services", "gallery", "about", "benefits", "cta", "contact"],
    conversionPreference: "call",
    strengths: ["gallery", "benefits"],
  },
};

/**
 * Deterministische archetype-selectie op basis van de branche-industry.
 * - kleine letters, trimmed;
 * - eerste treffende archetype in de vaste volgorde service_provider ->
 *   creative_studio -> practice_appointment -> retail_product
 *   (overlap tussen sets lost zo voorspelbaar op);
 * - geen enkele treffer -> service_provider (breedste fallback).
 */
export function selectBlueprintArchetype(industry: string): BlueprintArchetypeDefinition {
  const value = (industry ?? "").trim().toLowerCase();
  if (!value) return BLUEPRINT_ARCHETYPE_REGISTRY.service_provider;
  for (const key of BLUEPRINT_ARCHETYPES) {
    const def = BLUEPRINT_ARCHETYPE_REGISTRY[key];
    if (def.industryKeywords.some((kw) => value.includes(kw))) return def;
  }
  return BLUEPRINT_ARCHETYPE_REGISTRY.service_provider;
}

/**
 * Bouwt de NL-compositierichting voor de designplanning-prompt.
 * Expliciet RICHTING (geen verplichting) — de AI blijft eindverantwoordelijk
 * en de planning-targets + anti-fabricatieregels blijven onaangeroerd.
 */
export function buildArchetypeGuidance(def: BlueprintArchetypeDefinition): string[] {
  return [
    `BRANCHE-ARCHETYPE (deterministisch bepaald): ${def.key} — ${def.label}. ${def.description}`,
    `COMPOSITIERICHTING homepage (RICHTING, geen verplichting; laat weg wat geen echte basis heeft, volg de planning-targets en de harde compositie-vloer): ${def.homepageFlow.join(" -> ")}.`,
    `CONVERSIEVOORKEUR (richting): ${def.conversionPreference}. Sterk voor dit archetype (alleen met echte input): ${def.strengths.join(", ")}.`,
    "Belangrijk: dit archetype geeft uitsluitend compositie- en UX-richting — geen copy, geen branding, geen verzonnen bedrijfsfeiten. Ontbrekende content betekent NIET automatisch een waardevolle sectie weglaten: secties met plannableWithEmptySlots=true mogen als ontwerpstructuur met lege, merchant-editable slots bestaan (registreer de ontbrekende informatie in missingInformation). Evidence_only-secties (stats/testimonials/team/rates/usp_band/projects) vereisen ALTIJD echte data.",
  ];
}
