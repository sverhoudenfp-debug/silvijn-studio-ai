import { z } from "zod";
import type { BlueprintArchetype } from "./blueprint/archetypes";

/**
 * ART DIRECTION CONTRACT (D2, 2026-09-21) — de niche-specifieke visuele
 * kunstketen BÓVEN op het D1 visualContract.
 *
 * ARCHITECTUUR: D1 maakte de ontwerpTOKENS machine-uitvoerbaar (fonts,
 * palet, typografiecurve, dichtheid). D2 voegt daaraan de COMPOSITIEMATIGE
 * kunstketen toe: het visuele concept, merkpersoonlijkheid, headerstijl,
 * hero-behandeling, kaart-behandeling, beeldgebruik, decoratie,
 * sectie-overgangen en motion-personality. Zoals altijd in deze codebase:
 * de AI kiest uitsluitend uit een GESLOTEN, enum-gevalideerde catalogus;
 * de rendering is deterministisch, Shopify-geldig, en de AI schrijft nooit
 * CSS of Liquid.
 *
 * ANTI-TEMPLATE: dit contract is de belangrijkste anti-template-hefboom:
 * een restaurant, architect, aannemer, kapsalon en advocatenkantoor krijgen
 * niet alleen andere kleuren, maar een WEZENLIJK andere visuele compositie
 * (headeropbouw, hero-behandeling, kaartstijl, beeldverhouding, decoratie,
 * overgangen, motion). De AI wordt per branche geacht bewust te differentiëren.
 *
 * HARD REGELS:
 * - Alle enum-velden komen uit dít bestand — de enige bron van waarheid.
 * - `concept` is een korte NL-ontwerpkeuze-motivering (STIJLKEUZE), geen
 *   bedrijfsfeit: geen claims, prijzen, reviews of andere verifieerbare
 *   feiten — het fabricatie-net wordt niet geruimd.
 * - BACKWARD COMPATIBLE: het veld is optioneel op het Design Plan. Plannen
 *   zonder artDirection (alle plannen vóór D2) gedragen zich exact als
 *   voorheen: geen composition-setting, geen art-direction.css, geen
 *   header-variantdefaults uit het plan.
 */

/** Compositietype — de fundamentele visuele opbouw van de hele website. */
export const ART_COMPOSITION_KEYS = [
  "editorial",
  "asymmetric",
  "minimal",
  "immersive",
  "structured",
  "playful",
] as const;
export type ArtComposition = (typeof ART_COMPOSITION_KEYS)[number];

/** Merkpersoonlijkheid — sfeer en karakter die alle details doordrenken. */
export const ART_PERSONALITY_KEYS = [
  "premium_refined",
  "warm_friendly",
  "bold_confident",
  "calm_professional",
  "creative_playful",
  "technical_precise",
] as const;
export type ArtPersonality = (typeof ART_PERSONALITY_KEYS)[number];

/** Headerstijl — verplichte core component, meerdere echte layoutvarianten. */
export const ART_HEADER_STYLE_KEYS = ["minimal", "centered", "split", "overlay"] as const;
export type ArtHeaderStyle = (typeof ART_HEADER_STYLE_KEYS)[number];

/** Hero-behandeling — sluit aan op de SECTION-REGISTRY hero-layouts. */
export const ART_HERO_TREATMENT_KEYS = ["focused", "centered", "split", "immersive"] as const;
export type ArtHeroTreatment = (typeof ART_HERO_TREATMENT_KEYS)[number];

/** Kaart-behandeling voor card/grids (diensten, USP's, voordelen, team...). */
export const ART_CARD_TREATMENT_KEYS = ["bordered", "shadow", "flat", "accent_top"] as const;
export type ArtCardTreatment = (typeof ART_CARD_TREATMENT_KEYS)[number];

/** Beeld-tel-tekstverhouding over de hele website. */
export const ART_IMAGERY_BALANCE_KEYS = ["image_forward", "balanced", "text_forward"] as const;
export type ArtImageryBalance = (typeof ART_IMAGERY_BALANCE_KEYS)[number];

/** Beeldstijl — hoe afbeeldingen kaderen en behandeld worden. */
export const ART_IMAGE_STYLE_KEYS = ["framed", "full_bleed", "tinted_overlay"] as const;
export type ArtImageStyle = (typeof ART_IMAGE_STYLE_KEYS)[number];

/** Decoratieve elementen. */
export const ART_DECORATIVE_KEYS = ["none", "accent_bars", "soft_dividers"] as const;
export type ArtDecorative = (typeof ART_DECORATIVE_KEYS)[number];

/** Sectie-overgangsstijl. */
export const ART_TRANSITION_KEYS = ["hard_cut", "surface_alternate", "gradient_blend"] as const;
export type ArtTransition = (typeof ART_TRANSITION_KEYS)[number];

/**
 * Motion-personality — vertaalt de per-instantie blueprint-motion
 * (fade_up/stagger) naar de karakteristieke animatiestijl. `visualContract.
 * motionLevel` blijft de intensiteitsvloer (none = géén animaties).
 */
export const ART_MOTION_STYLE_KEYS = ["fade", "rise", "scale"] as const;
export type ArtMotionStyle = (typeof ART_MOTION_STYLE_KEYS)[number];

/** Merchant-zichtbare labels (Shopify-schema: max 50 tekens per optielabel). */
export const ART_COMPOSITION_OPTION_LABELS: Readonly<Record<ArtComposition, string>> = {
  editorial: "Editoriaal (tijdschriftachtig)",
  asymmetric: "Asymmetrisch",
  minimal: "Minimalistisch",
  immersive: "Immersief (beleving)",
  structured: "Gestructureerd (zakelijk)",
  playful: "Speels",
};

/**
 * Het artDirection-schema. Alle enum-velden zijn verplicht BINNEN het object;
 * het object zelf is nullable/optional op het Design Plan (backward compat).
 */
export const artDirectionSchema = z.object({
  /** Korte ontwerpkeuze-motivering (stijlkeuze; géén bedrijfsfeiten). */
  concept: z.string().min(10).max(300),
  composition: z.enum(ART_COMPOSITION_KEYS),
  brandPersonality: z.enum(ART_PERSONALITY_KEYS),
  headerStyle: z.enum(ART_HEADER_STYLE_KEYS),
  heroTreatment: z.enum(ART_HERO_TREATMENT_KEYS),
  cardTreatment: z.enum(ART_CARD_TREATMENT_KEYS),
  imageryBalance: z.enum(ART_IMAGERY_BALANCE_KEYS),
  imageStyle: z.enum(ART_IMAGE_STYLE_KEYS),
  decorativeStyle: z.enum(ART_DECORATIVE_KEYS),
  sectionTransition: z.enum(ART_TRANSITION_KEYS),
  motionStyle: z.enum(ART_MOTION_STYLE_KEYS),
});

export type ArtDirection = z.infer<typeof artDirectionSchema>;

/** Enum-opties per veld (AI-prompt + tests). */
export const ART_DIRECTION_ENUM_OPTIONS: Readonly<
  Record<keyof Omit<ArtDirection, "concept">, ReadonlyArray<string>>
> = {
  composition: ART_COMPOSITION_KEYS,
  brandPersonality: ART_PERSONALITY_KEYS,
  headerStyle: ART_HEADER_STYLE_KEYS,
  heroTreatment: ART_HERO_TREATMENT_KEYS,
  cardTreatment: ART_CARD_TREATMENT_KEYS,
  imageryBalance: ART_IMAGERY_BALANCE_KEYS,
  imageStyle: ART_IMAGE_STYLE_KEYS,
  decorativeStyle: ART_DECORATIVE_KEYS,
  sectionTransition: ART_TRANSITION_KEYS,
  motionStyle: ART_MOTION_STYLE_KEYS,
};

/**
 * DETERMINISTISCHE BRANCHE-INSPIRATIE (anti-template). De AI kiest
 * uiteindelijk zelf uit de enums op basis van de echte input; deze tabel
 * geeft per blueprint-archetype de branchegerichte afweging mee zodat
 * gelijksoortige branches niet onbedoeld dezelfde compositie krijgen.
 * Noodzakelijk veilig: dit zijn stijlrichtingen, géén bedrijfsfeiten.
 */
export const ARCHETYPE_ART_HINTS: Readonly<
  Record<BlueprintArchetype, { composition: ArtComposition; alternatives: readonly ArtComposition[] }>
> = {
  service_provider: {
    composition: "structured",
    alternatives: ["minimal", "editorial"],
  },
  creative_studio: {
    composition: "asymmetric",
    alternatives: ["editorial", "immersive"],
  },
  practice_appointment: {
    composition: "minimal",
    alternatives: ["structured", "editorial"],
  },
  retail_product: {
    composition: "playful",
    alternatives: ["immersive", "editorial"],
  },
};
