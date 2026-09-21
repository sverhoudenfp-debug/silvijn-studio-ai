import { z } from "zod";

/**
 * VISUAL CONTRACT (Design Token Engine D1, 2026-09-21) — het
 * machine-uitvoerbare ontwerpcontract binnen het Design Plan.
 *
 * ARCHITECTUUR: tot D1 was vrijwel alle visuele ontwerpintentie in het
 * Design Plan PROZA (typografie.pairing als vrije tekst, spacing.density
 * als vrije tekst) dat via keyword-mapping naar een handvol discrete
 * waarden werd gecomprimeerd. Het visualContract is hetzelfde patroon als
 * het Website Blueprint v2: de AI kiest uitsluitend uit een GESLOTEN,
 * enum-gevalideerde catalogus; de rendering wordt deterministisch uitgevoerd
 * en blijft Shopify-geldig. De AI schrijft nooit CSS of Liquid.
 *
 * HARD REGELS:
 * - Alle velden zijn enums uit dít bestand — de enige bron van waarheid.
 * - GEEN bedrijfsfeiten: een visualContract is ontwerprichting (stijlkeuze),
 *   geen claim; het fabricatie-net en de prijsintegriteit worden niet
 *   geraakt.
 * - BACKWARD COMPATIBLE: het veld is optioneel op het Design Plan. Plannen
 *   zonder visualContract gedragen zich exact als voorheen (systeem-fonts,
 *   bestaande keyword-mapping, geen paletcorrecties).
 * - Concreet fontbestand ≠ contractwaarde: de semantische keys
 *   (fontPairing) zijn stabiel; de onderliggende OFL-gelicentieerde fonts
 *   zijn implementatiedetail van de font-library.
 */

/** Semantische font-pairings (waarde voor de AI + merchant-setting). */
export const FONT_PAIRING_KEYS = [
  "modern_sans",
  "geometric_sans",
  "editorial_serif",
  "classic_serif",
  "humanist_sans",
  "mono_technical",
] as const;
export type FontPairingKey = (typeof FONT_PAIRING_KEYS)[number];

/** Systeemfallbacks voor de merchant-setting (backward compat D0-plannen). */
export const SYSTEM_FONT_KEYS = ["system_sans", "system_serif"] as const;
export type SystemFontKey = (typeof SYSTEM_FONT_KEYS)[number];
export type FontPairingSettingValue = FontPairingKey | SystemFontKey;

/** Palet-stemmingen voor de afgeleide neutrale tinten. */
export const PALETTE_MOOD_KEYS = [
  "warm_organic",
  "cool_professional",
  "premium_dark",
  "fresh_light",
  "earthy_natural",
  "bold_contrast",
  "monochrome",
] as const;
export type PaletteMood = (typeof PALETTE_MOOD_KEYS)[number];
export type PaletteMoodSettingValue = PaletteMood | "neutral_default";

/** Typografische curves (modulaire kopgrootte, settings-range 90-130, stap 5). */
export const TYPOGRAPHIC_CURVE_KEYS = ["compact", "balanced", "expressive", "dramatic"] as const;
export type TypographicCurve = (typeof TYPOGRAPHIC_CURVE_KEYS)[number];
export const TYPOGRAPHIC_CURVE_SCALE: Readonly<Record<TypographicCurve, number>> = {
  compact: 95,
  balanced: 100,
  expressive: 110,
  dramatic: 120,
};

/** Visuele dichtheid (sluit aan op de bestaande section_spacing-setting). */
export const VISUAL_DENSITY_KEYS = ["compact", "normal", "spacious"] as const;
export type VisualDensity = (typeof VISUAL_DENSITY_KEYS)[number];

/** Motion-niveau — vastgelegd in het contract, geconsumeerd in designfase D5. */
export const MOTION_LEVEL_KEYS = ["none", "subtle", "expressive"] as const;
export type MotionLevel = (typeof MOTION_LEVEL_KEYS)[number];

/** Merchant-zichtbare labels (Shopify-schema: max 50 tekens per optielabel). */
export const FONT_PAIRING_OPTION_LABELS: Readonly<Record<FontPairingSettingValue, string>> = {
  system_sans: "Systeem: sans-serif",
  system_serif: "Systeem: serif",
  modern_sans: "Modern sans (Inter)",
  geometric_sans: "Geometrisch sans (Poppins)",
  editorial_serif: "Editorial serif (Fraunces)",
  classic_serif: "Klassiek serif (Lora)",
  humanist_sans: "Humanistisch sans (Nunito Sans)",
  mono_technical: "Technisch (Space Grotesk)",
};

export const PALETTE_MOOD_OPTION_LABELS: Readonly<Record<PaletteMoodSettingValue, string>> = {
  neutral_default: "Neutraal (standaard)",
  warm_organic: "Warm & organisch",
  cool_professional: "Koel & zakelijk",
  premium_dark: "Premium & verdiept",
  fresh_light: "Fris & licht",
  earthy_natural: "Aards & natuurlijk",
  bold_contrast: "Contrastrijk",
  monochrome: "Monochroom",
};

/**
 * Het visualContract-schema. Alle velden verplicht BINNEN het object
 * (enum-gesloten); het object zelf is nullable/optional op het Design Plan
 * zodat plannen zonder contract exact geldig blijven.
 */
export const visualContractSchema = z.object({
  fontPairing: z.enum(FONT_PAIRING_KEYS),
  paletteMood: z.enum(PALETTE_MOOD_KEYS),
  typographicCurve: z.enum(TYPOGRAPHIC_CURVE_KEYS),
  density: z.enum(VISUAL_DENSITY_KEYS),
  motionLevel: z.enum(MOTION_LEVEL_KEYS),
});

export type VisualContract = z.infer<typeof visualContractSchema>;

/** Mens-leesbaar NL-beschrijving per enum-waarde (AI-prompt + documentatie). */
export const VISUAL_CONTRACT_ENUM_OPTIONS: Readonly<
  Record<keyof VisualContract, ReadonlyArray<string>>
> = {
  fontPairing: FONT_PAIRING_KEYS,
  paletteMood: PALETTE_MOOD_KEYS,
  typographicCurve: TYPOGRAPHIC_CURVE_KEYS,
  density: VISUAL_DENSITY_KEYS,
  motionLevel: MOTION_LEVEL_KEYS,
};

export function isWebFontPairing(value: FontPairingSettingValue): value is FontPairingKey {
  return (FONT_PAIRING_KEYS as readonly string[]).includes(value);
}
