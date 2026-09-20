import {
  BLUEPRINT_SECTION_REGISTRY,
  BLUEPRINT_SECTION_TYPES,
  type BlueprintSectionType,
} from "../blueprint/section-registry";

/**
 * CONTENT SLOT REGISTRY (C3a, 2026-09-20) — per sectietype de benodigde
 * content-eenheden voor de ContentPass, afgeleid uit de bestaande
 * SECTION-REGISTRY (de enige bron van waarheid voor sectiestructuur).
 *
 * ARCHITECTUUR: één centrale slot-catalogus die de latere ContentPlan-pass
 * (C3b+) vertelt WELKE content per blueprint-sectie-instantie nodig is en
 * WELKE veiligheidsklasse elke eenheid heeft:
 * - factLocked  — bedrijfsfeit: mag ALLÉÉN verbatim uit een bron komen
 *                 (deterministisch overgenomen of exact bewijs); de AI mag
 *                 dit NOOIT herformuleren. Denk aan dienstnamen, tarieven,
 *                 cijfers, quotes, teamnamen, contactgegevens.
 * - copy       — commerciële copy die professioneel geformuleerd MAG worden
 *                 (headlines, lopende tekst), mits gedragen door evidence
 *                 en zonder NIEUWE feiten (afgedwongen in de policy-pass,
 *                 C3c). De copywriting-vlag van de requirements bepaalt of
 *                 dit generated of customer_slot wordt.
 *
 * HARD REGELS (zelfde geest als de SECTION-REGISTRY zelf):
 * - GESLOTEN catalogus: de ContentPlan-pass kiest uitsluitend uit deze
 *   kinds; elke afwijking faalt de Zod-validatie van het ContentPlan.
 * - De slotdefinities spiegelen wat blueprint-composition vandaag daadwerkelijk
 *   leest (heading/subheading/items/bloksettings) zodat de latere consumptie
 *   (C3d) één-op-één kan doorvertalen.
 * - evidence_only-secties (usp_band/stats/testimonials/team/projects/rates)
 *   dragen uitsluitend factLocked slots: zonder echte data bestaat de
 *   instantie niet (afgedwongen door de blueprint-consistency), dus content
 *   daarop kan ook nooit verzonnen zijn.
 * - Deze module raakt GEEN bestaande flows: puur additief, geen imports
 *   uit server-only code, volledig unit-testbaar.
 */

// ---------------------------------------------------------------------------
// Gesloten catalogus van content-unit-kinds
// ---------------------------------------------------------------------------

export const CONTENT_UNIT_KINDS = [
  // Algemene tekststructuren
  "headline",
  "subheadline",
  "heading",
  "subheading",
  "body",
  // Item-structuren (blokgedreven secties)
  "item_title",
  "item_body",
  "item_label",
  "item_hint",
  "item_text",
  "step_title",
  "step_body",
  "faq_question",
  "faq_answer",
  // Fact-locked waarde-eenheden
  "quote",
  "quote_author",
  "member_name",
  "member_role",
  "stat_label",
  "stat_value",
  "rate_value",
  // Conversie
  "cta_label",
  "cta_secondary_label",
  // Media
  "alt_text",
  "caption",
  // UI/microcopy (geen commerciële copy: formulierlabels, knopteksten)
  "microcopy",
  // Pagina-niveau (SEO)
  "seo_title",
  "seo_description",
] as const;

export type ContentUnitKind = (typeof CONTENT_UNIT_KINDS)[number];

const CONTENT_UNIT_KIND_SET: ReadonlySet<string> = new Set(CONTENT_UNIT_KINDS);

// ---------------------------------------------------------------------------
// Slotdefinities
// ---------------------------------------------------------------------------

export interface ContentSlotDefinition {
  /** Machine-key — moet in CONTENT_UNIT_KINDS bestaan (conformance-test). */
  kind: ContentUnitKind;
  /** Nederlands label (mens-leesbaar, voor UI en logs). */
  label: string;
  /** Korte NL-omschrijving van wat dit slot inhoudt (voor het C3b-contract). */
  description: string;
  /** true = minstens één unit van dit kind verplicht per sectie-instantie. */
  required: boolean;
  /** true = bedrijfsfeit: alleen verbatim uit bron, nooit AI-geformuleerd. */
  factLocked: boolean;
}

function slot(
  kind: ContentUnitKind,
  label: string,
  description: string,
  required: boolean,
  factLocked: boolean
): ContentSlotDefinition {
  return { kind, label, description, required, factLocked };
}

// ---------------------------------------------------------------------------
// Per sectietype de benodigde content-slots (gesloten, conform registry)
// ---------------------------------------------------------------------------

export const CONTENT_SLOT_REGISTRY: Record<BlueprintSectionType, readonly ContentSlotDefinition[]> = {
  hero: [
    slot("headline", "Hero-kop", "Primaire boodschap bovenaan de pagina.", true, false),
    slot("subheadline", "Hero-subkop", "Ondersteunende zin onder de hero-kop.", false, false),
    slot("cta_label", "Hero-CTA-label", "Label van de primaire call-to-action.", true, false),
    slot("cta_secondary_label", "Secundaire CTA-label", "Optioneel label van een tweede call-to-action.", false, false),
  ],
  usp_band: [
    slot("item_label", "USP-label", "Kort verkoopargument — uitsluitend uit echte trustElements.", true, true),
    slot("item_hint", "USP-toelichting", "Optionele korte toelichting bij een USP — uit echte input.", false, true),
  ],
  stats: [
    slot("stat_label", "Statistiek-label", "Wat het cijfer beschrijft — alleen echte data.", true, true),
    slot("stat_value", "Statistiek-waarde", "Het cijfer zelf — alleen echte data.", true, true),
  ],
  services: [
    slot("item_title", "Dienstitel", "Naam van één dienst uit het echte aanbod — nooit verzinnen.", true, true),
    slot("item_body", "Dienstomschrijving", "Korte omschrijving van de dienst, gedragen door echte input.", false, false),
  ],
  about: [
    slot("heading", "Over-ons-kop", "Kop boven de over-ons-sectie.", false, false),
    slot("body", "Over-ons-tekst", "Verhaaltekst over het bedrijf.", true, false),
    slot("alt_text", "Beeld-alt", "Alt-tekst bij het beeld in de sectie.", false, false),
  ],
  process: [
    slot("step_title", "Staptitel", "Korte titel van één werkwijzestap — uit echte input.", true, false),
    slot("step_body", "Stapomschrijving", "Toelichting bij de stap — geen verzonnen werkwijze-claims.", false, false),
  ],
  gallery: [
    slot("caption", "Beeldbijschrift", "Optionele bijschrift bij een beeldslot.", false, false),
    slot("alt_text", "Beeld-alt", "Alt-tekst bij een beeldslot (toegankelijkheid).", false, false),
  ],
  projects: [
    slot("item_title", "Projecttitel", "Naam van één echt project/case — nooit verzinnen.", true, true),
    slot("item_body", "Projectomschrijving", "Korte omschrijving van het echte project.", false, false),
  ],
  testimonials: [
    slot("quote", "Klantuitspraak", "Verbatim klantquote — nooit herschreven of verzonnen.", true, true),
    slot("quote_author", "Quote-auteur", "Naam/auteur van de uitspraak — alleen als echt bekend.", false, true),
  ],
  team: [
    slot("member_name", "Teamlidnaam", "Echte naam van een medewerker — nooit verzinnen.", true, true),
    slot("member_role", "Teamlidrol", "Echte rol/functie van de medewerker.", true, true),
  ],
  benefits: [
    slot("item_text", "Voordeelzin", "Eén voordeel geformuleerd voor de bezoeker — uit echte input.", true, false),
  ],
  faq: [
    slot("faq_question", "FAQ-vraag", "Eén terugkerende klantvraag — uit echte input.", true, false),
    slot("faq_answer", "FAQ-antwoord", "Antwoord op de vraag — claimt nooit nieuwe feiten.", true, false),
  ],
  rates: [
    slot("item_title", "Tariefitem-dienst", "Dienst bij het tarief — uit het echte aanbod.", true, true),
    slot("rate_value", "Tariefwaarde", "Het tarief zelf — alleen als echt bekend, nooit verzonnen.", true, true),
  ],
  newsletter: [
    slot("heading", "Nieuwsbrief-kop", "Kop boven de nieuwsbrief-sectie.", true, false),
    slot("body", "Nieuwsbrief-tekst", "Korte toelichting op de nieuwsbrief.", false, false),
    slot("cta_label", "Nieuwsbrief-CTA-label", "Label van de aanmeldknop.", true, false),
  ],
  booking: [
    slot("heading", "Boekingskop", "Kop boven de boekingssectie.", true, false),
    slot("subheading", "Boekings-subkop", "Optionele subtitel bij de boekingssectie.", false, false),
    slot("cta_label", "Boekings-CTA-label", "Label van de boekknop.", true, false),
  ],
  cta: [
    slot("cta_label", "CTA-label", "Label van de call-to-action — uit het echte conversiedoel.", true, false),
    slot("cta_secondary_label", "Secundaire CTA-label", "Optioneel tweede label.", false, false),
    slot("body", "CTA-tekst", "Korte ondersteunende tekst bij de CTA.", false, false),
  ],
  contact: [
    slot("heading", "Contactkop", "Kop boven de contactsectie.", true, false),
    slot("subheading", "Contact-subkop", "Korte intro boven het contactformulier.", false, false),
    slot("cta_label", "Contact-CTA-label", "Label van de verzendknop.", true, false),
    slot("microcopy", "Microcopy", "Formulierlabels en korte UI-teksten (geen commerciële copy).", false, false),
  ],
  rich_text: [
    slot("heading", "Tekstblok-kop", "Optionele kop boven het tekstblok.", false, false),
    slot("body", "Tekstblok-inhoud", "Lopende tekst van het tekstblok.", true, false),
  ],
};

/** Pagina-niveau slots (SEO) — geen sectie-instantie maar het page-object. */
export const CONTENT_PAGE_SLOT_DEFINITIONS: readonly ContentSlotDefinition[] = [
  slot("seo_title", "SEO-titel", "Paginatitel voor zoekmachines — gebaseerd op bekende feiten.", true, false),
  slot("seo_description", "SEO-meta-omschrijving", "Meta-description van de pagina — geen verzonnen commerciële claims.", true, false),
];

// ---------------------------------------------------------------------------
// Helpers (deterministisch, puur)
// ---------------------------------------------------------------------------

function requireSlots(type: BlueprintSectionType): readonly ContentSlotDefinition[] {
  const slots = CONTENT_SLOT_REGISTRY[type];
  if (!slots) throw new Error(`Onbekend sectietype "${type}" in de CONTENT_SLOT_REGISTRY — de catalogus is gesloten.`);
  return slots;
}

/** Slots voor één sectietype (fail-loud bij onbekende types, zoals de registry). */
export function contentSlotsForSection(type: BlueprintSectionType): readonly ContentSlotDefinition[] {
  return requireSlots(type);
}

/** Verplichte slotkinds voor één sectietype. */
export function requiredSlotKinds(type: BlueprintSectionType): readonly ContentUnitKind[] {
  return requireSlots(type).filter((s) => s.required).map((s) => s.kind);
}

/** factLocked-slotkinds voor één sectietype (bedrijfsfeiten: verbatim-only). */
export function factLockedSlotKinds(type: BlueprintSectionType): readonly ContentUnitKind[] {
  return requireSlots(type).filter((s) => s.factLocked).map((s) => s.kind);
}

/** True als dit sectietype evidence_only is volgens de SECTION-REGISTRY. */
export function isEvidenceOnlySection(type: BlueprintSectionType): boolean {
  return BLUEPRINT_SECTION_REGISTRY[type].planningTarget.tier === "evidence_only";
}

/**
 * Structurele conformance van de slot-catalogus zelf. Wordt aangeroepen door
 * de ContentPlan-consistency én door tests: de catalogus mag nooit stil
 * divergeren van de SECTION-REGISTRY.
 */
export function validateContentSlotRegistryConformance(): { passed: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const type of BLUEPRINT_SECTION_TYPES) {
    const slots = CONTENT_SLOT_REGISTRY[type];
    if (!slots || slots.length === 0) {
      errors.push(`Sectietype "${type}" heeft geen content-slotdefinities in CONTENT_SLOT_REGISTRY.`);
      continue;
    }
    const seen = new Set<string>();
    for (const s of slots) {
      if (!CONTENT_UNIT_KIND_SET.has(s.kind)) {
        errors.push(`Onbekend content-unit-kind "${s.kind}" bij sectietype "${type}".`);
      }
      if (seen.has(s.kind)) {
        errors.push(`Dubbel slot-kind "${s.kind}" bij sectietype "${type}".`);
      }
      seen.add(s.kind);
    }
    // evidence_only-secties bestaan alleen met echte data, dus hun FEITELijke
    // kern moet factLocked zijn (titels, namen, cijfers, quotes). Aanvullende
    // toelichtingsslots (bijv. projects.item_body) mogen evidence-gedragen
    // copy zijn — de instantie zelf kan niet zonder echte data bestaan.
    if (isEvidenceOnlySection(type)) {
      const locked = slots.filter((s) => s.factLocked);
      if (locked.length === 0) {
        errors.push(
          `Evidence_only-sectietype "${type}" heeft géén factLocked slots — de feitelijke kern moet verbatim zijn.`
        );
      }
    }
  }
  for (const s of CONTENT_PAGE_SLOT_DEFINITIONS) {
    if (!CONTENT_UNIT_KIND_SET.has(s.kind)) {
      errors.push(`Onbekend content-unit-kind "${s.kind}" in de paginaslot-definities.`);
    }
  }
  return { passed: errors.length === 0, errors };
}
