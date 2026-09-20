/**
 * C1 — Content richness (Questionnaire Intelligence, 2026-09-20).
 *
 * Puur, deterministisch beleid voor de questionnaire-completion: een
 * questionnaire is pas "sufficient" als de AI de zeven content-dimensies
 * betrouwbaar heeft herleid uit echte antwoorden/context. De AI Adviseert
 * (contentDimensions); deze module dwingt af.
 *
 * Ontbrekende informatie mag NOOIT met verzonnen feiten worden gevuld:
 * - niet-declinabele dimensies (aanbod, USP's, doelgroep, tone of voice)
 *   vereisen échte, herleide inhoud;
 * - declinabele dimensies (bewijs, huisstijl/branding, media) mogen
 *   expliciet worden afgezegd met het NIET_BESCHIKBAAR-prefix, gevolgd
 *   door de bevestiging van de klant.
 */

/** Expliciete bevestiging dat declinabele informatie ontbreekt. */
export const NOT_AVAILABLE_PREFIX = "NIET_BESCHIKBAAR";

export interface ContentDimensionDefinition {
  key: ContentDimensionKey;
  label: string;
  /** true = de klant mag expliciet bevestigen dat het ontbreekt. */
  declinable: boolean;
}

export type ContentDimensionKey =
  | "offering"
  | "usps"
  | "proof"
  | "audience"
  | "toneOfVoice"
  | "branding"
  | "media";

export const CONTENT_DIMENSIONS: readonly ContentDimensionDefinition[] = [
  { key: "offering", label: "concreet aanbod (diensten/producten)", declinable: false },
  { key: "usps", label: "echte USP's/differentiators (minimaal 2-3)", declinable: false },
  { key: "proof", label: "betrouwbaar bewijs, of expliciete bevestiging dat dit ontbreekt", declinable: true },
  { key: "audience", label: "basisinformatie over de doelgroep", declinable: false },
  { key: "toneOfVoice", label: "gewenste tone of voice", declinable: false },
  { key: "branding", label: "huisstijl/kleuren, of expliciete toestemming dit te bepalen", declinable: true },
  { key: "media", label: "beschikbare foto's/media, of expliciete bevestiging dat die ontbreken", declinable: true },
];

export interface ContentRichnessAssessment {
  /** true = alle dimensies zijn betrouwbaar herleid (of eerlijk afgezegd). */
  complete: boolean;
  /** Leesbare omschrijvingen van de dimensies die nog ontbreken. */
  missing: string[];
  /** Machineleesbare keys van de dimensies die nog ontbreken. */
  missingKeys: ContentDimensionKey[];
}

/**
 * Beoordeelt de door de AI herleide content-dimensies. Leeg/afwezig =
onvoldoende; het NIET_BESCHIKBAAR-prefix is ALLEEN geldig voor
 * declinabele dimensies — op niet-declinabele dimensies is het een
 * terechte afkeuring (dan ontbreekt er échte informatie).
 */
export function assessContentRichness(
  dimensions: Partial<Record<ContentDimensionKey, string>> | null | undefined
): ContentRichnessAssessment {
  const missing: string[] = [];
  const missingKeys: ContentDimensionKey[] = [];
  for (const definition of CONTENT_DIMENSIONS) {
    const raw = (dimensions?.[definition.key] ?? "").trim();
    if (raw.length === 0) {
      missing.push(definition.label);
      missingKeys.push(definition.key);
      continue;
    }
    const declined = raw.toUpperCase().startsWith(NOT_AVAILABLE_PREFIX);
    if (declined && !definition.declinable) {
      missing.push(`${definition.label} — expliciet afgezegd, maar deze informatie is vereist`);
      missingKeys.push(definition.key);
    }
  }
  return { complete: missing.length === 0, missing, missingKeys };
}
