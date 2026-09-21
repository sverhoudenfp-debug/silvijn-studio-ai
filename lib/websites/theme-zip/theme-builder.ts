import type { DesignPlan } from "../design-plan";
import {
  findSlot,
  mediaSlotsFor,
  galleryBlockCount,
  hasGalleryRequirement,
  hasRealTestimonials,
  mediaPlanFor,
  slotAlt,
} from "./media-slots";
import { buildGenericPlaceholderSvg, buildMediaPlaceholderSvgs } from "./placeholders";
import { composeBlueprintTemplates, slugifyPageKey } from "./blueprint-composition";
import type { ContentPlan } from "../content/content-plan";
import { BLUEPRINT_SECTION_REGISTRY, type BlueprintSectionType } from "../blueprint/section-registry";
import type { WebsiteContactContext } from "../generator";
import type { WebsiteSpecification } from "../types";
import type { ThemeFile } from "./theme-structure";
import {
  FONT_PAIRING_KEYS,
  FONT_PAIRING_OPTION_LABELS,
  PALETTE_MOOD_OPTION_LABELS,
  PALETTE_MOOD_KEYS,
  TYPOGRAPHIC_CURVE_SCALE,
  isWebFontPairing,
  type FontPairingSettingValue,
  type PaletteMoodSettingValue,
} from "../visual-contract";
import {
  type ArtDirection,
  type ArtComposition,
  type ArtCardTreatment,
  type ArtImageryBalance,
  type ArtImageStyle,
  type ArtDecorative,
  type ArtTransition,
  type ArtMotionStyle,
  ART_COMPOSITION_KEYS,
  ART_COMPOSITION_OPTION_LABELS,
} from "../art-direction";
import { derivePalette } from "./palette-engine";
import { buildFontFaceCss, fontFamilyValues, fontPairingAssets } from "./font-library";

/**
 * Deterministische Shopify-theme-builder (Fase I.2).
 *
 * PRINCIPE: de AI levert alléén de (gevalideerde) WebsiteSpecification en het
 * (gevalideerde) interne Design Plan. Deze builder vertaalt die 1-op-1 naar
 * Liquid/JSON volgens Shopify's gedocumenteerde themastructuur. Er is géén
 * AI-code, géén kopie van een referentie-thema en géén verzonnen content:
 * alles wat onbekend is, wordt een expliciete, bewerkbare placeholder.
 *
 * Het visuele ontwerp (kleuren, typografie, dichtheid) komt uit het Design
 * Plan van dít project — daardoor is elk thema uniek voor de klant zonder
 * dat er ooit een referentie-identiteit wordt gekopieerd.
 */

// ---------------------------------------------------------------------------
// Deterministische design-tokens
// ---------------------------------------------------------------------------

export interface ThemeDesignTokens {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  border: string;
  headingFont: string;
  bodyFont: string;
  sectionSpacing: string;
  containerWidth: string;
  radius: string;
  /** Typografische kopgrootte (90-130, settings-range) uit plan.typography.scale. */
  headingScale: number;
  /** Font-weights uit plan.typography.weights (hoogste = kop, laagste = lopende tekst). */
  headingWeight: number;
  bodyWeight: number;
  /** Gecontroleerde hero-variant uit imagery/aboveTheFold/mood — bepaalt de CSS-opbouw. D2 voegt "immersive" toe. */
  heroLayout: "focused" | "centered" | "split" | "immersive";
  /**
   * Stijlprofiel (Rendering-stap 1, 2026-09-19): deterministische vertaling
   * van plan.branding.styleDirection/mood naar typografische hiërarchie
   * (letterspatiëring, sectiekopuitlijning, accentdetails). Nooit AI-CSS:
   * één van vier vooraf gebouwde profielen.
   */
  styleProfile: "sharp" | "soft" | "premium" | "neutral";
  /**
   * D1 — Design Token Engine: machine-uitvoerbaar ontwerpcontract uit het
   * Design Plan (visualContract). Zonder visualContract: "system_sans"
   * (of "system_serif" bij een serif-plan) en "neutral_default" — exact
   * het D0-gedrag (systeem-fonts, geen paletcorrecties).
   */
  fontPairing: FontPairingSettingValue;
  paletteMood: PaletteMoodSettingValue;
  /** D1: deterministische WCAG-correcties uit de palette engine (voor notes). */
  paletteCorrections: readonly string[];
  /**
   * D2 — ART DIRECTION: de niche-specifieke visuele kunstketen uit het
   * Design Plan. null (alle plannen vóór D2) betekent exact het D0/D1-
   * gedrag: geen composition-setting, geen art-direction.css, geen
   * header-variantdefaults uit het plan.
   */
  artDirection: ArtDirection | null;
}

const FALLBACK_TOKENS: Omit<
  ThemeDesignTokens,
  "primary" | "secondary" | "accent" | "headingScale" | "headingWeight" | "bodyWeight" | "heroLayout" | "styleProfile"
> = {
  background: "#ffffff",
  surface: "#f7f7f8",
  text: "#1f2328",
  mutedText: "#5f6672",
  border: "#e5e7eb",
  headingFont: "sans",
  bodyFont: "sans",
  sectionSpacing: "normal",
  containerWidth: "1160",
  artDirection: null,
  radius: "10",
  fontPairing: "system_sans",
  paletteMood: "neutral_default",
  paletteCorrections: [],
};

const FALLBACK_TYPOGRAPHY_TOKENS: Pick<
  ThemeDesignTokens,
  "headingScale" | "headingWeight" | "bodyWeight" | "heroLayout"
> = {
  headingScale: 100,
  headingWeight: 700,
  bodyWeight: 400,
  heroLayout: "focused",
};

/** Herkende font-weights (300-700) met NL/EN-kernwoorden — deterministisch. */
const WEIGHT_KEYWORDS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^(300|licht|light|thin)$/, 300],
  [/^(400|regular|normaal|boek)$/, 400],
  [/^(500|medium)$/, 500],
  [/^(600|semibold|halfvet|demi-?bold)$/, 600],
  [/^(700|bold|vet|zwaar)$/, 700],
];

function weightsFor(weights: ReadonlyArray<string>): { heading: number; body: number } {
  const recognized: number[] = [];
  for (const raw of weights) {
    // Eén entry kan meerdere woorden bevatten ("300 licht", "600 halfvet").
    for (const word of raw.toLowerCase().split(/[\s,]+/).filter(Boolean)) {
      for (const [pattern, value] of WEIGHT_KEYWORDS) {
        if (pattern.test(word)) {
          recognized.push(value);
          break;
        }
      }
    }
  }
  if (recognized.length === 0) {
    return { heading: FALLBACK_TYPOGRAPHY_TOKENS.headingWeight, body: FALLBACK_TYPOGRAPHY_TOKENS.bodyWeight };
  }
  return { heading: Math.max(...recognized), body: Math.min(...recognized) };
}

/** Kopgrootte uit plan.typography.scale (vrije tekst) — keyword-mapping, nooit random. */
function headingScaleFor(scale: string | null): number {
  const value = (scale ?? "").toLowerCase();
  if (/(klein|subtiel|bescheiden|compact|small)/.test(value)) return 95;
  if (/(grote|grotere|groot|expressief|uitbundig|dramatisch|large|big|bold)/.test(value)) return 115;
  return 100;
}

/** Hoekafmeting uit stijlrichting/mood — hoekig=2px, zacht=16px, neutraal=10px. */
function radiusFor(styleDirection: string | null, mood: ReadonlyArray<string>): number {
  const signals = [styleDirection ?? "", mood.join(" ")].join(" ").toLowerCase();
  if (/(hoekig|strak|industriel|technisch|minimal|architect)/.test(signals)) return 2;
  if (/(zacht|warm|organisch|speels|rond|vriendelijk)/.test(signals)) return 16;
  return 10;
}

/**
 * Gecontroleerde hero-variant: split bij expliciet gepland beeldmateriaal,
 * centered bij expliciet centraal/luxe-signaal, anders focused. De variant
 * kiest uitsluitend bestaande, vooraf gebouwde CSS-opbouwen — nooit AI-CSS.
 */
function heroLayoutFor(plan: DesignPlan): ThemeDesignTokens["heroLayout"] {
  const imageSignals = [plan.imagery.style ?? "", plan.visualHierarchy.aboveTheFold.join(" ")]
    .join(" ")
    .toLowerCase();
  if (/(beeld|foto|visual|image|visuals)/.test(imageSignals)) return "split";
  const centerSignals = [
    plan.visualHierarchy.aboveTheFold.join(" "),
    plan.branding.styleDirection ?? "",
    plan.branding.mood.join(" "),
  ]
    .join(" ")
    .toLowerCase();
  if (/(gecentreerd|centraal|symmetrisch|luxe|premium|elegant)/.test(centerSignals)) return "centered";
  return "focused";
}

/** Deterministische fallback-kleur wanneer het Design Plan geen kleur bevat. */
const FALLBACK_PALETTE = { primary: "#3f5f4f", secondary: "#8d9a92", accent: "#c9a55a" } as const;

function pickPlanColor(value: string | null, fallback: string): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

/** Kleur with lichtere/donkerdere variant bepalen — puur rekenkundig, geen random. */
function shade(hex: string, factor: number): string {
  const r = Math.round(Number.parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(Number.parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(Number.parseInt(hex.slice(5, 7), 16) * factor);
  const clamp = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

const FONT_STACKS: Record<string, { heading: string; body: string }> = {
  sans: {
    heading: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },
  serif: {
    heading: "Georgia, 'Times New Roman', 'Iowan Old Style', serif",
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  },
  mono: {
    heading: "'SF Mono', 'Cascadia Code', Consolas, 'Liberation Mono', monospace",
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  },
};

/**
 * Stijlprofiel uit plan.branding (styleDirection + mood) — keyword-mapping,
 * deterministisch, nooit random. sharp = strak/minimalistisch; soft = warm/
 * organisch; premium = luxe/elegant; anders neutraal. Het profiel stuurt
 * letterspatiëring, sectiekopuitlijning en accentdetails in theme.css.
 */
export function styleProfileFor(styleDirection: string | null, mood: ReadonlyArray<string>): ThemeDesignTokens["styleProfile"] {
  const signals = [styleDirection ?? "", mood.join(" ")].join(" ").toLowerCase();
  if (/(luxe|premium|elegant|exclusief|verfijnd|klassiek)/.test(signals)) return "premium";
  if (/(zacht|warm|organisch|speels|rond|vriendelijk)/.test(signals)) return "soft";
  if (/(strak|minimal|hoekig|technisch|industr|architect|modern|zakelijk)/.test(signals)) return "sharp";
  return "neutral";
}

function fontKeyFor(pairing: string | null): "sans" | "serif" | "mono" {
  const p = (pairing ?? "").toLowerCase();
  if (/(serif|roman|klassiek|elegant|grafisch)/.test(p)) return "serif";
  if (/(mono|code|technisch)/.test(p)) return "mono";
  return "sans";
}

function spacingFor(density: string | null): string {
  const d = (density ?? "").toLowerCase();
  if (/(compact|dicht|strak)/.test(d)) return "compact";
  if (/(ruim|spacious|luchtig)/.test(d)) return "spacious";
  return "normal";
}

/**
 * D1: webfonts leveren 400/600/700 (kop) resp. 400/600 (lopende tekst);
 * de plan-weights worden deterministisch naar de dichtstbijzijnde
 * GELEVERDE weight geklemd, zodat de browser nooit hoeft te synthesizeren.
 */
function clampToShippedWeights(weights: { heading: number; body: number }): { heading: number; body: number } {
  const headingShipped = [400, 600, 700];
  const bodyShipped = [400, 600];
  const nearest = (value: number, shipped: readonly number[]): number =>
    shipped.reduce((best, candidate) =>
      Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
    , shipped[0]);
  return { heading: nearest(weights.heading, headingShipped), body: nearest(weights.body, bodyShipped) };
}

export function buildThemeDesignTokens(plan: DesignPlan): ThemeDesignTokens {
  const primary = pickPlanColor(plan.colors.primary, FALLBACK_PALETTE.primary);
  const accent = pickPlanColor(plan.colors.accent, FALLBACK_PALETTE.accent);
  const secondary = pickPlanColor(plan.colors.secondary, shade(primary, 0.72));
  const neutrals = plan.colors.neutrals.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));
  const fontKey = fontKeyFor(plan.typography.pairing);
  const fonts = FONT_STACKS[fontKey];
  const weights = weightsFor(plan.typography.weights);
  const contract = plan.visualContract ?? null;

  const artDirection = plan.artDirection ?? null;
  const resolvedHeroLayout = artDirection?.heroTreatment ?? heroLayoutFor(plan);

  const base = {
    primary,
    secondary,
    accent,
    background: neutrals[0] ?? FALLBACK_TOKENS.background,
    surface: neutrals[1] ?? shade(primary, 0.93),
    text: neutrals[2] ?? FALLBACK_TOKENS.text,
    mutedText: neutrals[3] ?? FALLBACK_TOKENS.mutedText,
    border: neutrals[4] ?? FALLBACK_TOKENS.border,
  };

  // D1 — VISUAL CONTRACT: machine-uitvoerbaar ontwerpcontract. Alleen bij
  // aanwezigheid wordt de palet-engine (HSL + WCAG-guard) en de
  // webfont-pairing actief; zonder contract blijft de D0-afleiding exact
  // gehandhaafd (backward compatible, byte-stabiel voor oude plannen).
  if (contract) {
    const palette = derivePalette({ ...base, mood: contract.paletteMood });
    const shipped = clampToShippedWeights(weights);
    return {
      primary: palette.primary,
      secondary: palette.secondary,
      accent: palette.accent,
      background: palette.background,
      surface: palette.surface,
      text: palette.text,
      mutedText: palette.mutedText,
      border: palette.border,
      headingFont: fonts.heading,
      bodyFont: fonts.body,
      sectionSpacing: contract.density,
      containerWidth: FALLBACK_TOKENS.containerWidth,
      radius: String(radiusFor(plan.branding.styleDirection, plan.branding.mood)),
      headingScale: TYPOGRAPHIC_CURVE_SCALE[contract.typographicCurve],
      headingWeight: shipped.heading,
      bodyWeight: shipped.body,
      heroLayout: resolvedHeroLayout,
      styleProfile: styleProfileFor(plan.branding.styleDirection, plan.branding.mood),
      fontPairing: contract.fontPairing,
      paletteMood: contract.paletteMood,
      paletteCorrections: palette.corrections,
      artDirection,
    };
  }

  return {
    ...base,
    headingFont: fonts.heading,
    bodyFont: fonts.body,
    sectionSpacing: spacingFor(plan.spacing.density),
    containerWidth: FALLBACK_TOKENS.containerWidth,
    radius: String(radiusFor(plan.branding.styleDirection, plan.branding.mood)),
    headingScale: headingScaleFor(plan.typography.scale),
    headingWeight: weights.heading,
    bodyWeight: weights.body,
    heroLayout: resolvedHeroLayout,
    styleProfile: styleProfileFor(plan.branding.styleDirection, plan.branding.mood),
    // D0-gedrag: het layout-font werd altijd via settings.font_heading
    // (sans/serif) geresolved; mono-plannen renderten feitelijk sans.
    fontPairing: fontKey === "serif" ? "system_serif" : "system_sans",
    paletteMood: "neutral_default",
    paletteCorrections: [],
    // D2: artDirection is onafhankelijk van het visualContract geldig;
    // zonder artDirection blijft dit null (exact D0/D1-gedrag).
    artDirection,
  };
}

// ---------------------------------------------------------------------------
// Escaping helpers (deterministisch)
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}




/**
 * Fase C: de layout-/achtergrond-/motion-selects voor een blueprint-sectie.
 * Opties komen rechtstreeks uit de SECTION-REGISTRY (één bron van waarheid):
 * schema en blueprint kunnen niet divergeren.
 */
function blueprintVariantSettings(type: BlueprintSectionType, backgroundDefault: string): string {
  const def = BLUEPRINT_SECTION_REGISTRY[type];
  const layouts = def.layouts
    .map((l) => `{ "value": "${l.key}", "label": "${l.description.replace(/"/g, "'")}" }`)
    .join(",\n        ");
  return `    {
      "type": "select",
      "id": "layout",
      "label": "Layoutvariant",
      "default": "${def.defaultLayout}",
      "options": [
        ${layouts}
      ]
    },
    {
      "type": "select",
      "id": "background",
      "label": "Achtergrond",
      "default": "${backgroundDefault}",
      "options": [
        { "value": "default", "label": "Standaard" },
        { "value": "surface", "label": "Contrastvlak" },
        { "value": "accent_band", "label": "Accentband" },
        { "value": "image", "label": "Beeldtint" }
      ]
    },
    {
      "type": "select",
      "id": "motion",
      "label": "Animatie",
      "default": "none",
      "options": [
        { "value": "none", "label": "Geen" },
        { "value": "fade_up", "label": "Vloeiend invliegen" },
        { "value": "stagger", "label": "Gestaggerd invliegen" }
      ]
    },
    {
      "type": "image_picker",
      "id": "background_image",
      "label": "Achtergrondafbeelding (bij achtergrondkeuze Beeldtint)"
    },
    {
      "type": "range",
      "id": "background_overlay",
      "label": "Bedekking voor leesbaarheid",
      "min": 0,
      "max": 90,
      "step": 5,
      "unit": "%",
      "default": 45,
      "info": "Hoger = rustigere leesbaarheid over de achtergrondafbeelding; zonder afbeelding geldt de abstracte placeholder."
    }`;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function buildSettingsSchema(
  businessName: string,
  contact: WebsiteContactContext,
  seoDescription: string,
  tokens: ThemeDesignTokens
): ThemeFile {
  const schema = [
    {
      name: "theme_info",
      theme_name: `${businessName} — Shopify-thema`,
      theme_version: "1.0.0",
      theme_author: "Silvijn Studio",
      theme_documentation_url: "https://silvijnstudio.com",
      theme_support_url: "https://silvijnstudio.com",
    },
    {
      name: "Kleuren",
      settings: [
        { type: "image_picker", id: "favicon", label: "Favicon" },
        {
          type: "select",
          id: "palette_mood",
          label: "Paletstemming",
          default: tokens.paletteMood,
          info: "Stuurt de afgeleide neutrale tinten en de WCAG-contrastcontrole (uit het interne Design Plan).",
          options: [
            { value: "neutral_default", label: PALETTE_MOOD_OPTION_LABELS.neutral_default },
            ...PALETTE_MOOD_KEYS.map((key) => ({ value: key, label: PALETTE_MOOD_OPTION_LABELS[key] })),
          ],
        },
        { type: "color", id: "color_primary", label: "Primaire kleur", default: "#3f5f4f" },
        { type: "color", id: "color_secondary", label: "Secundaire kleur", default: tokens.secondary },
        { type: "color", id: "color_accent", label: "Accentkleur", default: "#c9a55a" },
        { type: "color", id: "color_background", label: "Achtergrond", default: "#ffffff" },
        { type: "color", id: "color_surface", label: "Oppervlakte (sectie-achtergronden)", default: tokens.surface },
        { type: "color", id: "color_muted", label: "Gedempte tekstkleur", default: tokens.mutedText },
        { type: "color", id: "color_border", label: "Randkleur", default: tokens.border },
        { type: "color", id: "color_text", label: "Tekstkleur", default: "#1f2328" },
      ],
    },
    {
      name: "Typografie",
      settings: [
        {
          type: "select",
          id: "font_pairing",
          label: "Font-pairing",
          default: tokens.fontPairing,
          info: "Webfonts worden zelfgehost meegeleverd (SIL OFL-licentie in assets). Systeemopties vallen terug op de besturingssysteemfonts.",
          options: [
            { value: "system_sans", label: FONT_PAIRING_OPTION_LABELS.system_sans },
            { value: "system_serif", label: FONT_PAIRING_OPTION_LABELS.system_serif },
            ...FONT_PAIRING_KEYS.map((key) => ({ value: key, label: FONT_PAIRING_OPTION_LABELS[key] })),
          ],
        },
        {
          type: "select",
          id: "font_heading",
          label: "Kopfont",
          default: "sans",
          info: "Alleen van toepassing bij de systeem-fontopties.",
          options: [
            { value: "sans", label: "Sans-serif (systeem)" },
            { value: "serif", label: "Serif (systeem)" },
          ],
        },
        {
          type: "range",
          id: "heading_scale",
          label: "Kopgrootte",
          min: 90,
          max: 130,
          step: 5,
          unit: "%",
          default: tokens.headingScale,
        },
        {
          type: "select",
          id: "heading_weight",
          label: "Kop-dikte",
          default: String(tokens.headingWeight),
          options: [
            { value: "300", label: "Licht" },
            { value: "400", label: "Normaal" },
            { value: "500", label: "Medium" },
            { value: "600", label: "Halfvet" },
            { value: "700", label: "Vet" },
          ],
        },
        {
          type: "select",
          id: "body_weight",
          label: "Tekst-dikte",
          default: String(tokens.bodyWeight),
          options: [
            { value: "300", label: "Licht" },
            { value: "400", label: "Normaal" },
            { value: "500", label: "Medium" },
            { value: "600", label: "Halfvet" },
          ],
        },
      ],
    },
    {
      name: "Layout",
      settings: [
        {
          type: "range",
          id: "page_width",
          label: "Paginabreedte",
          min: 1000,
          max: 1400,
          step: 20,
          unit: "px",
          default: 1160,
        },
        {
          type: "select",
          id: "section_spacing",
          label: "Sectiedichtheid",
          default: tokens.sectionSpacing,
          options: [
            { value: "compact", label: "Compact" },
            { value: "normal", label: "Normaal" },
            { value: "spacious", label: "Ruim" },
          ],
        },
        {
          type: "range",
          id: "corner_radius",
          label: "Hoekafmeting",
          min: 0,
          max: 20,
          step: 2,
          unit: "px",
          default: Number.parseInt(tokens.radius, 10),
        },
        {
          type: "select",
          id: "hero_layout",
          label: "Hero-opbouw",
          default: tokens.heroLayout,
          options: [
            { value: "focused", label: "Gefocust (smal tekstblok)" },
            { value: "centered", label: "Gecentreerd" },
            { value: "split", label: "Split (tekst + beeld)" },
            { value: "immersive", label: "Immersief (beeldvullend)" },
          ],
        },
        ...(tokens.artDirection
          ? [
              {
                type: "select",
                id: "composition",
                label: "Compositie",
                default: tokens.artDirection.composition,
                info: "Visuele compositierichting uit het interne Design Plan (art direction).",
                options: ART_COMPOSITION_KEYS.map((key) => ({ value: key, label: ART_COMPOSITION_OPTION_LABELS[key] })),
              },
            ]
          : []),
        {
          type: "select",
          id: "style_profile",
          label: "Stijlprofiel",
          default: tokens.styleProfile,
          info: "Beïnvloedt letterspatiëring en sectiekoppen (komt uit het interne Design Plan).",
          options: [
            { value: "sharp", label: "Strak" },
            { value: "soft", label: "Zacht" },
            { value: "premium", label: "Premium" },
            { value: "neutral", label: "Neutraal" },
          ],
        },
      ],
    },
    {
      // Bedrijfsgegevens — defaults komen uitsluitend uit de geverifieerde
      // lead-/specificatiedata; lege waarden blijven leeg (nooit fabriceren).
      // Deze settings voeden de meta-tags (og:image, JSON-LD) en de
      // meta-description-fallback en blijven door de merchant bewerkbaar.
      name: "Bedrijfsgegevens",
      settings: [
        {
          type: "text",
          id: "brand_name",
          label: "Bedrijfsnaam",
          default: businessName,
        },
        // Lege text-defaults weert Shopify (FileSaveError, bewezen 2026-09-21):
        // defaults alléén bij geverifieerde lead-data; anders geen default
        // en vangt de Liquid-fallback (| default/!= blank) de lege waarde op.
        ...(contact.email
          ? [{ type: "text", id: "contact_email", label: "E-mailadres (voor social sharing en structured data)", default: contact.email }]
          : [{ type: "text", id: "contact_email", label: "E-mailadres (voor social sharing en structured data)" }]),
        ...(contact.phone
          ? [{ type: "text", id: "contact_phone", label: "Telefoonnummer", default: contact.phone }]
          : [{ type: "text", id: "contact_phone", label: "Telefoonnummer" }]),
        {
          type: "text",
          id: "contact_city",
          label: "Plaats (voor lokale vindbaarheid)",
          default: contact.city,
        },
        {
          type: "textarea",
          id: "seo_description",
          label: "Standaard omschrijving voor Google",
          default: seoDescription,
          info: "Wordt gebruikt op pagina's zonder eigen omschrijving.",
        },
        {
          type: "image_picker",
          id: "share_image",
          label: "Deelafbeelding (social media)",
          info: "1200 x 630 pixels; getoond bij delen op WhatsApp, Facebook en LinkedIn.",
        },
      ],
    },
  ];
  return { path: "config/settings_schema.json", content: `${JSON.stringify(schema, null, 2)}\n` };
}

function buildSettingsData(
  tokens: ThemeDesignTokens,
  businessName: string,
  contact: WebsiteContactContext,
  seoDescription: string
): ThemeFile {
  const data = {
    current: {
      color_primary: tokens.primary,
      color_secondary: tokens.secondary,
      color_accent: tokens.accent,
      color_background: tokens.background,
      color_surface: tokens.surface,
      color_muted: tokens.mutedText,
      color_border: tokens.border,
      color_text: tokens.text,
      font_pairing: tokens.fontPairing,
      palette_mood: tokens.paletteMood,
      font_heading: tokens.headingFont === FONT_STACKS.serif.heading ? "serif" : "sans",
      heading_scale: tokens.headingScale,
      heading_weight: String(tokens.headingWeight),
      body_weight: String(tokens.bodyWeight),
      page_width: Number.parseInt(tokens.containerWidth, 10),
      section_spacing: tokens.sectionSpacing,
      corner_radius: Number.parseInt(tokens.radius, 10),
      hero_layout: tokens.heroLayout,
      ...(tokens.artDirection ? { composition: tokens.artDirection.composition } : {}),
      style_profile: tokens.styleProfile,
      // Alleen geverifieerde lead-/specificatiedata; nooit ingevulde waarden
      // verzinnen (lege string = bewust leeg gelaten).
      brand_name: businessName,
      contact_email: contact.email ?? "",
      contact_phone: contact.phone ?? "",
      contact_city: contact.city,
      seo_description: seoDescription,
    },
  };
  return { path: "config/settings_data.json", content: `${JSON.stringify(data, null, 2)}\n` };
}

// ---------------------------------------------------------------------------
// Layout + snippets + assets
// ---------------------------------------------------------------------------

function buildThemeLayout(spec: WebsiteSpecification, tokens: ThemeDesignTokens): ThemeFile {
  const liquid = `{% comment %}
  Gegenereerd door Silvijn Studio — deterministisch thema op basis van de
  gevalideerde WebsiteSpecification en het interne Design Plan.
  Content staat in de JSON-templates; ontwerp staat in de settings.
{% endcomment %}
<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>
      {{ page_title | default: shop.name }}
      {%- if page_title != blank and page_title != shop.name and shop.name != blank %} &middot; {{ shop.name }}{% endif -%}
    </title>
    {% assign fallback_description = page_description | default: settings.seo_description %}
    {% if fallback_description != blank %}
      <meta name="description" content="{{ fallback_description | strip_html | strip_newlines | escape }}">
    {% endif %}
    <link rel="canonical" href="{{ canonical_url }}">
    {%- if settings.favicon != blank -%}
      <link rel="icon" type="image/png" href="{{ settings.favicon | image_url: width: 48 }}">
    {%- endif -%}
    {% render 'meta-tags' %}
    {{ content_for_header }}
    {% style %}
      {%- comment -%}
        D1 — Design Token Engine: @font-face voor de GEPLANDE font-pairing
        (kurateur, SIL OFL-gelicentieerd, self-hosted in assets/). De
        declaraties staan in Liquid zodat asset_url correct resolvert.
      {%- endcomment -%}
      ${isWebFontPairing(tokens.fontPairing) ? buildFontFaceCss(tokens.fontPairing) : ""}
      :root {
        --color-primary: {{ settings.color_primary }};
        --color-secondary: {{ settings.color_secondary }};
        --color-accent: {{ settings.color_accent }};
        --color-background: {{ settings.color_background }};
        --color-text: {{ settings.color_text }};
        --color-surface: {{ settings.color_surface }};
        --color-border: {{ settings.color_border }};
        --color-muted: {{ settings.color_muted }};
        --font-heading: {% case settings.font_pairing %}{% when 'modern_sans' %}${fontFamilyValues("modern_sans").heading}{% when 'geometric_sans' %}${fontFamilyValues("geometric_sans").heading}{% when 'editorial_serif' %}${fontFamilyValues("editorial_serif").heading}{% when 'classic_serif' %}${fontFamilyValues("classic_serif").heading}{% when 'humanist_sans' %}${fontFamilyValues("humanist_sans").heading}{% when 'mono_technical' %}${fontFamilyValues("mono_technical").heading}{% else %}{% if settings.font_heading == 'serif' %}${FONT_STACKS.serif.heading}{% else %}${FONT_STACKS.sans.heading}{% endif %}{% endcase %};
        --font-body: {% case settings.font_pairing %}{% when 'modern_sans' %}${fontFamilyValues("modern_sans").body}{% when 'geometric_sans' %}${fontFamilyValues("geometric_sans").body}{% when 'editorial_serif' %}${fontFamilyValues("editorial_serif").body}{% when 'classic_serif' %}${fontFamilyValues("classic_serif").body}{% when 'humanist_sans' %}${fontFamilyValues("humanist_sans").body}{% when 'mono_technical' %}${fontFamilyValues("mono_technical").body}{% else %}${tokens.bodyFont}{% endcase %};
        --font-weight-heading: {{ settings.heading_weight }};
        --font-weight-body: {{ settings.body_weight }};
        --heading-scale: {{ settings.heading_scale | divided_by: 100.0 }};
        --page-width: {{ settings.page_width }}px;
        --radius: {{ settings.corner_radius }}px;
        --section-spacing: {% case settings.section_spacing %}{% when 'compact' %}48px{% when 'spacious' %}112px{% else %}72px{% endcase %};
      }
    {% endstyle %}
    {{ 'theme.css' | asset_url | stylesheet_tag }}
    ${tokens.artDirection ? `    {{ 'art-direction.css' | asset_url | stylesheet_tag }}
` : ""}    <script src="{{ 'theme.js' | asset_url }}" defer></script>
  </head>
  <body class="template-{{ template.name | default: 'index' }} style-{{ settings.style_profile | default: 'neutral' }}${tokens.artDirection ? " ad-{{ settings.composition }}" : ""}">
    <a class="skip-link" href="#main-content">{{ 'accessibility.skip_to_content' | t }}</a>
    {% sections 'header-group' %}
    <main id="main-content" role="main">
      {{ content_for_layout }}
    </main>
    {% sections 'footer-group' %}
  </body>
</html>
`;
  return { path: "layout/theme.liquid", content: liquid };
}

function buildMetaTagsSnippet(): ThemeFile {
  const liquid = `{%- liquid
  assign og_title = page_title | default: shop.name
  assign og_description = page_description | default: settings.seo_description | default: shop.description
-%}
<meta property="og:site_name" content="{{ shop.name | escape }}">
<meta property="og:title" content="{{ og_title | escape }}">
<meta property="og:description" content="{{ og_description | escape }}">
<meta property="og:url" content="{{ canonical_url }}">
<meta property="og:type" content="website">
{%- if settings.share_image != blank -%}
  <meta property="og:image" content="http:{{ settings.share_image | image_url: width: 1200 }}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
{%- else -%}
  <meta name="twitter:card" content="summary">
{%- endif -%}
{%- comment -%}
  Structured data — uitsluitend geverifieerde bedrijfsgegevens uit de
  theme-settings (defaults uit de echte lead-context). Lege velden worden
  weggelaten; er wordt nooit informatie verzonnen of een ander branche-/  type-claim toegevoegd.
{%- endcomment -%}
{%- if settings.brand_name != blank -%}
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      "name": {{ settings.brand_name | json }},
      "url": {{ shop.url | json }}
      {%- if settings.contact_email != blank -%}
        ,
        "email": {{ settings.contact_email | json }}
      {%- endif -%}
      {%- if settings.contact_phone != blank -%}
        ,
        "telephone": {{ settings.contact_phone | json }}
      {%- endif -%}
      {%- if settings.contact_city != blank -%}
        ,
        "address": { "@type": "PostalAddress", "addressLocality": {{ settings.contact_city | json }} }
      {%- endif -%}
    }
  </script>
{%- endif -%}
`;
  return { path: "snippets/meta-tags.liquid", content: liquid };
}

function buildButtonSnippet(): ThemeFile {
  const liquid = `{%- comment -%}
  Knop-tag: {% render 'button', label: ..., url: ..., variant: 'primary' %}
{%- endcomment -%}
{%- if url != blank -%}
  <a class="btn btn--{{ variant | default: 'primary' }}" href="{{ url }}">
    {{ label }}
  </a>
{%- else -%}
  <button type="{{ type | default: 'submit' }}" class="btn btn--{{ variant | default: 'primary' }}">
    {{ label }}
  </button>
{%- endif -%}
`;
  return { path: "snippets/button.liquid", content: liquid };
}

function buildThemeCss(): ThemeFile {
  // --section-spacing komt uit de theme-settings (layout/theme.liquid
  // {% style %}-blok): de merchant kan de dichtheid aanpassen en het
  // Design Plan bepaalde de default (settings_data.json).
  let css = `/* Gegenereerd door Silvijn Studio — deterministische structurele stijlen.
   Design-tokens komen uit de settings ( zie layout/theme.liquid). */
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  font-family: var(--font-body);
  font-size: 1rem;
  line-height: 1.65;
  font-weight: var(--font-weight-body);
  color: var(--color-text);
  background: var(--color-background);
}
h1, h2, h3, h4 { font-family: var(--font-heading); font-weight: var(--font-weight-heading); line-height: 1.2; margin: 0 0 .6em; font-size: calc(1em * var(--heading-scale)); }
h1 { font-size: calc(2.4rem * var(--heading-scale)); }
h2 { font-size: calc(1.8rem * var(--heading-scale)); }
h3 { font-size: calc(1.25rem * var(--heading-scale)); }
p { margin: 0 0 1em; }
a { color: var(--color-primary); text-decoration-thickness: 1px; text-underline-offset: 3px; }
img { max-width: 100%; height: auto; display: block; }
.container { width: 100%; max-width: var(--page-width); margin-inline: auto; padding-inline: 20px; }
.skip-link {
  position: absolute; left: -9999px; top: 0; background: var(--color-primary); color: #fff;
  padding: 10px 16px; z-index: 100; border-radius: 0 0 var(--radius) 0;
}
.skip-link:focus { left: 0; color: #fff; }
:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 2px; }

/* Header (D2: verplichte core component met echte layoutvarianten) */
.site-header { border-bottom: 1px solid var(--color-border); background: var(--color-background); z-index: 10; }
.site-header__inner { display: flex; align-items: center; gap: 16px; justify-content: space-between; padding-block: 14px; }
.site-header__brand { font-family: var(--font-heading); font-weight: var(--font-weight-heading); font-size: 1.2rem; color: var(--color-text); text-decoration: none; }
.site-header__logo { max-height: 44px; width: auto; display: block; }
.site-nav { display: flex; gap: 20px; flex-wrap: wrap; }
.site-nav a { text-decoration: none; color: var(--color-text); font-weight: 500; }
.site-nav a:hover, .site-nav a:focus { color: var(--color-primary); }
.site-nav a[aria-current="page"] { color: var(--color-primary); box-shadow: 0 2px 0 var(--color-primary); }
.site-header__actions { display: flex; gap: 12px; align-items: center; }
.header-nav-toggle { display: none; }
.header-nav-toggle__bar { display: block; width: 18px; height: 2px; background: var(--color-text); margin: 2px 0; border-radius: 1px; }
.site-header--sticky { position: sticky; top: 0; }
.site-header--sticky.site-header--scrolled { box-shadow: 0 1px 10px rgba(15, 23, 42, .06); }
/* Variant: gecentreerd (logo links, nav centraal, CTA rechts) */
.site-header--centered .site-header__inner { display: grid; grid-template-columns: 1fr auto 1fr; }
.site-header--centered .site-header__brand { justify-self: start; }
.site-header--centered .site-nav { justify-self: center; }
.site-header--centered .site-header__actions { justify-self: end; }
/* Variant: gesplitst (nav links, logo centraal, CTA rechts) */
.site-header--split .site-header__inner { display: grid; grid-template-columns: 1fr auto 1fr; }
.site-header--split .site-nav { grid-column: 1; grid-row: 1; justify-self: start; }
.site-header--split .site-header__brand { grid-column: 2; grid-row: 1; justify-self: center; }
.site-header--split .site-header__actions { grid-column: 3; grid-row: 1; justify-self: end; }
/* Variant: transparant over de hero (contrastbehandeling) */
.site-header--overlay { position: absolute; inset-inline: 0; top: 0; background: transparent; border-bottom-color: transparent; }
.site-header--overlay .site-header__brand, .site-header--overlay .site-nav a, .site-header--overlay .site-nav a[aria-current="page"] { color: #fff; text-shadow: 0 1px 6px rgba(0, 0, 0, .35); }
.site-header--overlay .site-nav a:hover, .site-header--overlay .site-nav a:focus { color: rgba(255, 255, 255, .82); }
.site-header--overlay .header-nav-toggle__bar { background: #fff; }
.site-header--overlay .site-header__cta { background: #fff; color: var(--color-primary); }
.site-header--overlay .site-header__cta:hover, .site-header--overlay .site-header__cta:focus { background: var(--color-accent); color: #fff; }
.site-header--overlay.site-header--scrolled { position: fixed; background: var(--color-background); border-bottom-color: var(--color-border); }
.site-header--overlay.site-header--scrolled .site-header__brand, .site-header--overlay.site-header--scrolled .site-nav a, .site-header--overlay.site-header--scrolled .site-nav a[aria-current="page"] { color: var(--color-text); text-shadow: none; }
.site-header--overlay.site-header--scrolled .site-nav a:hover, .site-header--overlay.site-header--scrolled .site-nav a:focus { color: var(--color-primary); }
.site-header--overlay.site-header--scrolled .header-nav-toggle__bar { background: var(--color-text); }
.site-header--overlay.site-header--scrolled .site-header__cta { background: var(--color-primary); color: #fff; }
/* Mobiel fullscreen-menu (D2) */
@media (max-width: 989px) {
  .header-nav-toggle { display: inline-flex; flex-direction: column; align-items: center; padding: 10px 12px; }
  .site-nav { position: fixed; inset: 0; z-index: 40; flex-direction: column; align-items: center; justify-content: center; gap: 26px; background: var(--color-background); opacity: 0; pointer-events: none; transition: opacity .2s ease; }
  .site-nav[data-open="true"] { opacity: 1; pointer-events: auto; }
  .site-nav a { font-size: 1.25rem; }
  body.nav-open { overflow: hidden; }
}
@media (min-width: 990px) {
  .header-nav-toggle { display: none; }
}

/* Hero — basis + gecontroleerde varianten (focused/centered/split) uit het Design Plan */
.hero { padding-block: var(--section-spacing); background: linear-gradient(180deg, var(--color-surface), var(--color-background)); }
.hero__inner { display: grid; gap: 24px; max-width: 720px; }
.hero__eyebrow { text-transform: uppercase; letter-spacing: .12em; font-size: .8rem; color: var(--color-primary); font-weight: 600; margin-bottom: 8px; }
.hero p { font-size: 1.15rem; color: var(--color-muted); }
.hero__actions { display: flex; gap: 12px; flex-wrap: wrap; }
.hero--centered .hero__inner { max-width: 820px; margin-inline: auto; text-align: center; }
.hero--centered .hero__actions { justify-content: center; }
.hero--split .hero__inner { max-width: none; grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr); gap: 40px; align-items: center; }
.hero--split .hero__media img { width: 100%; height: auto; display: block; border-radius: var(--radius); background: var(--color-surface); }
.hero--split .hero__actions { margin-top: 8px; }
.hero--immersive { min-height: 68vh; display: flex; align-items: center; }
.hero--immersive .container { position: relative; z-index: 1; }
.hero--immersive .hero__inner { max-width: 860px; margin-inline: auto; text-align: center; }
.hero--immersive .hero__actions { justify-content: center; }
.hero--immersive .hero__eyebrow { margin-inline: auto; }

/* Buttons */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 12px 22px; border-radius: var(--radius); border: 1px solid transparent;
  font: inherit; font-weight: 600; cursor: pointer; text-decoration: none;
  transition: background-color .15s ease, color .15s ease;
}
.btn--primary { background: var(--color-primary); color: #fff; }
.btn--primary:hover, .btn--primary:focus { background: var(--color-accent); color: #fff; }
.btn--secondary { background: transparent; color: var(--color-secondary); border-color: var(--color-secondary); }
.btn--secondary:hover, .btn--secondary:focus { background: var(--color-surface); }

/* Sections */
.section { padding-block: var(--section-spacing); }
.section--surface { background: var(--color-surface); }
.section__header { max-width: 720px; margin-bottom: 32px; }
.section__header p { color: var(--color-muted); }

/* Cards */
.card-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.card { background: var(--color-background); border: 1px solid var(--color-border); border-radius: var(--radius); padding: 22px; }
.card h3 { margin-bottom: .4em; }
.card p { color: var(--color-muted); margin: 0; }

/* FAQ */
.faq-list { display: grid; gap: 12px; max-width: 820px; }
.faq-item { border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-background); }
.faq-item summary { cursor: pointer; padding: 16px 20px; font-weight: 600; list-style: none; display: flex; justify-content: space-between; gap: 12px; }
.faq-item summary::-webkit-details-marker { display: none; }
.faq-item summary::after { content: "+"; font-size: 1.3rem; color: var(--color-primary); }
.faq-item[open] summary::after { content: "\\2013"; }
.faq-item__body { padding: 0 20px 18px; color: var(--color-muted); }

/* Forms */
.form { display: grid; gap: 14px; max-width: 560px; }
.field label { display: block; font-weight: 600; margin-bottom: 4px; font-size: .95rem; }
.field input, .field textarea {
  width: 100%; padding: 11px 14px; border: 1px solid var(--color-border);
  border-radius: var(--radius); font: inherit; background: var(--color-background); color: var(--color-text);
}
.field input:focus-visible, .field textarea:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 0; border-color: var(--color-primary); }
.form__status { font-weight: 600; }
.form__status--success { color: var(--color-primary); }
.form__status--error { color: #b3261e; }

/* Footer */
.site-footer { background: var(--color-surface); border-top: 1px solid var(--color-border); padding-block: 40px; margin-top: var(--section-spacing); }
.site-footer__inner { display: grid; gap: 20px; }
.site-footer p { color: var(--color-muted); margin: 0; font-size: .95rem; }

/* Shop */
.product-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
.product-card { border: 1px solid var(--color-border); border-radius: var(--radius); overflow: hidden; background: var(--color-background); display: flex; flex-direction: column; }
.product-card__media { aspect-ratio: 1; background: var(--color-surface); }
.product-card__body { padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }
.product-card__title { font-weight: 600; color: var(--color-text); text-decoration: none; }
.price { font-weight: 700; color: var(--color-primary); }
.cart-table { width: 100%; border-collapse: collapse; }
.cart-table th, .cart-table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--color-border); }

/* 404 */
.error-404 { text-align: center; padding-block: var(--section-spacing); }
.error-404 h1 { font-size: 4rem; margin-bottom: .2em; }

@media (max-width: 760px) {
  .header-nav-toggle { display: inline-flex; }
  .site-nav {
    display: none; position: absolute; top: 100%; left: 0; right: 0;
    background: var(--color-background); border-bottom: 1px solid var(--color-border);
    flex-direction: column; padding: 16px 20px; gap: 14px;
  }
  .site-nav[data-open="true"] { display: flex; }
  .hero--split .hero__inner { grid-template-columns: 1fr; gap: 24px; }
  .hero--split .hero__media { order: -1; }
  .hero h1 { font-size: calc(1.8rem * var(--heading-scale)); }
}

@media (prefers-reduced-motion: reduce) {
  .btn { transition: none; }
}
`;
  // Media & beelden (R1): centrale media-slot-stijlen — aspect-ratio's
  // reserveren de ruimte (anti-CLS), object-fit/-position regelen echte
  // afbeeldingen incl. focal point; placeholders zijn abstract per ontwerp.
  css += `
/* --- Media-sloten (R1: theme-media snippet) --- */
.theme-media { position: relative; overflow: hidden; border-radius: var(--radius); background: var(--color-surface); }
.theme-media--wide { aspect-ratio: 16 / 9; }
.theme-media--landscape { aspect-ratio: 4 / 3; }
.theme-media--landscape_4_3 { aspect-ratio: 4 / 3; }
.theme-media--square { aspect-ratio: 1 / 1; }
.theme-media--portrait { aspect-ratio: 3 / 4; }
.theme-media--portrait_3_4 { aspect-ratio: 3 / 4; }
.theme-media--tall { aspect-ratio: 2 / 3; }
.theme-media img { width: 100%; height: 100%; object-fit: cover; object-position: var(--media-focal, 50% 50%); display: block; }
.theme-media--placeholder img { object-position: center; }
.hero__band { margin-top: 32px; }
.about__grid { display: grid; gap: 40px; align-items: center; grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr); }
.about__grid--media-left .about__media { order: -1; }
.card--media { padding: 0; display: flex; flex-direction: column; overflow: hidden; }
.card--media .card__media .theme-media { border-radius: 0; aspect-ratio: 4 / 3; }
.card--media .card__body { padding: 18px 22px; }
.card--media h3, .card--media p { margin: 0 0 .4em; }
.card--media p:last-child { margin: 0; }
.gallery-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.gallery-item { margin: 0; }
.gallery-item .theme-media { border-radius: 0 0 var(--radius) var(--radius); }
.gallery-item__caption { font-size: .9rem; color: var(--color-muted); padding: 10px 4px 0; }
.testimonial-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.testimonial { margin: 0; padding: 22px; background: var(--color-background); border: 1px solid var(--color-border); border-radius: var(--radius); }
.testimonial__mark { display: block; font-family: var(--font-heading); font-size: 2rem; line-height: 1; color: var(--color-accent); margin-bottom: 6px; }
.testimonial__quote { font-size: 1.05rem; color: var(--color-text); margin: 0 0 8px; }
.testimonial__author { margin: 0; font-size: .9rem; color: var(--color-muted); }
@media (max-width: 760px) {
  .about__grid { grid-template-columns: 1fr; gap: 24px; }
  .about__grid--media-left .about__media { order: 0; }
}
`;
  // Fase C: blueprint-compositie — layoutvarianten, achtergronden, motion
  // en de nieuwe registry-secties. Alles deterministisch; geen AI-CSS.
  css += `
/* --- Fase C: blueprint-compositie --- */
/* Achtergrondvarianten (bg-default is de natuurlijke achtergrond) */
.section--bg-accent_band { background: var(--color-surface); border-block: 3px solid var(--color-accent); }
/* Contrastvlak krijgt subtiel compactere sectieruimte (sectieritme). */
.section--bg-surface { padding-block: calc(var(--section-spacing) * .92); }
/* Beeld-achtergrond: ÉCHTE media-laag (afbeelding of abstracte placeholder)
   via de section-background-snippet + contrast-overlay — nooit een gradient-fallback. */
.section--bg-image { position: relative; background: var(--color-surface); }
.section--bg-image > .container { position: relative; z-index: 1; }
.section__background { position: absolute; inset: 0; overflow: hidden; }
.section__background .theme-media { height: 100%; aspect-ratio: auto; border-radius: 0; }
.section__background-overlay { position: absolute; inset: 0; background: var(--color-background); }
/* Motion: fade_up animeert de sectie als geheel; stagger animeert de
   BETEKENISvolle binnenblokken (kaarten, stappen, stats, koppen) in
   plaats van de container — en respecteert prefers-reduced-motion volledig. */
.motion--fade_up { animation: bp-fade-up .5s ease both; }
.motion--stagger .section__header { animation: bp-fade-up .5s ease both; }
.motion--stagger .hero__inner > * { animation: bp-fade-up .5s ease both; }
.motion--stagger .rte > * { animation: bp-fade-up .5s ease both; }
.motion--stagger :where(.card-grid, .process-list, .stats-row, .usp-row, .team-grid, .testimonial-grid, .faq-list, .gallery-grid, .projects-grid, .contact-grid, .about__grid) > * { animation: bp-fade-up .5s ease both; }
.motion--stagger :where(.card-grid, .process-list, .stats-row, .usp-row, .team-grid, .testimonial-grid, .faq-list, .gallery-grid, .projects-grid, .contact-grid, .about__grid) > *:nth-child(2) { animation-delay: .07s; }
.motion--stagger :where(.card-grid, .process-list, .stats-row, .usp-row, .team-grid, .testimonial-grid, .faq-list, .gallery-grid, .projects-grid, .contact-grid, .about__grid) > *:nth-child(3) { animation-delay: .14s; }
.motion--stagger :where(.card-grid, .process-list, .stats-row, .usp-row, .team-grid, .testimonial-grid, .faq-list, .gallery-grid, .projects-grid, .contact-grid, .about__grid) > *:nth-child(4) { animation-delay: .21s; }
.motion--stagger :where(.card-grid, .process-list, .stats-row, .usp-row, .team-grid, .testimonial-grid, .faq-list, .gallery-grid, .projects-grid, .contact-grid, .about__grid) > *:nth-child(5) { animation-delay: .28s; }
.motion--stagger :where(.card-grid, .process-list, .stats-row, .usp-row, .team-grid, .testimonial-grid, .faq-list, .gallery-grid, .projects-grid, .contact-grid, .about__grid) > *:nth-child(6) { animation-delay: .35s; }
.motion--stagger :where(.card-grid, .process-list, .stats-row, .usp-row, .team-grid, .testimonial-grid, .faq-list, .gallery-grid, .projects-grid, .contact-grid, .about__grid) > *:nth-child(7) { animation-delay: .42s; }
.motion--stagger :where(.card-grid, .process-list, .stats-row, .usp-row, .team-grid, .testimonial-grid, .faq-list, .gallery-grid, .projects-grid, .contact-grid, .about__grid) > *:nth-child(8) { animation-delay: .49s; }
@keyframes bp-fade-up { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .motion--fade_up, .motion--fade_up *, .motion--stagger, .motion--stagger * { animation: none !important; }
}
/* Hero-varianten (split/centered bestaan al) — elk met een eigen
   compositie: focused = smal + veel witruimte, band = lage gecentreerde
   band met kleinere kop, minimal = sobere kernzin. */
.hero--focused .hero__inner { max-width: 640px; }
.hero--focused { padding-block: calc(var(--section-spacing) * 1.3); }
.hero--band { padding-block: calc(var(--section-spacing) * .55); }
.hero--band .hero__band { display: none; }
.hero--band .hero__inner { max-width: 860px; margin-inline: auto; text-align: center; }
.hero--band .hero__actions { justify-content: center; }
.hero--band h1 { font-size: calc(1.9rem * var(--heading-scale)); }
.hero--minimal { padding-block: calc(var(--section-spacing) * .8); }
.hero--minimal .hero__band { display: none; }
.hero--minimal .hero__eyebrow { display: none; }
.hero--minimal .hero__inner { max-width: 560px; }
.hero--minimal h1 { font-size: calc(1.7rem * var(--heading-scale)); }
/* Services-varianten */
.services--grid .card-grid { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.services--cards .card-grid { grid-template-columns: repeat(2, 1fr); }
.services--list .card-grid { grid-template-columns: 1fr; max-width: 820px; gap: 12px; }
.services--list .card--media { flex-direction: row; align-items: center; }
.services--list .card--media .card__media { display: none; }
.services--alternating .card-grid { grid-template-columns: 1fr; max-width: 720px; }
.services--alternating .card--media { flex-direction: row-reverse; }
.services--alternating .card-grid > *:nth-child(even) .card--media { flex-direction: row; }
/* About-varianten */
.about--split .about__grid { grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr); gap: 40px; align-items: center; }
.about--story .about__grid { grid-template-columns: 1fr; max-width: 760px; }
.about--story .about__media { display: none; }
.about--quote .about__body { font-family: var(--font-heading); font-size: 1.4rem; line-height: 1.45; }
.about--quote .about__body p:first-child::before { content: "\\201C"; color: var(--color-accent); margin-right: 4px; }
.about--timeline .about__grid { grid-template-columns: 1fr; max-width: 760px; }
.about--timeline .about__body { border-left: 3px solid var(--color-accent); padding-left: 24px; }
.gallery--grid .gallery-grid { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.gallery--full_width .gallery-grid { grid-template-columns: 1fr; gap: 0; }
.gallery--full_width .gallery-item .theme-media { aspect-ratio: 21 / 9; border-radius: 0; }
.testimonials--grid .testimonial-grid { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.testimonials--band .testimonial-grid { grid-template-columns: 1fr; max-width: 720px; }
.testimonials--band .testimonial__quote { font-size: 1.25rem; text-align: center; }
.testimonials--carousel .testimonial-grid { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 8px; }
.testimonials--carousel .testimonial { min-width: min(420px, 85vw); scroll-snap-align: center; }
.benefits--grid .card-grid { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }
.benefits--checklist .card-grid { grid-template-columns: 1fr; max-width: 720px; gap: 0; }
.benefits--checklist .card { border: none; padding: 10px 0; display: flex; align-items: baseline; gap: 12px; }
.benefits--checklist .card > p:first-child { display: none; }
.benefits--checklist .card h3::before { content: "\\2713 "; color: var(--color-primary); font-size: 1.1em; }
.benefits--split .card-grid { grid-template-columns: 1fr; max-width: 720px; }
.benefits--split .card { border-left: 3px solid var(--color-accent); }
.faq--accordion .faq-list { display: grid; gap: 12px; max-width: 820px; }
.faq--list .faq-list { gap: 0; max-width: none; }
.faq--list .faq-item { border: none; border-bottom: 1px solid var(--color-border); border-radius: 0; }
.faq--list .faq-item summary::after { content: ""; }
.cta__copy h2 { margin-bottom: .3em; }
.cta__copy p { color: var(--color-muted); max-width: 640px; margin: 0; }
.cta__action { margin-top: 20px; }
/* band: brede gecentreerde uitnodiging met grote knop */
.cta--band .cta__inner { max-width: 760px; margin-inline: auto; text-align: center; }
.cta--band .cta__copy h2 { font-size: calc(2rem * var(--heading-scale)); }
.cta--band .cta__copy p { margin-inline: auto; }
.cta--band .cta__action { margin-top: 24px; }
.cta--band .cta__button { padding: 16px 32px; font-size: 1.05rem; }
/* split: boodschap links, actie rechts (tweekoloms) */
.cta--split .cta__inner { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, .65fr); align-items: center; gap: 24px; }
.cta--split .cta__action { margin-top: 0; text-align: right; }
/* closing: compacte afsluiting onderaan de pagina */
.cta--closing { padding-block: calc(var(--section-spacing) * .6); border-top: 1px solid var(--color-border); }
.cta--closing .cta__inner { max-width: 560px; margin-inline: auto; text-align: center; }
.cta--closing .cta__action { margin-top: 16px; }
@media (max-width: 760px) {
  .cta--split .cta__inner { grid-template-columns: 1fr; }
  .cta--split .cta__action { text-align: left; }
}
/* Contact-varianten (inline-grid vervangen door klasse) */
.contact-grid { display: grid; gap: 32px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.contact--split .contact-grid { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 32px; }
/* full: verticale, volledige sectie met ruime formulierkolom */
.contact--full .contact-grid { grid-template-columns: 1fr; max-width: 760px; }
.contact--full .contact__details { border-bottom: 1px solid var(--color-border); padding-bottom: 24px; }
/* minimal: alleen de kerngegevens, compact (geen formulier) */
.contact--minimal .contact-grid { grid-template-columns: 1fr; gap: 0; }
.contact--minimal { padding-block: calc(var(--section-spacing) * .6); }
.contact--minimal .contact__details p { margin: 0 0 .35em; }
.rich-text--article .rte { max-width: 760px; }
.rich-text--columns .rte { max-width: 960px; columns: 2; column-gap: 40px; }
@media (max-width: 760px) { .rich-text--columns .rte { columns: 1; } }
/* Nieuwe registry-secties */
.usp-row { display: flex; flex-wrap: wrap; gap: 12px 40px; }
.usp-band--row .usp-row { display: flex; flex-wrap: wrap; gap: 12px 40px; }
.usp-band--grid .usp-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; }
.usp-item__label { font-weight: 600; margin: 0; }
.usp-item__description { color: var(--color-muted); margin: 4px 0 0; font-size: .95rem; }
.stats-row { display: flex; flex-wrap: wrap; gap: 32px 56px; }
.stats--row .stats-row { display: flex; flex-wrap: wrap; gap: 32px 56px; }
.stats--grid .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; }
.stat__value { font-family: var(--font-heading); font-size: 2.2rem; font-weight: 700; color: var(--color-primary); margin: 0; }
.stat__label { color: var(--color-muted); margin: 4px 0 0; }
.process-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 24px; counter-reset: none; max-width: 820px; }
.process--steps .process-list { grid-template-columns: 1fr; gap: 24px; }
.process--numbered_row .process-list { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 24px; }
.process-item { display: flex; gap: 16px; align-items: flex-start; }
.process-item__number { flex: none; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 999px; background: var(--color-primary); color: #fff; font-weight: 700; font-size: .95rem; }
.process-item h3 { margin-bottom: .2em; font-size: 1.05rem; }
.process-item p { color: var(--color-muted); margin: 0; }
.projects-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.projects--grid .projects-grid { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
.projects--feature_row .projects-grid > *:first-child { grid-column: 1 / -1; }
.project-card { background: var(--color-background); border: 1px solid var(--color-border); border-radius: var(--radius); overflow: hidden; }
.project-card__media .theme-media { border-radius: 0; }
.project-card__body { padding: 18px 22px; }
.project-card__body p { color: var(--color-muted); margin: 0; }
.team-grid { display: grid; gap: 24px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
.team--grid .team-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 24px; }
.team--row .team-grid { grid-template-columns: 1fr; gap: 12px; }
.team--row .team-member { display: flex; align-items: center; gap: 16px; }
.team--row .team-member__media { width: 72px; flex: none; }
.team--row .team-member__media .theme-media { aspect-ratio: 1; }
.team-member__media .theme-media { border-radius: var(--radius); }
.team-member__body h3 { margin: 0 0 2px; font-size: 1.05rem; }
.team-member__role { color: var(--color-muted); margin: 0; font-size: .95rem; }
.rates--table .rates-table { width: 100%; border-collapse: collapse; max-width: 820px; }
.rates--cards .card-grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
.rates-table { width: 100%; border-collapse: collapse; max-width: 820px; }
.rates-table th, .rates-table td { text-align: left; padding: 12px 14px; border-bottom: 1px solid var(--color-border); }
.rates-table__price, .rate-card__price { font-weight: 700; color: var(--color-primary); margin: 0; }
.newsletter__inner { display: grid; gap: 24px; align-items: center; }
.newsletter--band .newsletter__inner { grid-template-columns: 1fr; text-align: center; }
.newsletter--band .newsletter__form { margin-inline: auto; }
.newsletter--split .newsletter__inner { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.newsletter__copy h2 { margin-bottom: .2em; }
.newsletter__copy p { color: var(--color-muted); margin: 0; }
.newsletter__form { display: flex; gap: 12px; align-items: end; max-width: 560px; }
.newsletter__form .field { flex: 1; }
.booking__inner { display: grid; gap: 24px; align-items: center; }
.booking--band .booking__inner { text-align: center; }
.booking--split .booking__inner { grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr); }
.booking--split .booking__action { text-align: right; }
.booking__copy h2 { margin-bottom: .2em; }
.booking__copy p { color: var(--color-muted); margin: 0; }
/* --- Stijlprofielen (Rendering-stap 1): deterministische vertaling van
   Design Plan mood/styleDirection naar typografische hiërarchie. De
   body-klasse komt uit de theme-settings (style_profile). --- */
.style-sharp h1, .style-sharp h2, .style-sharp h3 { letter-spacing: -0.02em; }
.style-premium h1, .style-premium h2, .style-premium h3 { letter-spacing: .01em; }
.style-premium .section__header { text-align: center; margin-inline: auto; }
.style-soft .section__header h2::after, .style-premium .section__header h2::after {
  content: ""; display: block; width: 44px; height: 3px;
  background: var(--color-accent); margin-top: 14px; border-radius: 999px;
}
.style-premium .section__header h2::after { margin-inline: auto; }
`;

  // Klantaccountpagina's (Fase I.2 completeness) — neutraal, gebruikt de
  // bestaande design-tokens; geen referentie-ontwerp gekopieerd.
  css += `
/* --- Klantaccountpagina's (alleen zichtbaar bij actieve klantaccounts) --- */
.account { width: 100%; max-width: var(--page-width); margin-inline: auto; padding: 32px 20px; }
.account__grid { display: grid; gap: 16px; grid-template-columns: 1fr; }
.account h1 { margin: 0 0 8px; }
.account h2 { margin: 24px 0 8px; font-size: 1.15rem; }
.account__actions { display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0; }
.account__card { border: 1px solid var(--color-border); border-radius: var(--radius); padding: 16px; background: var(--color-surface); }
.account__meta { margin: 0 0 4px; }
.account__empty { opacity: .7; }
.account table { width: 100%; border-collapse: collapse; }
.account th, .account td { padding: 8px 6px; border-bottom: 1px solid var(--color-border); text-align: left; }
.account__status { display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--color-surface); font-size: .85rem; }
.visually-hidden { position: absolute !important; overflow: hidden; width: 1px; height: 1px; clip-path: inset(50%); white-space: nowrap; }
@media (min-width: 900px) { .account__grid { grid-template-columns: 1fr 1fr; } }
`;
  return { path: "assets/theme.css", content: css };
}

function buildThemeJs(): ThemeFile {
  const js = `// Gegenereerd door Silvijn Studio — minimale, progressieve verbeteringen.
(function () {
  "use strict";
  function init() {
    // D2: sticky/scrolled-state op de header (schaduw + overlay-terugval).
    var header = document.querySelector("[data-site-header]");
    if (header) {
      var onScroll = function () { header.classList.toggle("site-header--scrolled", window.scrollY > 8); };
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
    }
    // D2: mobiel fullscreen-menu (open/dicht, Escape, sluiten bij navigatie).
    var toggle = document.querySelector("[data-nav-toggle]");
    var nav = document.querySelector("[data-nav]");
    if (toggle && nav) {
      var setOpen = function (open) {
        nav.setAttribute("data-open", open ? "true" : "false");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        document.body.classList.toggle("nav-open", open);
      };
      toggle.addEventListener("click", function () {
        setOpen(nav.getAttribute("data-open") !== "true");
      });
      nav.addEventListener("click", function (event) {
        if (event.target && event.target.closest && event.target.closest("a")) setOpen(false);
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") setOpen(false);
      });
    }
    // D2: active navigation state — markeer de link van de huidige pagina.
    var path = (window.location.pathname.replace(/\/$/, "") || "/");
    Array.prototype.forEach.call(document.querySelectorAll(".site-nav a[href]"), function (link) {
      var href = (link.getAttribute("href") || "").replace(window.location.origin, "").replace(/\/$/, "") || "/";
      if (href === path || (href !== "/" && path.indexOf(href + "/") === 0)) {
        link.setAttribute("aria-current", "page");
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
`;
  return { path: "assets/theme.js", content: js };
}

/**
 * D2 — ART DIRECTION-CSS (assets/art-direction.css). Bestaat uITSLOTEND
 * bij een artDirection-contract op het Design Plan; plannen zonder
 * contract krijgen dit bestand niet (exact D0/D1-gedrag).
 *
 * Opbouw (alle regels vooraf gebouwd en enum-gestuurd — NIET AI-CSS):
 * 1. Compositie: zes volledige rule-sets op body.ad-<composition> zodat
 *    de merchant de compositie kan switchen via de theme-setting.
 * 2. Kaart-, beeld-, decoratie-, overgangs- en motion-keuzes: de regels
 *    van de GEKOZEN enums worden direct geschreven (niet switchbaar, wel
 *    deterministisch uit het contract).
 * Motion overschrijft uitsluitend animation-name van de bestaande
 * bp-fade-up-keyframes; prefers-reduced-motion geldt onverkort.
 */
function buildArtDirectionCss(tokens: ThemeDesignTokens): ThemeFile | null {
  const art = tokens.artDirection;
  if (art == null) return null;

  const compositionBlocks: Record<ArtComposition, string> = {
    editorial: `/* Editoriaal: tijdschriftachtige maatvoering, smalle tekstmaat, ritmische kaarten */
body.ad-editorial .section__header { max-width: 620px; }
body.ad-editorial .hero__inner { max-width: 680px; }
body.ad-editorial .hero p { font-size: 1.25rem; }
body.ad-editorial .card-grid { gap: 32px; }
body.ad-editorial .card-grid > :nth-child(2) { margin-top: 24px; }
body.ad-editorial .section__header h2 { letter-spacing: -0.01em; }`,
    asymmetric: `/* Asymmetrisch: bewuste oneven wittenruimte- en offset-verschuivingen */
body.ad-asymmetric .card-grid > :nth-child(2n) { margin-top: 28px; }
body.ad-asymmetric .section__header { margin-inline-start: 8%; }
body.ad-asymmetric .hero__eyebrow { letter-spacing: .18em; }
body.ad-asymmetric .about__grid { align-items: start; }
body.ad-asymmetric .card-grid { align-items: start; }`,
    minimal: `/* Minimalistisch: vlakke kaarten, maximale witruimte, rustige helderheid */
body.ad-minimal { --section-spacing: calc(var(--section-spacing) + 24px); }
body.ad-minimal .card { border: none; background: transparent; padding: 0; }
body.ad-minimal .hero { background: var(--color-background); }
body.ad-minimal .section__header { max-width: 560px; }`,
    immersive: `/* Immersief: beleving voorop — beeldvullende media en forse hero */
body.ad-immersive .hero { min-height: 76vh; align-items: center; }
body.ad-immersive .theme-media { border-radius: 0; }
body.ad-immersive .gallery-item .theme-media { aspect-ratio: 16 / 10; }
body.ad-immersive .section--bg-surface { background: var(--color-surface); }`,
    structured: `/* Gestructureerd: zakelijk, strak grid, eenduidige vlakken */
body.ad-structured .card-grid { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 24px; }
body.ad-structured .card-grid > :nth-child(n) { margin-top: 0; }
body.ad-structured .section__header { max-width: 720px; margin-bottom: 40px; }
body.ad-structured .card { border-color: var(--color-border); }`,
    playful: `/* Speels: rondere vormen, accentdetails, uitnodigend karakter */
body.ad-playful .card { border-radius: calc(var(--radius) + 8px); }
body.ad-playful .btn { border-radius: 999px; }
body.ad-playful .section__header h2::after { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--color-accent); margin-left: 10px; vertical-align: middle; }`,
  };

  const cardBlocks: Record<ArtCardTreatment, string> = {
    bordered: `/* Kaartbehandeling: bordered (standaardkader) — geen extra regels nodig. */`,
    shadow: `/* Kaartbehandeling: schaduw (zwevend, zacht) */
.card { border-color: transparent; box-shadow: 0 12px 32px rgba(15, 23, 42, .08); background: var(--color-background); }`,
    flat: `/* Kaartbehandeling: vlak (kaderloos contrastvlak) */
.card { border: none; background: var(--color-surface); }`,
    accent_top: `/* Kaartbehandeling: accentrand bovenaan */
.card { border-top: 3px solid var(--color-primary); }`,
  };

  const imageryBlocks: Record<ArtImageryBalance, string> = {
    image_forward: `/* Beeld-tel-tekst: beeld voorop — ruimere mediakolommen */
.hero--split .hero__inner { grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr); }
.gallery-item .theme-media { aspect-ratio: 16 / 10; }`,
    balanced: `/* Beeld-tel-tekst: gebalanceerd — geen extra regels nodig. */`,
    text_forward: `/* Beeld-tel-tekst: tekst voorop — smallere mediakolommen */
.hero--split .hero__inner { grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr); }
.section__header { max-width: 640px; }
.gallery-item .theme-media { aspect-ratio: 4 / 3; }`,
  };

  const imageStyleBlocks: Record<ArtImageStyle, string> = {
    framed: `/* Beeldstijl: gekaderd */
.theme-media { border-radius: var(--radius); border: 1px solid var(--color-border); }`,
    full_bleed: `/* Beeldstijl: beeldvullend (geen kaders) */
.theme-media { border-radius: 0; border: none; }
.card { border-radius: 0; }`,
    tinted_overlay: `/* Beeldstijl: getinte overlay voor eenheid tussen beelden */
.theme-media { position: relative; }
.theme-media::after { content: ""; position: absolute; inset: 0; background: linear-gradient(155deg, rgba(15, 23, 42, .22), rgba(15, 23, 42, .05)); pointer-events: none; }
.section__background .theme-media::after { display: none; }`,
  };

  const decorativeBlocks: Record<ArtDecorative, string> = {
    none: `/* Decoratie: geen — bewust leeg. */`,
    accent_bars: `/* Decoratie: accentbalken boven sectiekoppen */
.section__header h2::before { content: ""; display: block; width: 46px; height: 4px; border-radius: 2px; background: var(--color-accent); margin-bottom: 16px; }`,
    soft_dividers: `/* Decoratie: zachte scheidingslijnen */
.section .section__header { border-top: 1px solid var(--color-border); padding-top: 28px; }
.site-footer { border-top: 1px solid var(--color-border); }`,
  };

  const transitionBlocks: Record<ArtTransition, string> = {
    hard_cut: `/* Sectie-overgang: harde snede (standaard) — geen extra regels nodig. */`,
    surface_alternate: `/* Sectie-overgang: afwisselende contrastvlakken */
.main-content > section.section--bg-default:nth-of-type(even) { background: var(--color-surface); }`,
    gradient_blend: `/* Sectie-overgang: vloeiende gradient-overgang */
.section--bg-surface { background: linear-gradient(180deg, var(--color-surface), var(--color-background)); }`,
  };

  const motionName = art.motionStyle === "rise" ? "ad-rise" : art.motionStyle === "scale" ? "ad-scale" : "ad-fade";
  const motionKeyframes: Record<ArtMotionStyle, string> = {
    fade: `@keyframes ad-fade { from { opacity: 0; } to { opacity: 1; } }`,
    rise: `@keyframes ad-rise { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: none; } }`,
    scale: `@keyframes ad-scale { from { opacity: 0; transform: scale(.955); } to { opacity: 1; transform: none; } }`,
  };
  const motionBlock = `/* Motion-personality: ${art.motionStyle} (overschrijft uitsluitend
   animation-name; duur/easing en prefers-reduced-motion blijven onverkort) */
${motionKeyframes[art.motionStyle]}
.motion--fade_up, .motion--stagger .section__header, .motion--stagger .hero__inner > *, .motion--stagger .rte > *, .motion--stagger :where(.card-grid, .process-list, .stats-row, .usp-row, .team-grid, .testimonial-grid, .faq-list, .gallery-grid, .projects-grid, .contact-grid, .about__grid) > * { animation-name: ${motionName}; }`;

  const css = `/* Gegenereerd door Silvijn Studio — D2 art direction (deterministische
   compositielaag uit het interne Design Plan; enum-gestuurd, geen AI-CSS).
   Concept: ${art.concept.replace("*/", "* /")} */

/* --- Compositie (merchant-switchbaar via de compositie-setting) --- */
${Object.values(compositionBlocks).join("\n\n")}

/* --- Kaartbehandeling: ${art.cardTreatment} --- */
${cardBlocks[art.cardTreatment]}

/* --- Beeld-tel-tekstverhouding: ${art.imageryBalance} --- */
${imageryBlocks[art.imageryBalance]}

/* --- Beeldstijl: ${art.imageStyle} --- */
${imageStyleBlocks[art.imageStyle]}

/* --- Decoratie: ${art.decorativeStyle} --- */
${decorativeBlocks[art.decorativeStyle]}

/* --- Sectie-overgangen: ${art.sectionTransition} --- */
${transitionBlocks[art.sectionTransition]}

${motionBlock}
`;

  return { path: "assets/art-direction.css", content: css };
}

function buildLocaleFile(): ThemeFile {
  const locale = {
    accessibility: { skip_to_content: "Direct naar de inhoud" },
    general: {
      search: "Zoeken",
      menu: "Menu",
      close: "Sluiten",
      cart: "Winkelwagen",
      back_home: "Terug naar de homepage",
      learn_more: "Meer informatie",
      password_page: {
        login_form_password: "Wachtwoord",
        login_form_button: "Naar de site",
        admin_link_html: "Eigenaar van deze winkel? <a href=\"/admin\">Log in</a> in de beheeromgeving.",
      },
    },
    rates: {
      service: "Dienst",
      price: "Prijs",
    },
    newsletter: {
      email: "E-mailadres",
    },
    contact: {
      title: "Contact",
      intro: "Neem contact met ons op — we reageren zo snel mogelijk.",
      name: "Naam",
      email: "E-mailadres",
      phone: "Telefoonnummer",
      message: "Bericht",
      submit: "Verstuur bericht",
      success: "Bedankt! Je bericht is verzonden.",
      error: "Het bericht kon niet worden verzonden. Probeer het nogmaals.",
      call_us: "Bel ons",
      email_us: "Mail ons",
      visit_us: "Bezoek ons",
    },
    cart: {
      title: "Winkelwagen",
      empty: "Je winkelwagen is leeg.",
      product: "Product",
      price: "Prijs",
      quantity: "Aantal",
      total: "Totaal",
      checkout: "Afrekenen",
      remove: "Verwijderen",
      subtotal: "Subtotaal",
      taxes_note: "Belastingen en verzendkosten worden berekend bij het afrekenen.",
      continue_shopping: "Verder winkelen",
    },
    search: {
      title: "Zoekresultaten",
      placeholder: "Zoek in de winkel...",
      submit: "Zoeken",
      results_count: {
        one: "{{ count }} resultaat",
        other: "{{ count }} resultaten",
      },
      no_results: "Geen resultaten gevonden.",
    },
    collections: {
      title: "Collecties",
      empty: "Er zijn geen producten gevonden.",
    },
    products: {
      add_to_cart: "Toevoegen aan winkelwagen",
      sold_out: "Uitverkocht",
      unavailable: "Niet beschikbaar",
      quantity: "Aantal",
      view_details: "Bekijk details",
      vendor: "Merk",
    },
    error_404: {
      title: "Pagina niet gevonden",
      subtext: "De pagina die je zoekt bestaat niet (meer).",
    },
    customers: {
      login_page: {
        title: "Inloggen",
        login: "Inloggen",
        email: "E-mailadres",
        password: "Wachtwoord",
        forgot_password: "Wachtwoord vergeten?",
        new_customer: "Nieuwe klant?",
        no_account_yet: "Maak een account om sneller te bestellen en je bestellingen te volgen.",
        create_account: "Account aanmaken",
        guest_title: "Doorgaan zonder account",
      },
      register_page: {
        title: "Account aanmaken",
        first_name: "Voornaam",
        last_name: "Achternaam",
        email: "E-mailadres",
        password: "Wachtwoord",
        submit: "Account aanmaken",
        back_to_login: "Terug naar inloggen",
      },
      account: {
        title: "Mijn account",
        details: "Gegevens",
        view_addresses: "Adressen bekijken",
        orders_title: "Bestellingen",
        no_orders: "Je hebt nog geen bestellingen geplaatst.",
        logout: "Uitloggen",
      },
      order: {
        title: "Bestelling",
        order: "Bestelnummer",
        date: "Datum",
        total: "Totaal",
        product: "Product",
        quantity: "Aantal",
        subtotal: "Subtotaal",
        billing_address: "Factuuradres",
        shipping_address: "Bezorgadres",
      },
      addresses: {
        title: "Mijn adressen",
        no_addresses: "Je hebt nog geen adressen opgeslagen.",
        default: "Standaardadres",
        first_name: "Voornaam",
        last_name: "Achternaam",
        company: "Bedrijf",
        address1: "Adres",
        address2: "Adres toevoeging",
        city: "Plaats",
        zip: "Postcode",
        phone: "Telefoonnummer",
        update: "Bijwerken",
        set_default: "Als standaard instellen",
        delete: "Verwijderen",
        add_new: "Nieuw adres toevoegen",
        add_address: "Adres opslaan",
      },
      activate_account_page: {
        title: "Account activeren",
        password: "Kies een wachtwoord",
        password_confirm: "Bevestig je wachtwoord",
        submit: "Account activeren",
      },
      reset_password_page: {
        title: "Wachtwoord herstellen",
        email: "E-mailadres",
        submit: "Herstellink sturen",
      },
    },
    gift_cards: {
      issued: {
        title: "Je cadeaubon",
        remaining_html: "Resterend tegoed",
        disabled: "Deze cadeaubon is niet meer geldig.",
        expired: "Deze cadeaubon is verlopen.",
        expires_on: "Geldig t/m",
        shop_link: "Naar de winkel",
        print: "Afdrukken",
      },
    },
  };
  return { path: "locales/nl.default.json", content: `${JSON.stringify(locale, null, 2)}\n` };
}

// ---------------------------------------------------------------------------
// Password-status (branded "coming soon" tijdens de launch)
// ---------------------------------------------------------------------------

/**
 * layout/password.liquid — eigen, gebrandde wachtwoordpagina. Volgt de
 * technische conventie uit de referentie-thema's (v18): een standalone
 * layout zonder header/footer-groups, mét content_for_header en
 * content_for_layout. Geen visuele elementen uit de referenties gekopieerd.
 */
function buildPasswordLayout(): ThemeFile {
  const liquid = `{% comment %}
  Gegenereerd door Silvijn Studio — deterministische password-layout voor de
  launch-fase van deze klant (Shopify password-protected storefront).
{% endcomment %}
<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ shop.name }}</title>
    {% if settings.seo_description != blank %}
      <meta name="description" content="{{ settings.seo_description | escape }}">
    {% endif %}
    <link rel="canonical" href="{{ canonical_url }}">
    {%- if settings.favicon != blank -%}
      <link rel="icon" type="image/png" href="{{ settings.favicon | image_url: width: 48 }}">
    {%- endif -%}
    {% style %}
      :root {
        --color-primary: {{ settings.color_primary }};
        --color-accent: {{ settings.color_accent }};
        --color-background: {{ settings.color_background }};
        --color-text: {{ settings.color_text }};
        --radius: 10px;
      }
      *, *::before, *::after { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: var(--color-background);
        color: var(--color-text);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        line-height: 1.6;
      }
      .gate { width: 100%; max-width: 460px; text-align: center; }
      .gate__brand { font-weight: 700; letter-spacing: .02em; }
      .gate__title { margin: 12px 0 8px; font-size: 1.6rem; line-height: 1.3; }
      .gate__message { margin: 0 0 24px; color: var(--color-text); opacity: .8; }
      .gate__form { display: flex; flex-direction: column; gap: 12px; }
      .gate__form input {
        width: 100%;
        padding: 12px 14px;
        border: 1px solid var(--color-text);
        border-radius: var(--radius);
        font: inherit;
        background: transparent;
        color: inherit;
      }
      .gate__form input:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 0; }
      .gate__submit {
        padding: 12px 20px;
        border: 0;
        border-radius: var(--radius);
        background: var(--color-primary);
        color: #fff;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      .gate__submit:hover, .gate__submit:focus-visible { background: var(--color-accent); }
      .gate__errors { color: var(--color-accent); font-weight: 600; margin: 0; }
      .gate__hint { margin-top: 16px; font-size: .9rem; opacity: .7; }
    {% endstyle %}
    {{ content_for_header }}
  </head>
  <body>
    {{ content_for_layout }}
  </body>
</html>
`;
  return { path: "layout/password.liquid", content: liquid };
}

/**
 * templates/password.liquid — de inhoud van de password-pagina: merknaam,
 * de wachtwoordboodschap die de merchant zelf in Shopify instelt (met een
 * neutrale Nederlandse fallback), en het storefront_password-formulier.
 * Geen verzonnen bedrijfsinformatie.
 */
function buildPasswordTemplate(): ThemeFile {
  const liquid = `{%- comment -%}
  De boodschap op de wachtwoordpagina komt uit shop.password_message
  (ingesteld door de merchant in de Shopify-admin).
{%- endcomment -%}
<div class="gate">
  <p class="gate__brand">{{ settings.brand_name | default: shop.name }}</p>
  <h1 class="gate__title">{{ shop.password_message | default: "Binnenkort online" }}</h1>
  {% form 'storefront_password' %}
    {{ form.errors | default_errors }}
    <div class="gate__form">
      <label class="visually-hidden" for="Password">{{ 'general.password_page.login_form_password' | t }}</label>
      <input type="password" name="password" id="Password" autocomplete="current-password" placeholder="Wachtwoord">
      <button type="submit" class="gate__submit">{{ 'general.password_page.login_form_button' | t }}</button>
    </div>
  {% endform %}
  <p class="gate__hint">{{ 'general.password_page.admin_link_html' | t }}</p>
</div>
`;
  return { path: "templates/password.liquid", content: liquid };
}

// ---------------------------------------------------------------------------
// Klantaccounts (webshop-functionaliteit; inerte systeempagina's die pas
// renderen zodra de merchant klantaccounts activeert) + cadeaubon
// ---------------------------------------------------------------------------

/** Gemeenschappelijke pagina-opening voor klantaccountpagina's. */
function customersPageOpen(title: string): string {
  return `{%- comment -%}
  Klantaccountpagina — rendert uitsluitend zodra de merchant klantaccounts
  heeft geactiveerd. Neutraal, gebrand door de thema-tokens.
{%- endcomment -%}
<section class="account">
  <div class="container">
    <header class="account__header">
      <h1>${title}</h1>
    </header>
`;
}

function buildCustomersLoginPage(): ThemeFile {
  const liquid = `{%- comment -%} Klantlogin; gasten kunnen direct verder afrekenen. {%- endcomment -%}
<section class="account">
  <div class="container">
    <header class="account__header">
      <h1>{{ 'customers.login_page.title' | t }}</h1>
    </header>
    <div class="account__grid">
      <div class="account__card">
        <h2>{{ 'customers.login_page.login' | t }}</h2>
        {% form 'customer_login' %}
          {{ form.errors | default_errors }}
          <div class="field">
            <label for="CustomerEmail">{{ 'customers.login_page.email' | t }}</label>
            <input type="email" name="customer[email]" id="CustomerEmail" autocomplete="email" required>
          </div>
          <div class="field">
            <label for="CustomerPassword">{{ 'customers.login_page.password' | t }}</label>
            <input type="password" name="customer[password]" id="CustomerPassword" autocomplete="current-password" required>
          </div>
          <button type="submit" class="btn btn--primary">{{ 'customers.login_page.login' | t }}</button>
        {% endform %}
        <p><a href="{{ routes.account_recover_url }}">{{ 'customers.login_page.forgot_password' | t }}</a></p>
      </div>
      <div class="account__card">
        <h2>{{ 'customers.login_page.new_customer' | t }}</h2>
        <p class="account__empty">{{ 'customers.login_page.no_account_yet' | t }}</p>
        <a class="btn btn--secondary" href="{{ routes.account_register_url }}">{{ 'customers.login_page.create_account' | t }}</a>
      </div>
    </div>
    {% form 'guest_login' %}
      <div class="account__actions">
        <button type="submit" class="btn btn--secondary">{{ 'customers.login_page.guest_title' | t }}</button>
      </div>
    {% endform %}
  </div>
</section>
`;
  return { path: "templates/customers/login.liquid", content: liquid };
}

function buildCustomersRegisterPage(): ThemeFile {
  const liquid = `{%- comment -%} Nieuw klantaccount aanmaken. {%- endcomment -%}
<section class="account">
  <div class="container">
    <header class="account__header">
      <h1>{{ 'customers.register_page.title' | t }}</h1>
    </header>
    <div class="account__card" style="max-width: 520px;">
      {% form 'create_customer' %}
        {{ form.errors | default_errors }}
        <div class="field">
          <label for="RegisterFirstName">{{ 'customers.register_page.first_name' | t }}</label>
          <input type="text" name="customer[first_name]" id="RegisterFirstName" autocomplete="given-name">
        </div>
        <div class="field">
          <label for="RegisterLastName">{{ 'customers.register_page.last_name' | t }}</label>
          <input type="text" name="customer[last_name]" id="RegisterLastName" autocomplete="family-name">
        </div>
        <div class="field">
          <label for="RegisterEmail">{{ 'customers.register_page.email' | t }}</label>
          <input type="email" name="customer[email]" id="RegisterEmail" autocomplete="email" required>
        </div>
        <div class="field">
          <label for="RegisterPassword">{{ 'customers.register_page.password' | t }}</label>
          <input type="password" name="customer[password]" id="RegisterPassword" autocomplete="new-password" required>
        </div>
        <button type="submit" class="btn btn--primary">{{ 'customers.register_page.submit' | t }}</button>
      {% endform %}
      <p><a href="{{ routes.account_login_url }}">{{ 'customers.register_page.back_to_login' | t }}</a></p>
    </div>
  </div>
</section>
`;
  return { path: "templates/customers/register.liquid", content: liquid };
}

function buildCustomersAccountPage(): ThemeFile {
  const liquid = `${customersPageOpen("{{ 'customers.account.title' | t }}")}
    <div class="account__grid">
      <div class="account__card">
        <h2>{{ 'customers.account.details' | t }}</h2>
        <p class="account__meta">{{ customer.name }}</p>
        <p class="account__meta">{{ customer.email }}</p>
        <a class="btn btn--secondary" href="{{ routes.account_addresses_url }}">{{ 'customers.account.view_addresses' | t }} ({{ customer.addresses_count }})</a>
      </div>
      <div class="account__card">
        <h2>{{ 'customers.account.orders_title' | t }}</h2>
        {% if customer.orders_count == 0 %}
          <p class="account__empty">{{ 'customers.account.no_orders' | t }}</p>
        {% else %}
          <table>
            <thead>
              <tr><th>{{ 'customers.order.order' | t }}</th><th>{{ 'customers.order.date' | t }}</th><th>{{ 'customers.order.total' | t }}</th></tr>
            </thead>
            <tbody>
              {% for order in customer.orders %}
                <tr>
                  <td><a href="{{ order.customer_url }}">{{ order.name }}</a></td>
                  <td>{{ order.created_at | date: "%d-%m-%Y" }}</td>
                  <td>{{ order.total_price | money }}</td>
                </tr>
              {% endfor %}
            </tbody>
          </table>
        {% endif %}
      </div>
    </div>
    <div class="account__actions">
      <a class="btn btn--secondary" href="{{ routes.account_logout_url }}">{{ 'customers.account.logout' | t }}</a>
    </div>
  </div>
</section>
`;
  return { path: "templates/customers/account.liquid", content: liquid };
}

function buildCustomersOrderPage(): ThemeFile {
  const liquid = `${customersPageOpen("{{ 'customers.order.title' | t }} {{ order.name }}")}
    <p class="account__meta">{{ 'customers.order.date' | t }}: {{ order.created_at | date: "%d-%m-%Y" }}</p>
    <p class="account__meta">
      <span class="account__status">{{ order.financial_status_label }}</span>
      <span class="account__status">{{ order.fulfillment_status_label }}</span>
    </p>
    <table>
      <thead>
        <tr><th>{{ 'customers.order.product' | t }}</th><th>{{ 'customers.order.quantity' | t }}</th><th>{{ 'customers.order.total' | t }}</th></tr>
      </thead>
      <tbody>
        {% for line_item in order.line_items %}
          <tr>
            <td>{{ line_item.title }}</td>
            <td>{{ line_item.quantity }}</td>
            <td>{{ line_item.final_line_price | money }}</td>
          </tr>
        {% endfor %}
      </tbody>
      <tfoot>
        <tr><td colspan="2">{{ 'customers.order.subtotal' | t }}</td><td>{{ order.line_items_subtotal_price | money }}</td></tr>
        {% for shipping_method in order.shipping_methods %}
          <tr><td colspan="2">{{ shipping_method.title }}</td><td>{{ shipping_method.price | money }}</td></tr>
        {% endfor %}
        {% for tax_line in order.tax_lines %}
          <tr><td colspan="2">{{ tax_line.title }} ({{ tax_line.rate | times: 100 }}%)</td><td>{{ tax_line.price | money }}</td></tr>
        {% endfor %}
        <tr><td colspan="2"><strong>{{ 'customers.order.total' | t }}</strong></td><td><strong>{{ order.total_price | money }}</strong></td></tr>
      </tfoot>
    </table>
    <h2>{{ 'customers.order.billing_address' | t }}</h2>
    <p class="account__meta">{{ order.billing_address | format_address }}</p>
    <h2>{{ 'customers.order.shipping_address' | t }}</h2>
    <p class="account__meta">{{ order.shipping_address | format_address }}</p>
  </div>
</section>
`;
  return { path: "templates/customers/order.liquid", content: liquid };
}

function buildCustomersAddressesPage(): ThemeFile {
  const liquid = `${customersPageOpen("{{ 'customers.addresses.title' | t }}")}
    {% if customer.addresses.size == 0 %}
      <p class="account__empty">{{ 'customers.addresses.no_addresses' | t }}</p>
    {% endif %}
    {% for address in customer.addresses %}
      <div class="account__card">
        <p class="account__meta">{{ address | format_address }}</p>
        {% if address == customer.default_address %}
          <p class="account__meta"><span class="account__status">{{ 'customers.addresses.default' | t }}</span></p>
        {% endif %}
        {% form 'customer_address', address %}
          <div class="field">
            <label for="AddressFirstName_{{ forloop.index }}">{{ 'customers.addresses.first_name' | t }}</label>
            <input type="text" name="address[first_name]" id="AddressFirstName_{{ forloop.index }}" value="{{ address.first_name }}" autocomplete="given-name">
          </div>
          <div class="field">
            <label for="AddressLastName_{{ forloop.index }}">{{ 'customers.addresses.last_name' | t }}</label>
            <input type="text" name="address[last_name]" id="AddressLastName_{{ forloop.index }}" value="{{ address.last_name }}" autocomplete="family-name">
          </div>
          <div class="field">
            <label for="AddressCompany_{{ forloop.index }}">{{ 'customers.addresses.company' | t }}</label>
            <input type="text" name="address[company]" id="AddressCompany_{{ forloop.index }}" value="{{ address.company }}" autocomplete="organization">
          </div>
          <div class="field">
            <label for="AddressAddress1_{{ forloop.index }}">{{ 'customers.addresses.address1' | t }}</label>
            <input type="text" name="address[address1]" id="AddressAddress1_{{ forloop.index }}" value="{{ address.address1 }}" autocomplete="address-line1">
          </div>
          <div class="field">
            <label for="AddressAddress2_{{ forloop.index }}">{{ 'customers.addresses.address2' | t }}</label>
            <input type="text" name="address[address2]" id="AddressAddress2_{{ forloop.index }}" value="{{ address.address2 }}" autocomplete="address-line2">
          </div>
          <div class="field">
            <label for="AddressCity_{{ forloop.index }}">{{ 'customers.addresses.city' | t }}</label>
            <input type="text" name="address[city]" id="AddressCity_{{ forloop.index }}" value="{{ address.city }}" autocomplete="address-level2">
          </div>
          <div class="field">
            <label for="AddressZip_{{ forloop.index }}">{{ 'customers.addresses.zip' | t }}</label>
            <input type="text" name="address[zip]" id="AddressZip_{{ forloop.index }}" value="{{ address.zip }}" autocomplete="postal-code">
          </div>
          <div class="field">
            <label for="AddressPhone_{{ forloop.index }}">{{ 'customers.addresses.phone' | t }}</label>
            <input type="tel" name="address[phone]" id="AddressPhone_{{ forloop.index }}" value="{{ address.phone }}" autocomplete="tel">
          </div>
          {{ form.errors | default_errors }}
          <div class="account__actions">
            <button type="submit" class="btn btn--secondary">{{ 'customers.addresses.update' | t }}</button>
          </div>
        {% endform %}
        {% form 'customer_address', address %}
          <input type="hidden" name="address[default]" value="true">
          <div class="account__actions">
            <button type="submit" class="btn btn--secondary">{{ 'customers.addresses.set_default' | t }}</button>
          </div>
        {% endform %}
        {% form 'customer_address', address %}
          <input type="hidden" name="_method" value="delete">
          <div class="account__actions">
            <button type="submit" class="btn btn--secondary">{{ 'customers.addresses.delete' | t }}</button>
          </div>
        {% endform %}
      </div>
    {% endfor %}
    <h2>{{ 'customers.addresses.add_new' | t }}</h2>
    <div class="account__card">
      {% form 'customer_address', customer.new_address %}
        <div class="field">
          <label for="NewAddressFirstName">{{ 'customers.addresses.first_name' | t }}</label>
          <input type="text" name="address[first_name]" id="NewAddressFirstName" autocomplete="given-name">
        </div>
        <div class="field">
          <label for="NewAddressLastName">{{ 'customers.addresses.last_name' | t }}</label>
          <input type="text" name="address[last_name]" id="NewAddressLastName" autocomplete="family-name">
        </div>
        <div class="field">
          <label for="NewAddressAddress1">{{ 'customers.addresses.address1' | t }}</label>
          <input type="text" name="address[address1]" id="NewAddressAddress1" autocomplete="address-line1">
        </div>
        <div class="field">
          <label for="NewAddressCity">{{ 'customers.addresses.city' | t }}</label>
          <input type="text" name="address[city]" id="NewAddressCity" autocomplete="address-level2">
        </div>
        <div class="field">
          <label for="NewAddressZip">{{ 'customers.addresses.zip' | t }}</label>
          <input type="text" name="address[zip]" id="NewAddressZip" autocomplete="postal-code">
        </div>
        <div class="field">
          <label for="NewAddressPhone">{{ 'customers.addresses.phone' | t }}</label>
          <input type="tel" name="address[phone]" id="NewAddressPhone" autocomplete="tel">
        </div>
        {{ form.errors | default_errors }}
        <button type="submit" class="btn btn--primary">{{ 'customers.addresses.add_address' | t }}</button>
      {% endform %}
    </div>
  </div>
</section>
`;
  return { path: "templates/customers/addresses.liquid", content: liquid };
}

function buildCustomersActivateAccountPage(): ThemeFile {
  const liquid = `${customersPageOpen("{{ 'customers.activate_account_page.title' | t }}")}
    <div class="account__card" style="max-width: 520px;">
      {% form 'activate_customer_password' %}
        {{ form.errors | default_errors }}
        <div class="field">
          <label for="ActivatePassword">{{ 'customers.activate_account_page.password' | t }}</label>
          <input type="password" name="customer[password]" id="ActivatePassword" autocomplete="new-password" required>
        </div>
        <div class="field">
          <label for="ActivatePasswordConfirm">{{ 'customers.activate_account_page.password_confirm' | t }}</label>
          <input type="password" name="customer[password_confirmation]" id="ActivatePasswordConfirm" autocomplete="new-password" required>
        </div>
        <div class="account__actions">
          <button type="submit" class="btn btn--primary">{{ 'customers.activate_account_page.submit' | t }}</button>
        </div>
      {% endform %}
    </div>
  </div>
</section>
`;
  return { path: "templates/customers/activate_account.liquid", content: liquid };
}

function buildCustomersResetPasswordPage(): ThemeFile {
  const liquid = `${customersPageOpen("{{ 'customers.reset_password_page.title' | t }}")}
    <div class="account__card" style="max-width: 520px;">
      {% form 'recover_customer_password' %}
        {{ form.errors | default_errors }}
        <div class="field">
          <label for="RecoverEmail">{{ 'customers.reset_password_page.email' | t }}</label>
          <input type="email" name="email" id="RecoverEmail" autocomplete="email" required>
        </div>
        <div class="account__actions">
          <button type="submit" class="btn btn--primary">{{ 'customers.reset_password_page.submit' | t }}</button>
        </div>
      {% endform %}
    </div>
  </div>
</section>
`;
  return { path: "templates/customers/reset_password.liquid", content: liquid };
}

/**
 * templates/gift_card.liquid — cadeaubonpagina. Volgt de technische
 * conventie (standalone print-pagina via {% layout none %}); toont uitsluitend
 * echte gift_card-objectdata, geen verzonnen waarden.
 */
function buildGiftCardTemplate(): ThemeFile {
  const liquid = `{%- comment -%}
  Cadeaubonpagina — standalone (geen thema-layout) zodat de bon printvriendelijk
  is. Alle waarden komen uit het gift_card-object van Shopify.
{%- endcomment -%}
{% layout none %}
<!doctype html>
<html lang="{{ request.locale.iso_code }}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ gift_card.initial_value | money }} — {{ shop.name }}</title>
    {%- if gift_card.enabled == false or gift_card.expired -%}
      <meta name="robots" content="noindex, nofollow">
    {%- endif -%}
    {% style %}
      *, *::before, *::after { box-sizing: border-box; }
      body { margin: 0; padding: 24px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2328; }
      .giftcard { max-width: 560px; margin-inline: auto; text-align: center; }
      .giftcard__brand { font-weight: 700; }
      .giftcard__code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 1.6rem; letter-spacing: .25em;
        border: 2px dashed currentColor; border-radius: 12px;
        padding: 16px 12px; margin: 16px 0;
      }
      .giftcard__value { font-size: 1.3rem; margin: 8px 0; }
      .giftcard__meta { opacity: .75; margin: 4px 0; }
      .giftcard__status { font-weight: 600; }
      .giftcard__actions { margin-top: 20px; }
      @media print { .giftcard__actions { display: none; } }
    {% endstyle %}
  </head>
  <body>
    <div class="giftcard">
      <p class="giftcard__brand">{{ shop.name }}</p>
      <h1>{{ 'gift_cards.issued.title' | t }}</h1>
      <p class="giftcard__code">{{ gift_card.code | format_code }}</p>
      <p class="giftcard__value">{{ gift_card.initial_value | money }}</p>
      {%- if gift_card.balance != gift_card.initial_value -%}
        <p class="giftcard__meta">{{ 'gift_cards.issued.remaining_html' | t }}: {{ gift_card.balance | money }}</p>
      {%- endif -%}
      {%- if gift_card.enabled == false -%}
        <p class="giftcard__status">{{ 'gift_cards.issued.disabled' | t }}</p>
      {%- endif -%}
      {%- if gift_card.expired -%}
        <p class="giftcard__status">{{ 'gift_cards.issued.expired' | t }}</p>
      {%- elsif gift_card.expires_on != blank -%}
        <p class="giftcard__meta">{{ 'gift_cards.issued.expires_on' | t }}: {{ gift_card.expires_on | date: "%d-%m-%Y" }}</p>
      {%- endif -%}
      <div class="giftcard__actions">
        <a class="giftcard__link" href="{{ shop.url }}">{{ 'gift_cards.issued.shop_link' | t }}</a>
        <button type="button" onclick="window.print()">{{ 'gift_cards.issued.print' | t }}</button>
      </div>
    </div>
  </body>
</html>
`;
  return { path: "templates/gift_card.liquid", content: liquid };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * HEADER (D2, verplichte core component) — meerdere ECHTE layoutvarianten
 * (minimal / centered / split / overlay-transparant), logo-afbeelding met
 * tekstfallback, optionele CTA, sticky-stand met scrolled-state (JS voegt
 * .site-header--scrolled toe), mobiel fullscreen-menu, active navigation
 * state (aria-current via theme.js) en contrastbehandeling voor de
 * overlay-variant. De AI kiest de variant via het artDirection-contract
 * (headerStyle); de merchant kan hem altijd overschakelen.
 */
function buildHeaderSection(): ThemeFile {
  const liquid = `<header class="site-header site-header--{{ section.settings.layout | default: 'minimal' }}{% if section.settings.sticky %} site-header--sticky{% endif %}" data-site-header>
  <div class="container site-header__inner">
    <a class="site-header__brand" href="/">
      {%- if section.settings.logo != blank -%}
        {{ section.settings.logo | image_url: width: 180 | image_tag: widths: '120,180,240', alt: section.settings.brand_text | default: shop.name, class: 'site-header__logo' }}
      {%- else -%}
        {{ section.settings.brand_text | default: shop.name }}
      {%- endif -%}
    </a>
    <nav class="site-nav" id="site-nav" data-nav aria-label="{{ 'general.menu' | t }}">
      {%- for block in section.blocks -%}
        <a href="{{ block.settings.link }}" {{ block.shopify_attributes }}>
          {{ block.settings.label }}
        </a>
      {%- endfor -%}
    </nav>
    <div class="site-header__actions">
      {%- if section.settings.show_cta -%}
        <a class="btn btn--primary site-header__cta" href="{{ section.settings.cta_link | default: '/pages/contact' }}">
          {{ section.settings.cta_label }}
        </a>
      {%- endif -%}
      <button type="button" class="btn btn--secondary header-nav-toggle" data-nav-toggle aria-expanded="false" aria-controls="site-nav" aria-label="{{ 'general.menu' | t }}">
        <span class="header-nav-toggle__bar"></span>
        <span class="header-nav-toggle__bar"></span>
        <span class="header-nav-toggle__bar"></span>
      </button>
    </div>
  </div>
</header>

{% schema %}
{
  "name": "Header",
  "settings": [
    {
      "type": "select",
      "id": "layout",
      "label": "Layoutvariant",
      "default": "minimal",
      "options": [
        { "value": "minimal", "label": "Strak (logo links, nav rechts)" },
        { "value": "centered", "label": "Gecentreerd (nav centraal)" },
        { "value": "split", "label": "Gesplitst (nav links, logo centraal)" },
        { "value": "overlay", "label": "Transparant over hero" }
      ]
    },
    { "type": "checkbox", "id": "sticky", "label": "Vast (sticky) bovenaan", "default": true },
    { "type": "image_picker", "id": "logo", "label": "Logo (optioneel; anders merknaam als tekst)" },
    { "type": "text", "id": "brand_text", "label": "Merknaam" },
    { "type": "checkbox", "id": "show_cta", "label": "CTA-knop tonen", "default": true },
    { "type": "text", "id": "cta_label", "label": "CTA-tekst", "default": "Contact" },
    { "type": "url", "id": "cta_link", "label": "CTA-link" }
  ],
  "blocks": [
    {
      "type": "nav_item",
      "name": "Navigatie-item",
      "settings": [
        { "type": "text", "id": "label", "label": "Label" },
        { "type": "url", "id": "link", "label": "Link" }
      ]
    }
  ],
  "presets": [{ "name": "Header" }]
}
{% endschema %}
`;
  return { path: "sections/header.liquid", content: liquid };
}

function buildFooterSection(): ThemeFile {
  const liquid = `<footer class="site-footer">
  <div class="container site-footer__inner">
    <div>
      <p>{{ section.settings.about_text }}</p>
    </div>
    <div>
      {%- if section.settings.phone != blank -%}
        <p>{{ 'contact.call_us' | t }}: <a href="tel:{{ section.settings.phone | remove: ' ' }}">{{ section.settings.phone }}</a></p>
      {%- endif -%}
      {%- if section.settings.email != blank -%}
        <p>{{ 'contact.email_us' | t }}: <a href="mailto:{{ section.settings.email }}">{{ section.settings.email }}</a></p>
      {%- endif -%}
      {%- if section.settings.address != blank -%}
        <p>{{ 'contact.visit_us' | t }}: {{ section.settings.address }}</p>
      {%- endif -%}
    </div>
    <div>
      <p>&copy; {{ 'now' | date: '%Y' }} {{ shop.name }}. {{ section.settings.tagline }}</p>
    </div>
  </div>
</footer>

{% schema %}
{
  "name": "Footer",
  "settings": [
    { "type": "textarea", "id": "about_text", "label": "Korte omschrijving" },
    { "type": "text", "id": "tagline", "label": "Slotregel" },
    { "type": "text", "id": "phone", "label": "Telefoonnummer" },
    { "type": "text", "id": "email", "label": "E-mailadres" },
    { "type": "text", "id": "address", "label": "Adres" }
  ],
  "presets": [{ "name": "Footer" }]
}
{% endschema %}
`;
  return { path: "sections/footer.liquid", content: liquid };
}

function buildHeroSection(): ThemeFile {
  const liquid = `{%- liquid
  assign hero_layout = section.settings.layout | default: settings.hero_layout | default: 'focused'
-%}
<section class="hero hero--{{ hero_layout }} section--bg-{{ section.settings.background | default: 'default' }} motion--{{ section.settings.motion | default: 'none' }}">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: section.settings.image_alt, placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="hero__inner">
      <div class="hero__content">
        {%- if section.settings.eyebrow != blank -%}
          <p class="hero__eyebrow">{{ section.settings.eyebrow }}</p>
        {%- endif -%}
        <h1>{{ section.settings.heading }}</h1>
        {%- if section.settings.subheading != blank -%}
          <p>{{ section.settings.subheading }}</p>
        {%- endif -%}
        <div class="hero__actions">
          <a class="btn btn--primary" href="{{ section.settings.cta_link | default: '/pages/contact' }}">{{ section.settings.cta_label }}</a>
          {%- if section.settings.cta_secondary_label != blank -%}
            <a class="btn btn--secondary" href="{{ section.settings.cta_secondary_link | default: '#main-content' }}">{{ section.settings.cta_secondary_label }}</a>
          {%- endif -%}
        </div>
      </div>
      {%- if hero_layout == 'split' -%}
        <div class="hero__media">
          {%- render 'theme-media', image: section.settings.image, image_mobile: section.settings.image_mobile, aspect: 'wide', alt: section.settings.image_alt, sizes: '(min-width: 990px) 50vw, 100vw', loading: 'eager', fetchpriority: 'high', placeholder_svg: 'placeholder-hero.svg' -%}
        </div>
      {%- endif -%}
    </div>
    {%- if hero_layout != 'split' and hero_layout != 'immersive' -%}
      <div class="hero__band">
        {%- render 'theme-media', image: section.settings.image, image_mobile: section.settings.image_mobile, aspect: 'wide', alt: section.settings.image_alt, sizes: '100vw', loading: 'eager', fetchpriority: 'high', placeholder_svg: 'placeholder-hero.svg' -%}
      </div>
    {%- endif -%}
  </div>
</section>

{% schema %}
{
  "name": "Hero",
  "settings": [

${blueprintVariantSettings("hero", "default")},
        { "type": "text", "id": "eyebrow", "label": "Label boven de kop" },
    { "type": "text", "id": "heading", "label": "Hoofdkop" },
    { "type": "textarea", "id": "subheading", "label": "Subkop" },
    { "type": "text", "id": "cta_label", "label": "CTA-tekst" },
    { "type": "url", "id": "cta_link", "label": "CTA-link" },
    { "type": "text", "id": "cta_secondary_label", "label": "Secondaire CTA-tekst" },
    { "type": "url", "id": "cta_secondary_link", "label": "Secondaire CTA-link" },
    { "type": "image_picker", "id": "image", "label": "Hero-afbeelding (optioneel)" },
    { "type": "image_picker", "id": "image_mobile", "label": "Hero-afbeelding mobiel (optioneel)" },
    { "type": "text", "id": "image_alt", "label": "Alt-tekst afbeelding" }
  ],
  "presets": [{ "name": "Hero" }]
}
{% endschema %}
`;
  return { path: "sections/hero.liquid", content: liquid };
}

/**
 * Centrale media-renderer (R1). Alle beeldsloten (hero/about/services/gallery)
 * renderen via dit snippet: echte afbeeldingen krijgen Shopify-srcset
 * (widths/sizes, focal point, aparte mobiele variant), zonder afbeelding
 * verschijnt een abstracte, token-afgeleide placeholder (decoratief, geen
 * gesimuleerde foto). Bestaat dus altijd in het thema.
 */
function buildThemeMediaSnippet(): ThemeFile {
  const liquid = `{% comment %}
  Centrale media-renderer. Parameters:
  image, image_mobile (image_picker), aspect (wide|landscape|landscape_4_3|square|portrait|portrait_3_4|tall),
  alt, sizes, loading (eager|lazy), fetchpriority (high|auto),
  placeholder_svg (asset-naam voor de abstracte placeholder).
{% endcomment %}
{%- liquid
  assign media_loading = loading | default: 'lazy'
  assign media_aspect = aspect | default: 'wide'
  assign fallback_svg = placeholder_svg | default: 'placeholder.svg'
  assign placeholder_w = 1500
  assign placeholder_h = 845
  if media_aspect == 'landscape' or media_aspect == 'landscape_4_3'
    assign placeholder_w = 1200
    assign placeholder_h = 900
  elsif media_aspect == 'square'
    assign placeholder_w = 1000
    assign placeholder_h = 1000
  elsif media_aspect == 'portrait' or media_aspect == 'portrait_3_4'
    assign placeholder_w = 900
    assign placeholder_h = 1200
  elsif media_aspect == 'tall'
    assign placeholder_w = 800
    assign placeholder_h = 1200
  endif
-%}
{%- if image != blank -%}
  <div class="theme-media theme-media--{{ media_aspect }}" {% if image.presentation.focal_point %}style="--media-focal: {{ image.presentation.focal_point }}"{% endif %}>
    {%- if image_mobile != blank and image_mobile != image -%}
      <picture>
        <source media="(max-width: 749px)" srcset="{{ image_mobile | image_url: width: 750 }}">
        {{ image | image_url: width: 1500 | image_tag: widths: '480, 750, 1100, 1500', sizes: sizes, alt: alt, class: 'theme-media__img', loading: media_loading, fetchpriority: fetchpriority }}
      </picture>
    {%- else -%}
      {{ image | image_url: width: 1500 | image_tag: widths: '480, 750, 1100, 1500', sizes: sizes, alt: alt, class: 'theme-media__img', loading: media_loading, fetchpriority: fetchpriority }}
    {%- endif -%}
  </div>
{%- else -%}
  <div class="theme-media theme-media--{{ media_aspect }} theme-media--placeholder">
    <img src="{{ fallback_svg | asset_url }}" alt="" role="presentation" width="{{ placeholder_w }}" height="{{ placeholder_h }}" loading="{{ media_loading }}" decoding="async">
  </div>
{%- endif -%}
`;
  return { path: "snippets/theme-media.liquid", content: liquid };
}

/**
 * Sectie-achtergrondmedia (Rendering-stap 1): de ÉCHTE media-laag voor de
 * blueprint-achtergrondvariant "image". Altijd een daadwerkelijke
 * media-weergave — de gekozen afbeelding (met focal point via theme-media)
 * of, zonder afbeelding, de abstracte token-afgeleide placeholder — en
 * nooit een gradient-fallback. De per sectie instelbare overlay garandeert
 * tekstcontrast; aria-hidden omdat de laag puur decoratief is.
 */
function buildSectionBackgroundSnippet(): ThemeFile {
  const liquid = `{% comment %}
  Achtergrondmedia-laag voor secties met achtergrondvariant "image".
  Parameters: image (image_picker), overlay (0-100), alt, placeholder_svg.
  Zonder afbeelding rendert de abstracte placeholder (geen gradient).
{% endcomment %}
{%- assign alt = alt | default: '' -%}
<div class="section__background" aria-hidden="true">
  {%- render 'theme-media', image: image, aspect: 'wide', alt: alt, sizes: '100vw', loading: 'eager', placeholder_svg: placeholder_svg -%}
  <div class="section__background-overlay" style="opacity: {{ overlay | default: 45 | divided_by: 100.0 }}"></div>
</div>
`;
  return { path: "snippets/section-background.liquid", content: liquid };
}

function buildServicesSection(): ThemeFile {
  const liquid = `<section class="section services services--{{ section.settings.layout | default: 'grid' }} section--bg-{{ section.settings.background | default: 'default' }} motion--{{ section.settings.motion | default: 'none' }}">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: section.settings.heading, placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="section__header">
      <h2>{{ section.settings.heading }}</h2>
      {%- if section.settings.subheading != blank -%}
        <p>{{ section.settings.subheading }}</p>
      {%- endif -%}
    </div>
    <div class="card-grid">
      {%- for block in section.blocks -%}
        <article class="card card--media" {{ block.shopify_attributes }}>
          <div class="card__media">
            {%- render 'theme-media', image: block.settings.image, aspect: 'landscape', sizes: '(min-width: 990px) 360px, 100vw', loading: 'lazy', placeholder_svg: 'placeholder-service.svg' -%}
          </div>
          <div class="card__body">
            <h3>{{ block.settings.title }}</h3>
            {%- if block.settings.description != blank -%}
              <p>{{ block.settings.description }}</p>
            {%- endif -%}
          </div>
        </article>
      {%- endfor -%}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Diensten",
  "settings": [

${blueprintVariantSettings("services", "default")},
        { "type": "text", "id": "heading", "label": "Kop", "default": "Onze diensten" },
    { "type": "textarea", "id": "subheading", "label": "Subkop" }
  ],
  "blocks": [
    {
      "type": "service",
      "name": "Dienst",
      "settings": [
        { "type": "image_picker", "id": "image", "label": "Afbeelding (optioneel)" },
        { "type": "text", "id": "title", "label": "Titel" },
        { "type": "textarea", "id": "description", "label": "Omschrijving" }
      ]
    }
  ],
  "presets": [
    { "name": "Diensten", "blocks": [{ "type": "service" }, { "type": "service" }, { "type": "service" }] }
  ]
}
{% endschema %}
`;
  return { path: "sections/services.liquid", content: liquid };
}

function buildAboutSection(): ThemeFile {
  const liquid = `<section class="section about about--{{ section.settings.layout | default: 'split' }} section--bg-{{ section.settings.background | default: 'surface' }} motion--{{ section.settings.motion | default: 'none' }}">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: section.settings.heading, placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="section__header">
      <h2>{{ section.settings.heading }}</h2>
    </div>
    <div class="about__grid about__grid--media-{{ section.settings.image_position | default: 'right' }}">
      <div class="about__body rte">
        {{ section.settings.body }}
      </div>
      <div class="about__media">
        {%- render 'theme-media', image: section.settings.image, image_mobile: section.settings.image_mobile, aspect: 'landscape', alt: section.settings.image_alt, sizes: '(min-width: 990px) 480px, 100vw', loading: 'lazy', placeholder_svg: 'placeholder-about.svg' -%}
      </div>
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Over ons",
  "settings": [

${blueprintVariantSettings("about", "surface")},
        { "type": "text", "id": "heading", "label": "Kop", "default": "Over ons" },
    { "type": "richtext", "id": "body", "label": "Tekst" },
    { "type": "image_picker", "id": "image", "label": "Afbeelding (optioneel)" },
    { "type": "image_picker", "id": "image_mobile", "label": "Afbeelding mobiel (optioneel)" },
    { "type": "text", "id": "image_alt", "label": "Alt-tekst afbeelding" },
    {
      "type": "select",
      "id": "image_position",
      "label": "Positie afbeelding",
      "default": "right",
      "options": [
        { "value": "left", "label": "Links" },
        { "value": "right", "label": "Rechts" }
      ]
    }
  ],
  "presets": [{ "name": "Over ons" }]
}
{% endschema %}
`;
  return { path: "sections/about.liquid", content: liquid };
}

/**
 * Galerij-sectie (R1) — wordt uitsluitend geinstantieerd als de AI een
 * gallery-achtig beeldvereiste heeft gepland; de sectie zelf is een
 * gecontroleerd component met image_picker-blokken. Zonder echte beelden:
 * abstracte, token-afgeleide placeholders (nooit stock-foto's).
 */
function buildGallerySection(): ThemeFile {
  const liquid = `<section class="section gallery gallery--{{ section.settings.layout | default: 'grid' }} section--bg-{{ section.settings.background | default: 'default' }} motion--{{ section.settings.motion | default: 'none' }}">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: section.settings.heading, placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="section__header">
      <h2>{{ section.settings.heading }}</h2>
      {%- if section.settings.subheading != blank -%}
        <p>{{ section.settings.subheading }}</p>
      {%- endif -%}
    </div>
    <div class="gallery-grid">
      {%- for block in section.blocks -%}
        <figure class="gallery-item" {{ block.shopify_attributes }}>
          {%- render 'theme-media', image: block.settings.image, aspect: 'square', alt: block.settings.alt, sizes: '(min-width: 990px) 33vw, (min-width: 750px) 50vw, 100vw', loading: 'lazy', placeholder_svg: 'placeholder-gallery.svg' -%}
          {%- if block.settings.caption != blank -%}
            <figcaption class="gallery-item__caption">{{ block.settings.caption }}</figcaption>
          {%- endif -%}
        </figure>
      {%- endfor -%}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Galerij",
  "settings": [

${blueprintVariantSettings("gallery", "default")},
        { "type": "text", "id": "heading", "label": "Kop", "default": "Impressie" },
    { "type": "textarea", "id": "subheading", "label": "Subkop" }
  ],
  "blocks": [
    {
      "type": "gallery_image",
      "name": "Beeld",
      "settings": [
        { "type": "image_picker", "id": "image", "label": "Afbeelding" },
        { "type": "text", "id": "caption", "label": "Bijschrift (optioneel)" },
        { "type": "text", "id": "alt", "label": "Alt-tekst (voor echte afbeelding)" }
      ]
    }
  ],
  "presets": [
    { "name": "Galerij", "blocks": [{ "type": "gallery_image" }, { "type": "gallery_image" }, { "type": "gallery_image" }] }
  ]
}
{% endschema %}
`;
  return { path: "sections/gallery.liquid", content: liquid };
}

/**
 * Testimonials-sectie (R1) — rendert UITSLUITEND echte, in de specificatie
 * bekende uitspraken (content.testimonials). Er wordt nooit een naam, quote,
 * rol of gezicht verzonnen: auteur is een vrij veld dat alleen de merchant
 * invult met echt bekende bronnen. Portretten ontbreken bewust — er is geen
 * pad naar echte klantfoto's, dus geen gesimuleerde gezichten.
 */
function buildTestimonialsSection(): ThemeFile {
  const liquid = `{%- if section.blocks.size > 0 -%}
<section class="section testimonials testimonials--{{ section.settings.layout | default: 'band' }} section--bg-{{ section.settings.background | default: 'surface' }} motion--{{ section.settings.motion | default: 'none' }}">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: section.settings.heading, placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="section__header">
      <h2>{{ section.settings.heading }}</h2>
    </div>
    <div class="testimonial-grid">
      {%- for block in section.blocks -%}
        <blockquote class="testimonial" {{ block.shopify_attributes }}>
          <span class="testimonial__mark" aria-hidden="true">&ldquo;</span>
          <p class="testimonial__quote">{{ block.settings.quote }}</p>
          {%- if block.settings.author != blank -%}
            <p class="testimonial__author">&mdash; {{ block.settings.author }}</p>
          {%- endif -%}
        </blockquote>
      {%- endfor -%}
    </div>
  </div>
</section>
{%- endif -%}

{% schema %}
{
  "name": "Testimonials",
  "settings": [

${blueprintVariantSettings("testimonials", "surface")},
        { "type": "text", "id": "heading", "label": "Kop", "default": "Wat klanten zeggen" }
  ],
  "blocks": [
    {
      "type": "testimonial",
      "name": "Ervaring",
      "settings": [
        { "type": "textarea", "id": "quote", "label": "Echte uitspraak (uit bekende bron)" },
        { "type": "text", "id": "author", "label": "Naam (alleen indien echt bekend)" }
      ]
    }
  ],
  "presets": [
    { "name": "Testimonials", "blocks": [{ "type": "testimonial" }] }
  ]
}
{% endschema %}
`;
  return { path: "sections/testimonials.liquid", content: liquid };
}

function buildBenefitsSection(): ThemeFile {
  const liquid = `<section class="section benefits benefits--{{ section.settings.layout | default: 'grid' }} section--bg-{{ section.settings.background | default: 'default' }} motion--{{ section.settings.motion | default: 'none' }}">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: section.settings.heading, placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="section__header">
      <h2>{{ section.settings.heading }}</h2>
    </div>
    <div class="card-grid">
      {%- for block in section.blocks -%}
        <article class="card" {{ block.shopify_attributes }}>
          <p style="margin:0;font-size:1.4rem;color:var(--color-accent);font-weight:700;">{{ forloop.index }}</p>
          <h3>{{ block.settings.text }}</h3>
        </article>
      {%- endfor -%}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Voordelen",
  "settings": [

${blueprintVariantSettings("benefits", "default")},
        { "type": "text", "id": "heading", "label": "Kop", "default": "Waarom klanten voor ons kiezen" }
  ],
  "blocks": [
    {
      "type": "benefit",
      "name": "Voordeel",
      "settings": [{ "type": "text", "id": "text", "label": "Voordeel" }]
    }
  ],
  "presets": [
    { "name": "Voordelen", "blocks": [{ "type": "benefit" }, { "type": "benefit" }, { "type": "benefit" }] }
  ]
}
{% endschema %}
`;
  return { path: "sections/benefits.liquid", content: liquid };
}

function buildFaqSection(): ThemeFile {
  const liquid = `<section class="section faq faq--{{ section.settings.layout | default: 'accordion' }} section--bg-{{ section.settings.background | default: 'surface' }} motion--{{ section.settings.motion | default: 'none' }}">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: section.settings.heading, placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="section__header">
      <h2>{{ section.settings.heading }}</h2>
    </div>
    <div class="faq-list">
      {%- for block in section.blocks -%}
        <details class="faq-item" {{ block.shopify_attributes }}>
          <summary>{{ block.settings.question }}</summary>
          <div class="faq-item__body">{{ block.settings.answer }}</div>
        </details>
      {%- endfor -%}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "FAQ",
  "settings": [

${blueprintVariantSettings("faq", "surface")},
        { "type": "text", "id": "heading", "label": "Kop", "default": "Veelgestelde vragen" }
  ],
  "blocks": [
    {
      "type": "question",
      "name": "Vraag",
      "settings": [
        { "type": "text", "id": "question", "label": "Vraag" },
        { "type": "richtext", "id": "answer", "label": "Antwoord" }
      ]
    }
  ],
  "presets": [{ "name": "FAQ", "blocks": [{ "type": "question" }, { "type": "question" }] }]
}
{% endschema %}
`;
  return { path: "sections/faq.liquid", content: liquid };
}

function buildCtaSection(): ThemeFile {
  const liquid = `<section class="section cta cta--{{ section.settings.layout | default: 'band' }} section--bg-{{ section.settings.background | default: 'default' }} motion--{{ section.settings.motion | default: 'none' }}">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: section.settings.heading, placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="cta__inner">
      <div class="cta__copy">
        <h2>{{ section.settings.heading }}</h2>
        {%- if section.settings.subheading != blank -%}
          <p>{{ section.settings.subheading }}</p>
        {%- endif -%}
      </div>
      <div class="cta__action">
        <a class="btn btn--primary cta__button" href="{{ section.settings.cta_link | default: '/pages/contact' }}">{{ section.settings.cta_label }}</a>
      </div>
    </div>
  </div>
</section>

{% schema %}
{
  "name": "CTA",
  "settings": [

${blueprintVariantSettings("cta", "default")},
        { "type": "text", "id": "heading", "label": "Kop" },
    { "type": "textarea", "id": "subheading", "label": "Subkop" },
    { "type": "text", "id": "cta_label", "label": "CTA-tekst" },
    { "type": "url", "id": "cta_link", "label": "CTA-link" }
  ],
  "presets": [{ "name": "CTA" }]
}
{% endschema %}
`;
  return { path: "sections/cta.liquid", content: liquid };
}

function buildContactSection(): ThemeFile {
  const liquid = `<section class="section contact contact--{{ section.settings.layout | default: 'split' }} section--bg-{{ section.settings.background | default: 'surface' }} motion--{{ section.settings.motion | default: 'none' }}" id="contact">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: section.settings.heading, placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="section__header">
      <h2>{{ section.settings.heading }}</h2>
      {%- if section.settings.intro != blank -%}
        <p>{{ section.settings.intro }}</p>
      {%- endif -%}
    </div>
    <div class="contact-grid">
      <div class="contact__details">
        {%- if section.settings.phone != blank -%}
          <p><strong>{{ 'contact.call_us' | t }}:</strong> <a href="tel:{{ section.settings.phone | remove: ' ' }}">{{ section.settings.phone }}</a></p>
        {%- endif -%}
        {%- if section.settings.email != blank -%}
          <p><strong>{{ 'contact.email_us' | t }}:</strong> <a href="mailto:{{ section.settings.email }}">{{ section.settings.email }}</a></p>
        {%- endif -%}
        {%- if section.settings.address != blank -%}
          <p><strong>{{ 'contact.visit_us' | t }}:</strong> {{ section.settings.address }}</p>
        {%- endif -%}
      </div>
      {%- if section.settings.show_form -%}
        {%- form 'contact' -%}
          <div class="form">
            <div class="field">
              <label for="ContactFormName">{{ 'contact.name' | t }}</label>
              <input type="text" id="ContactFormName" name="contact[name]" required autocomplete="name">
            </div>
            <div class="field">
              <label for="ContactFormEmail">{{ 'contact.email' | t }}</label>
              <input type="email" id="ContactFormEmail" name="contact[email]" required autocomplete="email">
            </div>
            <div class="field">
              <label for="ContactFormPhone">{{ 'contact.phone' | t }}</label>
              <input type="tel" id="ContactFormPhone" name="contact[phone]" autocomplete="tel">
            </div>
            <div class="field">
              <label for="ContactFormMessage">{{ 'contact.message' | t }}</label>
              <textarea id="ContactFormMessage" name="contact[body]" rows="5" required></textarea>
            </div>
            {%- if form.posted_successfully? -%}
              <p class="form__status form__status--success" role="status">{{ 'contact.success' | t }}</p>
            {%- elsif form.errors -%}
              <p class="form__status form__status--error" role="alert">{{ 'contact.error' | t }}</p>
            {%- endif -%}
            <div>
              <button type="submit" class="btn btn--primary">{{ 'contact.submit' | t }}</button>
            </div>
          </div>
        {%- endform -%}
      {%- endif -%}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Contact",
  "settings": [

${blueprintVariantSettings("contact", "surface")},
        { "type": "text", "id": "heading", "label": "Kop", "default": "Contact" },
    { "type": "textarea", "id": "intro", "label": "Introductietekst" },
    { "type": "text", "id": "phone", "label": "Telefoonnummer" },
    { "type": "text", "id": "email", "label": "E-mailadres" },
    { "type": "text", "id": "address", "label": "Adres" },
    { "type": "checkbox", "id": "show_form", "label": "Contactformulier tonen", "default": true }
  ],
  "presets": [{ "name": "Contact" }]
}
{% endschema %}
`;
  return { path: "sections/contact.liquid", content: liquid };
}

function buildRichTextSection(): ThemeFile {
  const liquid = `<section class="section rich-text rich-text--{{ section.settings.layout | default: 'article' }} section--bg-{{ section.settings.background | default: 'default' }} motion--{{ section.settings.motion | default: 'none' }}">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: '', placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="rte" style="max-width:760px;">
      {{ section.settings.body }}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Tekst",
  "settings": [

${blueprintVariantSettings("rich_text", "default")},
        { "type": "richtext", "id": "body", "label": "Tekst" }
  ],
  "presets": [{ "name": "Tekst" }]
}
{% endschema %}
`;
  return { path: "sections/rich-text.liquid", content: liquid };
}


// ---------------------------------------------------------------------------
// Fase C: blueprint-secties die vóór de compositie geen liquid-bestand hadden.
// Elke sectie volgt de SECTION-REGISTRY: layoutvarianten als select-setting
// (registry = bron), bloktypes exact zoals de compositie ze instantieert,
// beeldsloten via het centrale theme-media-snippet (R1). Content komt nooit
// uit AI: de compositie vult settings/blocks deterministisch, lege velden
// vult de merchant of de latere content-pass.
// ---------------------------------------------------------------------------

function buildUspBandSection(): ThemeFile {
  const liquid = `<section class="section usp-band usp-band--{{ section.settings.layout | default: 'row' }} section--bg-{{ section.settings.background | default: 'surface' }} motion--{{ section.settings.motion | default: 'none' }}">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: '', placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="usp-row">
      {%- for block in section.blocks -%}
        <div class="usp-item" {{ block.shopify_attributes }}>
          {%- if block.settings.label != blank -%}
            <p class="usp-item__label">{{ block.settings.label }}</p>
          {%- endif -%}
          {%- if block.settings.description != blank -%}
            <p class="usp-item__description">{{ block.settings.description }}</p>
          {%- endif -%}
        </div>
      {%- endfor -%}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "USP-band",
  "settings": [
${blueprintVariantSettings("usp_band", "surface")}
  ],
  "blocks": [
    {
      "type": "usp",
      "name": "Verkoopargument",
      "settings": [
        { "type": "text", "id": "label", "label": "Argument (alleen echte USP's)" },
        { "type": "textarea", "id": "description", "label": "Toelichting (optioneel)" }
      ]
    }
  ],
  "presets": [{ "name": "USP-band", "blocks": [{ "type": "usp" }, { "type": "usp" }] }]
}
{% endschema %}
`;
  return { path: "sections/usp-band.liquid", content: liquid };
}

function buildStatsSection(): ThemeFile {
  const liquid = `<section class="section stats stats--{{ section.settings.layout | default: 'row' }} section--bg-{{ section.settings.background | default: 'surface' }} motion--{{ section.settings.motion | default: 'none' }}">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: section.settings.heading, placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="section__header">
      <h2>{{ section.settings.heading }}</h2>
    </div>
    <div class="stats-row">
      {%- for block in section.blocks -%}
        <div class="stat" {{ block.shopify_attributes }}>
          {%- if block.settings.value != blank -%}
            <p class="stat__value">{{ block.settings.value }}</p>
          {%- endif -%}
          {%- if block.settings.label != blank -%}
            <p class="stat__label">{{ block.settings.label }}</p>
          {%- endif -%}
        </div>
      {%- endfor -%}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Statistieken",
  "settings": [
${blueprintVariantSettings("stats", "surface")},
    { "type": "text", "id": "heading", "label": "Kop", "default": "In cijfers" }
  ],
  "blocks": [
    {
      "type": "stat",
      "name": "Statistiek",
      "settings": [
        { "type": "text", "id": "label", "label": "Omschrijving (alleen echte cijfers)" },
        { "type": "text", "id": "value", "label": "Waarde" }
      ]
    }
  ],
  "presets": [{ "name": "Statistieken", "blocks": [{ "type": "stat" }, { "type": "stat" }] }]
}
{% endschema %}
`;
  return { path: "sections/stats.liquid", content: liquid };
}

function buildProcessSection(): ThemeFile {
  const liquid = `<section class="section process process--{{ section.settings.layout | default: 'steps' }} section--bg-{{ section.settings.background | default: 'default' }} motion--{{ section.settings.motion | default: 'none' }}">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: section.settings.heading, placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="section__header">
      <h2>{{ section.settings.heading }}</h2>
      {%- if section.settings.subheading != blank -%}
        <p>{{ section.settings.subheading }}</p>
      {%- endif -%}
    </div>
    <ol class="process-list">
      {%- for block in section.blocks -%}
        <li class="process-item" {{ block.shopify_attributes }}>
          <span class="process-item__number" aria-hidden="true">{{ forloop.index }}</span>
          <div>
            <h3>{{ block.settings.title }}</h3>
            {%- if block.settings.description != blank -%}
              <p>{{ block.settings.description }}</p>
            {%- endif -%}
          </div>
        </li>
      {%- endfor -%}
    </ol>
  </div>
</section>

{% schema %}
{
  "name": "Werkwijze",
  "settings": [
${blueprintVariantSettings("process", "default")},
    { "type": "text", "id": "heading", "label": "Kop", "default": "Zo werken wij" },
    { "type": "textarea", "id": "subheading", "label": "Subkop" }
  ],
  "blocks": [
    {
      "type": "step",
      "name": "Stap",
      "settings": [
        { "type": "text", "id": "title", "label": "Titel" },
        { "type": "textarea", "id": "description", "label": "Toelichting" }
      ]
    }
  ],
  "presets": [{ "name": "Werkwijze", "blocks": [{ "type": "step" }, { "type": "step" }, { "type": "step" }] }]
}
{% endschema %}
`;
  return { path: "sections/process.liquid", content: liquid };
}

function buildProjectsSection(): ThemeFile {
  const liquid = `<section class="section projects projects--{{ section.settings.layout | default: 'grid' }} section--bg-{{ section.settings.background | default: 'default' }} motion--{{ section.settings.motion | default: 'none' }}">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: section.settings.heading, placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="section__header">
      <h2>{{ section.settings.heading }}</h2>
      {%- if section.settings.subheading != blank -%}
        <p>{{ section.settings.subheading }}</p>
      {%- endif -%}
    </div>
    <div class="projects-grid">
      {%- for block in section.blocks -%}
        <article class="project-card" {{ block.shopify_attributes }}>
          <div class="project-card__media">
            {%- render 'theme-media', image: block.settings.image, aspect: 'landscape_4_3', alt: block.settings.image_alt, sizes: '(min-width: 990px) 360px, 100vw', loading: 'lazy', placeholder_svg: 'placeholder.svg' -%}
          </div>
          <div class="project-card__body">
            <h3>{{ block.settings.title }}</h3>
            {%- if block.settings.description != blank -%}
              <p>{{ block.settings.description }}</p>
            {%- endif -%}
          </div>
        </article>
      {%- endfor -%}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Projecten",
  "settings": [
${blueprintVariantSettings("projects", "default")},
    { "type": "text", "id": "heading", "label": "Kop", "default": "Ons werk" },
    { "type": "textarea", "id": "subheading", "label": "Subkop" }
  ],
  "blocks": [
    {
      "type": "project",
      "name": "Project",
      "settings": [
        { "type": "image_picker", "id": "image", "label": "Afbeelding (optioneel)" },
        { "type": "text", "id": "image_alt", "label": "Alt-tekst afbeelding" },
        { "type": "text", "id": "title", "label": "Titel" },
        { "type": "textarea", "id": "description", "label": "Omschrijving" }
      ]
    }
  ],
  "presets": [{ "name": "Projecten", "blocks": [{ "type": "project" }, { "type": "project" }] }]
}
{% endschema %}
`;
  return { path: "sections/projects.liquid", content: liquid };
}

function buildTeamSection(): ThemeFile {
  const liquid = `<section class="section team team--{{ section.settings.layout | default: 'grid' }} section--bg-{{ section.settings.background | default: 'default' }} motion--{{ section.settings.motion | default: 'none' }}">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: section.settings.heading, placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="section__header">
      <h2>{{ section.settings.heading }}</h2>
    </div>
    <div class="team-grid">
      {%- for block in section.blocks -%}
        <div class="team-member" {{ block.shopify_attributes }}>
          <div class="team-member__media">
            {%- render 'theme-media', image: block.settings.image, aspect: 'portrait_3_4', alt: block.settings.name, sizes: '(min-width: 990px) 220px, 50vw', loading: 'lazy', placeholder_svg: 'placeholder.svg' -%}
          </div>
          <div class="team-member__body">
            {%- if block.settings.name != blank -%}
              <h3>{{ block.settings.name }}</h3>
            {%- endif -%}
            {%- if block.settings.role != blank -%}
              <p class="team-member__role">{{ block.settings.role }}</p>
            {%- endif -%}
          </div>
        </div>
      {%- endfor -%}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Team",
  "settings": [
${blueprintVariantSettings("team", "default")},
    { "type": "text", "id": "heading", "label": "Kop", "default": "Ons team" }
  ],
  "blocks": [
    {
      "type": "member",
      "name": "Medewerker",
      "settings": [
        { "type": "image_picker", "id": "image", "label": "Portret (optioneel)" },
        { "type": "text", "id": "name", "label": "Naam (alleen indien echt bekend)" },
        { "type": "text", "id": "role", "label": "Rol" }
      ]
    }
  ],
  "presets": [{ "name": "Team", "blocks": [{ "type": "member" }] }]
}
{% endschema %}
`;
  return { path: "sections/team.liquid", content: liquid };
}

function buildRatesSection(): ThemeFile {
  const liquid = `<section class="section rates rates--{{ section.settings.layout | default: 'table' }} section--bg-{{ section.settings.background | default: 'default' }} motion--{{ section.settings.motion | default: 'none' }}">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: section.settings.heading, placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="section__header">
      <h2>{{ section.settings.heading }}</h2>
      {%- if section.settings.subheading != blank -%}
        <p>{{ section.settings.subheading }}</p>
      {%- endif -%}
    </div>
    {%- if section.settings.layout == 'cards' -%}
      <div class="card-grid">
        {%- for block in section.blocks -%}
          <article class="card rate-card" {{ block.shopify_attributes }}>
            <h3>{{ block.settings.service }}</h3>
            {%- if block.settings.price != blank -%}
              <p class="rate-card__price">{{ block.settings.price }}</p>
            {%- endif -%}
            {%- if block.settings.description != blank -%}
              <p>{{ block.settings.description }}</p>
            {%- endif -%}
          </article>
        {%- endfor -%}
      </div>
    {%- else -%}
      <table class="rates-table">
        <thead>
          <tr><th scope="col">{{ 'rates.service' | t }}</th><th scope="col">{{ 'rates.price' | t }}</th></tr>
        </thead>
        <tbody>
          {%- for block in section.blocks -%}
            <tr {{ block.shopify_attributes }}>
              <td>{{ block.settings.service }}</td>
              <td class="rates-table__price">{{ block.settings.price }}</td>
            </tr>
          {%- endfor -%}
        </tbody>
      </table>
    {%- endif -%}
  </div>
</section>

{% schema %}
{
  "name": "Tarieven",
  "settings": [
${blueprintVariantSettings("rates", "default")},
    { "type": "text", "id": "heading", "label": "Kop", "default": "Tarieven" },
    { "type": "textarea", "id": "subheading", "label": "Subkop" }
  ],
  "blocks": [
    {
      "type": "rate_item",
      "name": "Tariefitem",
      "settings": [
        { "type": "text", "id": "service", "label": "Dienst (alleen echte tarieven)" },
        { "type": "text", "id": "price", "label": "Tarief" },
        { "type": "textarea", "id": "description", "label": "Toelichting (optioneel)" }
      ]
    }
  ],
  "presets": [{ "name": "Tarieven", "blocks": [{ "type": "rate_item" }] }]
}
{% endschema %}
`;
  return { path: "sections/rates.liquid", content: liquid };
}

function buildNewsletterSection(): ThemeFile {
  const liquid = `<section class="section newsletter newsletter--{{ section.settings.layout | default: 'band' }} section--bg-{{ section.settings.background | default: 'surface' }} motion--{{ section.settings.motion | default: 'none' }}">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: section.settings.heading, placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="newsletter__inner">
      <div class="newsletter__copy">
        <h2>{{ section.settings.heading }}</h2>
        {%- if section.settings.subheading != blank -%}
          <p>{{ section.settings.subheading }}</p>
        {%- endif -%}
      </div>
      {%- form 'contact' -%}
        <div class="newsletter__form">
          <input type="hidden" name="contact[body]" value="Nieuwsbrief-aanmelding via de website.">
          <div class="field">
            <label for="NewsletterEmail-{{ section.id }}">{{ 'newsletter.email' | t }}</label>
            <input type="email" id="NewsletterEmail-{{ section.id }}" name="contact[email]" required autocomplete="email">
          </div>
          <button type="submit" class="btn btn--primary">{{ section.settings.button_label }}</button>
        </div>
      {%- endform -%}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Nieuwsbrief",
  "settings": [
${blueprintVariantSettings("newsletter", "surface")},
    { "type": "text", "id": "heading", "label": "Kop", "default": "Blijf op de hoogte" },
    { "type": "textarea", "id": "subheading", "label": "Subkop" },
    { "type": "text", "id": "button_label", "label": "Knoptekst", "default": "Aanmelden" }
  ],
  "presets": [{ "name": "Nieuwsbrief" }]
}
{% endschema %}
`;
  return { path: "sections/newsletter.liquid", content: liquid };
}

function buildBookingSection(): ThemeFile {
  const liquid = `<section class="section booking booking--{{ section.settings.layout | default: 'band' }} section--bg-{{ section.settings.background | default: 'default' }} motion--{{ section.settings.motion | default: 'none' }}">
  {%- if section.settings.background == 'image' -%}
    {%- render 'section-background', image: section.settings.background_image, overlay: section.settings.background_overlay, alt: section.settings.heading, placeholder_svg: 'placeholder.svg' -%}
  {%- endif -%}
  <div class="container">
    <div class="booking__inner">
      <div class="booking__copy">
        <h2>{{ section.settings.heading }}</h2>
        {%- if section.settings.subheading != blank -%}
          <p>{{ section.settings.subheading }}</p>
        {%- endif -%}
      </div>
      <div class="booking__action">
        <a class="btn btn--primary" href="{{ section.settings.cta_link | default: '/pages/contact' }}">{{ section.settings.cta_label }}</a>
      </div>
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Afspraak",
  "settings": [
${blueprintVariantSettings("booking", "default")},
    { "type": "text", "id": "heading", "label": "Kop", "default": "Maak een afspraak" },
    { "type": "textarea", "id": "subheading", "label": "Subkop" },
    { "type": "text", "id": "cta_label", "label": "Knoptekst", "default": "Nu aanvragen" },
    { "type": "url", "id": "cta_link", "label": "Knoplink" }
  ],
  "presets": [{ "name": "Afspraak" }]
}
{% endschema %}
`;
  return { path: "sections/booking.liquid", content: liquid };
}


function buildMainPageSection(): ThemeFile {
  const liquid = `<section class="section">
  <div class="container">
    <div class="section__header">
      <h1>{{ page.title }}</h1>
    </div>
    <div class="rte" style="max-width:760px;">
      {{ page.content }}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Pagina",
  "settings": [],
  "enabled_on": { "templates": ["page"] }
}
{% endschema %}
`;
  return { path: "sections/main-page.liquid", content: liquid };
}

function buildMain404Section(): ThemeFile {
  const liquid = `<section class="error-404">
  <div class="container">
    <h1>404</h1>
    <p><strong>{{ 'error_404.title' | t }}</strong></p>
    <p>{{ 'error_404.subtext' | t }}</p>
    <p style="margin-top:24px;">
      <a class="btn btn--primary" href="/">{{ 'general.back_home' | t }}</a>
    </p>
  </div>
</section>

{% schema %}
{
  "name": "404",
  "settings": [],
  "enabled_on": { "templates": ["404"] }
}
{% endschema %}
`;
  return { path: "sections/main-404.liquid", content: liquid };
}

function buildMainProductSection(): ThemeFile {
  const liquid = `<section class="section">
  <div class="container">
    <div style="display:grid;gap:40px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:start;">
      <div>
        {{ product.featured_image | image_url: width: 800 | image_tag: widths: '300, 500, 800', alt: product.featured_image.alt | default: product.title }}
      </div>
      <div>
        <h1>{{ product.title }}</h1>
        {%- if product.vendor != blank -%}
          <p style="color:var(--color-muted);">{{ 'products.vendor' | t }}: {{ product.vendor }}</p>
        {%- endif -%}
        <p>
          {%- if product.compare_at_price > product.price -%}
            <s style="color:var(--color-muted);">{{ product.compare_at_price | money }}</s>
          {%- endif -%}
          <span class="price">{{ product.price | money }}</span>
        </p>
        {%- form 'product', product -%}
          <div class="form">
            <div class="field">
              <label for="Quantity">{{ 'products.quantity' | t }}</label>
              <input type="number" id="Quantity" name="quantity" value="1" min="1">
            </div>
            <div>
              <button type="submit" class="btn btn--primary" {% unless product.available %}disabled{% endunless %}>
                {%- if product.available -%}
                  {{ 'products.add_to_cart' | t }}
                {%- else -%}
                  {{ 'products.sold_out' | t }}
                {%- endif -%}
              </button>
            </div>
          </div>
        {%- endform -%}
        <div class="rte" style="margin-top:24px;">
          {{ product.description }}
        </div>
      </div>
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Product",
  "settings": [],
  "enabled_on": { "templates": ["product"] }
}
{% endschema %}
`;
  return { path: "sections/main-product.liquid", content: liquid };
}

function buildMainCollectionSection(): ThemeFile {
  const liquid = `<section class="section">
  <div class="container">
    <div class="section__header">
      <h1>{{ collection.title }}</h1>
      {%- if collection.description != blank -%}
        <p>{{ collection.description }}</p>
      {%- endif -%}
    </div>
    {%- paginate collection.products by 24 -%}
      {%- if collection.products.size > 0 -%}
        <div class="product-grid">
          {%- for product in collection.products -%}
            <article class="product-card">
              <a href="{{ product.url }}" class="product-card__media">
                {%- if product.featured_image -%}
                  {{ product.featured_image | image_url: width: 500 | image_tag: widths: '250, 500', alt: product.featured_image.alt | default: product.title, loading: 'lazy' }}
                {%- else -%}
                  <img src="{{ 'placeholder.svg' | asset_url }}" alt="" width="500" height="500" loading="lazy">
                {%- endif -%}
              </a>
              <div class="product-card__body">
                <a href="{{ product.url }}" class="product-card__title">{{ product.title }}</a>
                <span class="price">{{ product.price | money }}</span>
              </div>
            </article>
          {%- endfor -%}
        </div>
      {%- else -%}
        <p>{{ 'collections.empty' | t }}</p>
      {%- endif -%}
      {%- if paginate.pages > 1 -%}
        <div style="margin-top:32px;display:flex;gap:16px;justify-content:center;">
          {%- if paginate.previous -%}
            <a href="{{ paginate.previous.url }}">&larr;</a>
          {%- endif -%}
          {%- if paginate.next -%}
            <a href="{{ paginate.next.url }}">&rarr;</a>
          {%- endif -%}
        </div>
      {%- endif -%}
    {%- endpaginate -%}
  </div>
</section>

{% schema %}
{
  "name": "Collectie",
  "settings": [],
  "enabled_on": { "templates": ["collection"] }
}
{% endschema %}
`;
  return { path: "sections/main-collection.liquid", content: liquid };
}

function buildMainCartSection(): ThemeFile {
  const liquid = `<section class="section">
  <div class="container">
    <div class="section__header">
      <h1>{{ 'cart.title' | t }}</h1>
    </div>
    {%- if cart.item_count > 0 -%}
      {%- form 'cart', cart -%}
        <table class="cart-table">
          <thead>
            <tr>
              <th scope="col">{{ 'cart.product' | t }}</th>
              <th scope="col">{{ 'cart.quantity' | t }}</th>
              <th scope="col">{{ 'cart.total' | t }}</th>
            </tr>
          </thead>
          <tbody>
            {%- for item in cart.items -%}
              <tr>
                <td>
                  <a href="{{ item.url }}">{{ item.product.title }}</a>
                  {%- if item.variant.title != 'Default Title' -%}
                    <small style="display:block;color:var(--color-muted);">{{ item.variant.title }}</small>
                  {%- endif -%}
                </td>
                <td>
                  <input type="number" name="updates[]" value="{{ item.quantity }}" min="0" aria-label="{{ 'cart.quantity' | t }}" style="width:72px;padding:8px;border:1px solid var(--color-border);border-radius:var(--radius);">
                </td>
                <td>{{ item.final_line_price | money }}</td>
              </tr>
            {%- endfor -%}
          </tbody>
        </table>
        <p style="margin-top:20px;font-weight:700;">{{ 'cart.subtotal' | t }}: {{ cart.total_price | money }}</p>
        <p style="color:var(--color-muted);font-size:.9rem;">{{ 'cart.taxes_note' | t }}</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;">
          <button type="submit" name="update" class="btn btn--secondary">{{ 'cart.remove' | t }}</button>
          <button type="submit" name="checkout" class="btn btn--primary">{{ 'cart.checkout' | t }}</button>
        </div>
      {%- endform -%}
    {%- else -%}
      <p>{{ 'cart.empty' | t }}</p>
      <p style="margin-top:16px;">
        <a class="btn btn--primary" href="{{ routes.all_products_collection_url }}">{{ 'cart.continue_shopping' | t }}</a>
      </p>
    {%- endif -%}
  </div>
</section>

{% schema %}
{
  "name": "Winkelwagen",
  "settings": [],
  "enabled_on": { "templates": ["cart"] }
}
{% endschema %}
`;
  return { path: "sections/main-cart.liquid", content: liquid };
}

function buildMainSearchSection(): ThemeFile {
  const liquid = `<section class="section">
  <div class="container">
    <div class="section__header">
      <h1>{{ 'search.title' | t }}</h1>
    </div>
    <form action="{{ routes.search_url }}" method="get" role="search" class="form" style="max-width:480px;">
      <div class="field">
        <label for="SearchInput">{{ 'search.placeholder' | t }}</label>
        <input type="search" id="SearchInput" name="q" value="{{ search.terms | escape }}">
      </div>
      <div>
        <button type="submit" class="btn btn--primary">{{ 'search.submit' | t }}</button>
      </div>
    </form>
    {%- if search.performed -%}
      <p style="margin-top:24px;">
        {{ 'search.results_count' | t: count: search.results_count }}
      </p>
      {%- if search.results_count > 0 -%}
        <div class="product-grid" style="margin-top:20px;">
          {%- for item in search.results -%}
            <article class="product-card">
              {%- if item.object_type == 'product' -%}
                <a href="{{ item.url }}" class="product-card__media">
                  {%- if item.featured_image -%}
                    {{ item.featured_image | image_url: width: 500 | image_tag: widths: '250, 500', alt: item.title, loading: 'lazy' }}
                  {%- endif -%}
                </a>
                <div class="product-card__body">
                  <a href="{{ item.url }}" class="product-card__title">{{ item.title }}</a>
                  {%- if item.price -%}
                    <span class="price">{{ item.price | money }}</span>
                  {%- endif -%}
                </div>
              {%- else -%}
                <div class="product-card__body">
                  <a href="{{ item.url }}" class="product-card__title">{{ item.title }}</a>
                </div>
              {%- endif -%}
            </article>
          {%- endfor -%}
        </div>
      {%- else -%}
        <p style="margin-top:16px;">{{ 'search.no_results' | t }}</p>
      {%- endif -%}
    {%- endif -%}
  </div>
</section>

{% schema %}
{
  "name": "Zoeken",
  "settings": [],
  "enabled_on": { "templates": ["search"] }
}
{% endschema %}
`;
  return { path: "sections/main-search.liquid", content: liquid };
}

// ---------------------------------------------------------------------------
// Section groups + templates (JSON)
// ---------------------------------------------------------------------------

function jsonFile(path: string, data: unknown): ThemeFile {
  return { path, content: `${JSON.stringify(data, null, 2)}\n` };
}

interface HeaderGroupInput {
  businessName: string;
  navItems: { label: string; url: string }[];
  ctaLabel: string;
}

/**
 * D2: bij een artDirection-contract neemt de header-group de GEPLANDE
 * variantdefaults over (headerStyle + sticky); zonder contract blijft de
 * group exact de D0/D1-vorm (geen layout/sticky/show_cta-keys — het
 * sectieschema levert dan de defaults).
 */
function buildHeaderGroup(input: HeaderGroupInput, artDirection: ArtDirection | null): ThemeFile {
  const plannedSettings =
    artDirection != null
      ? {
          layout: artDirection.headerStyle,
          sticky: true,
          show_cta: true,
          brand_text: input.businessName,
          cta_label: input.ctaLabel,
        }
      : {
          brand_text: input.businessName,
          cta_label: input.ctaLabel,
        };
  return jsonFile("sections/header-group.json", {
    type: "header",
    name: "Header",
    sections: {
      header: {
        type: "header",
        settings: plannedSettings,
        blocks: Object.fromEntries(
          input.navItems.map((item, index) => [
            `nav_${index + 1}`,
            { type: "nav_item", settings: { label: item.label, link: item.url } },
          ])
        ),
        block_order: input.navItems.map((_, i) => `nav_${i + 1}`),
      },
    },
    order: ["header"],
  });
}

function buildFooterGroup(input: {
  businessName: string;
  tagline: string;
  contact: WebsiteContactContext;
}): ThemeFile {
  return jsonFile("sections/footer-group.json", {
    type: "footer",
    name: "Footer",
    sections: {
      footer: {
        type: "footer",
        settings: {
          about_text: `${input.businessName}${input.contact.city ? ` — ${input.contact.city}` : ""}`,
          tagline: input.tagline,
          phone: input.contact.phone,
          email: input.contact.email,
          address: input.contact.address,
        },
      },
    },
    order: ["footer"],
  });
}

function homePageSectionInstances(spec: WebsiteSpecification, contact: WebsiteContactContext) {
  const sections: Record<string, Record<string, unknown>> = {};
  const order: string[] = [];

  const mediaSlots = mediaSlotsFor(spec);
  const heroSlot = findSlot(mediaSlots, "hero");
  sections.hero = {
    type: "hero",
    settings: {
      eyebrow: spec.seo.localArea ?? `${spec.business.industry} in ${spec.business.city}`,
      heading: spec.content.headline,
      subheading: spec.content.subheadline ?? spec.content.valueProposition,
      cta_label: spec.content.ctaPrimaryText,
      cta_link: "/pages/contact",
      cta_secondary_label: spec.content.ctaSecondaryText,
      cta_secondary_link: "#main-content",
      image_alt: slotAlt(heroSlot, null),
    },
  };
  order.push("hero");

  if (spec.content.services.length > 0) {
    sections.services = {
      type: "services",
      settings: { heading: "Onze diensten", subheading: null },
      blocks: Object.fromEntries(
        spec.content.services.map((s, i) => [
          `service_${i + 1}`,
          { type: "service", settings: { title: s.title, description: s.description } },
        ])
      ),
      block_order: spec.content.services.map((_, i) => `service_${i + 1}`),
    };
    order.push("services");
  }

  if (spec.content.about) {
    const aboutSlot = findSlot(mediaSlots, "about");
    sections.about = {
      type: "about",
      settings: {
        heading: `Over ${spec.business.businessName}`,
        body: `<p>${escapeHtml(spec.content.about)}</p>`,
        image_alt: slotAlt(aboutSlot, null),
      },
    };
    order.push("about");
  }

  // R1: gallery uitsluitend als de AI een gallery-achtig beeldvereiste plande;
  // blokken zijn lege image-slots (alt/caption volgen uit de planning).
  if (hasGalleryRequirement(spec)) {
    const galleryCount = galleryBlockCount(spec);
    sections.gallery = {
      type: "gallery",
      settings: { heading: "Impressie", subheading: null },
      blocks: Object.fromEntries(
        Array.from({ length: galleryCount }, (_, i) => [
          `image_${i + 1}`,
          { type: "gallery_image", settings: { caption: spec.media.imageDescriptions[i] ?? null, alt: null } },
        ])
      ),
      block_order: Array.from({ length: galleryCount }, (_, i) => `image_${i + 1}`),
    };
    order.push("gallery");
  }

  // R1: testimonials uitsluitend met ECHTE, in de specification bekende
  // uitspraken — auteur blijft leeg (nooit een verzonnen naam/gezicht).
  if (hasRealTestimonials(spec)) {
    const quotes = spec.content.testimonials.filter((q) => q.trim().length > 0);
    sections.testimonials = {
      type: "testimonials",
      settings: { heading: "Wat klanten zeggen" },
      blocks: Object.fromEntries(
        quotes.map((quote, i) => [`testimonial_${i + 1}`, { type: "testimonial", settings: { quote, author: null } }])
      ),
      block_order: quotes.map((_, i) => `testimonial_${i + 1}`),
    };
    order.push("testimonials");
  }

  if (spec.content.benefits.length > 0) {
    sections.benefits = {
      type: "benefits",
      settings: { heading: "Waarom klanten voor ons kiezen" },
      blocks: Object.fromEntries(
        spec.content.benefits.map((b, i) => [`benefit_${i + 1}`, { type: "benefit", settings: { text: b } }])
      ),
      block_order: spec.content.benefits.map((_, i) => `benefit_${i + 1}`),
    };
    order.push("benefits");
  }

  if (spec.content.faq.length > 0) {
    sections.faq = {
      type: "faq",
      settings: { heading: "Veelgestelde vragen" },
      blocks: Object.fromEntries(
        spec.content.faq.map((f, i) => [
          `question_${i + 1}`,
          { type: "question", settings: { question: f.question, answer: `<p>${escapeHtml(f.answer)}</p>` } },
        ])
      ),
      block_order: spec.content.faq.map((_, i) => `question_${i + 1}`),
    };
    order.push("faq");
  }

  sections.cta = {
    type: "cta",
    settings: {
      heading: spec.content.ctaPrimaryText,
      subheading: spec.content.contactIntro,
      cta_label: spec.content.ctaPrimaryText,
      cta_link: "/pages/contact",
    },
  };
  order.push("cta");

  sections.contact = {
    type: "contact",
    settings: {
      heading: "Contact",
      intro: spec.content.contactIntro,
      phone: contact.phone,
      email: contact.email,
      address: [contact.address, contact.city].filter(Boolean).join(", ") || null,
      show_form: true,
    },
  };
  order.push("contact");

  return { sections, order };
}

function contactPageTemplate(spec: WebsiteSpecification, contact: WebsiteContactContext): { path: string; data: unknown } {
  const { sections } = homePageSectionInstances(spec, contact);
  // Contactpagina: alleen de contactsectie (geen homepage-compositie).
  return {
    path: "templates/page.contact.json",
    data: {
      sections: { contact: sections.contact },
      order: ["contact"],
    },
  };
}

// ---------------------------------------------------------------------------
// Hoofdexport
// ---------------------------------------------------------------------------

export interface BuildThemeInput {
  specification: WebsiteSpecification;
  designPlan: DesignPlan;
  contact: WebsiteContactContext;
  /**
   * C3d (2026-09-20): het actuele, geverifieerde ContentPlan (optioneel).
   * Met plan vullen de units per exact pad ("<pageKey>/<sectionIndex>")
   * de content-slots van de blueprint-compositie; zonder plan is de output
   * byte-identiek aan de pre-C3d-flow (volledige backward compatibility).
   * De aanroeper (ThemeZipService) heeft de stale-check al gedaan — hier
   * wordt geen plan meer geaccepteerd dat niet consumeerbaar is.
   */
  contentPlan?: ContentPlan | null;
}

export interface BuiltTheme {
  files: ThemeFile[];
  notes: string[];
}

/**
 * Bouwt het complete thema. Volledig deterministisch: dezelfde input levert
 * byte-identieke output. Content komt uitsluitend uit de gevalideerde
 * specification + echte contactgegevens; het ontwerp komt uitsluitend uit
 * het Design Plan.
 */
export function buildShopifyTheme(input: BuildThemeInput): BuiltTheme {
  const { specification: spec, designPlan: plan, contact } = input;
  const tokens = buildThemeDesignTokens(plan);
  const files: ThemeFile[] = [];
  const notes: string[] = [];

  // --- Config + layout + assets + locales
  files.push(
    buildSettingsSchema(spec.business.businessName, contact, spec.seo.metaDescription, tokens)
  );
  files.push(
    buildSettingsData(tokens, spec.business.businessName, contact, spec.seo.metaDescription)
  );
  files.push(buildThemeLayout(spec, tokens));
  files.push(buildMetaTagsSnippet());
  files.push(buildButtonSnippet());
  files.push(buildThemeCss());
  files.push(buildThemeJs());
  // D2: de art-direction-laag bestaat uitsluitend bij een contract —
  // plannen zonder artDirection krijgen exact de D0/D1-bestandsset.
  if (tokens.artDirection != null) {
    const artDirectionCss = buildArtDirectionCss(tokens);
    if (artDirectionCss) files.push(artDirectionCss);
    notes.push(
      `Art direction: compositie "${tokens.artDirection.composition}", header "${tokens.artDirection.headerStyle}", hero "${tokens.artDirection.heroTreatment}", kaarten "${tokens.artDirection.cardTreatment}", beeld "${tokens.artDirection.imageryBalance}/${tokens.artDirection.imageStyle}", decoratie "${tokens.artDirection.decorativeStyle}", overgangen "${tokens.artDirection.sectionTransition}", motion "${tokens.artDirection.motionStyle}" (assets/art-direction.css).`
    );
  }
  // R1: media-plan (sloten + placeholder-variant) uit specification + Design
  // Plan; de generieke placeholder blijft voor product-cards/giftcard.
  const mediaPlan = mediaPlanFor(spec, plan.imagery.placeholderStrategy);
  files.push(buildGenericPlaceholderSvg(tokens));
  files.push(...buildMediaPlaceholderSvgs(mediaPlan.variant, tokens));
  files.push(buildThemeMediaSnippet());
  files.push(buildSectionBackgroundSnippet());
  files.push(buildLocaleFile());

  // --- D1: webfont-pairing uit het visualContract — woff2-assets (binair)
  //     plus de OFL-licentietekst per gebruikte familie. Zonder
  //     visualContract worden er GEEN fontbestanden meegeleverd (exact
  //     de D0-ZIP-inhoud).
  if (isWebFontPairing(tokens.fontPairing)) {
    for (const asset of fontPairingAssets(tokens.fontPairing)) {
      files.push({ path: asset.path, content: asset.content, ...(asset.bytes ? { bytes: asset.bytes } : {}) });
    }
    notes.push(
      `Font-pairing "${tokens.fontPairing}" meegeleverd als zelfgehoste woff2-assets inclusief SIL OFL-licentietekst per familie.`
    );
  }
  for (const correction of tokens.paletteCorrections) {
    notes.push(`Palet-engine (WCAG AA): ${correction}`);
  }

  // --- Password-status (branded "coming soon" tijdens de launch)
  files.push(buildPasswordLayout());
  files.push(buildPasswordTemplate());

  // --- Klantaccounts (inerte systeempagina's; pas actief bij door de
  //     merchant geactiveerde klantaccounts) + cadeaubon
  files.push(buildCustomersLoginPage());
  files.push(buildCustomersRegisterPage());
  files.push(buildCustomersAccountPage());
  files.push(buildCustomersOrderPage());
  files.push(buildCustomersAddressesPage());
  files.push(buildCustomersActivateAccountPage());
  files.push(buildCustomersResetPasswordPage());
  files.push(buildGiftCardTemplate());

  // --- Sections
  files.push(buildHeaderSection());
  files.push(buildFooterSection());
  files.push(buildHeroSection());
  files.push(buildServicesSection());
  files.push(buildAboutSection());
  files.push(buildGallerySection());
  files.push(buildTestimonialsSection());
  files.push(buildBenefitsSection());
  files.push(buildFaqSection());
  files.push(buildCtaSection());
  files.push(buildContactSection());
  files.push(buildRichTextSection());
  // Fase C: blueprint-secties uit de SECTION-REGISTRY (usp-band, stats,
  // process, projects, team, rates, newsletter, booking) — altijd aanwezig
  // als sectiebestand; instantiëring gebeurt uitsluitend via het blueprint.
  files.push(buildUspBandSection());
  files.push(buildStatsSection());
  files.push(buildProcessSection());
  files.push(buildProjectsSection());
  files.push(buildTeamSection());
  files.push(buildRatesSection());
  files.push(buildNewsletterSection());
  files.push(buildBookingSection());
  files.push(buildMainPageSection());
  files.push(buildMain404Section());
  files.push(buildMainProductSection());
  files.push(buildMainCollectionSection());
  files.push(buildMainCartSection());
  files.push(buildMainSearchSection());

  // --- Header/footer-groups (nav uit het Design Plan)
  const pageKeyHome = new Set(["home", "index", "start", "homepage"]);
  const navItems = plan.navigation.items.map((item) => ({
    label: item.label,
    url: pageKeyHome.has(item.pageKey.toLowerCase()) ? "/" : `/pages/${slugifyPageKey(item.pageKey)}`,
  }));
  files.push(
    buildHeaderGroup(
      {
        businessName: spec.business.businessName,
        navItems,
        ctaLabel: spec.content.ctaPrimaryText,
      },
      tokens.artDirection
    )
  );
  files.push(
    buildFooterGroup({
      businessName: spec.business.businessName,
      tagline: spec.seo.localArea ? `Actief in ${spec.seo.localArea}.` : "",
      contact,
    })
  );

  // --- Templates: pagina-compositie.
  //     Fase C: met een blueprint op het Design Plan worden homepage ÉN
  //     subpagina's deterministisch uit blueprint.pages[].sectionInstances
  //     opgebouwd (types/layouts uit de SECTION-REGISTRY, volgorde exact,
  //     geen ongeplande secties). Zonder blueprint (v1-plan) blijft de
  //     bestaande hardcoded homepage-compositie + contactpagina + lege
  //     subpagina-shells byte-voor-byte gehandhaafd (backward compat).
  if (plan.blueprint) {
    const composition = composeBlueprintTemplates({ blueprint: plan.blueprint, spec, contact, contentPlan: input.contentPlan ?? null });
    for (const template of composition.templates) {
      files.push(jsonFile(template.path, template.data));
    }
    notes.push(...composition.notes);
  } else {
    const home = homePageSectionInstances(spec, contact);
    files.push(jsonFile("templates/index.json", { sections: home.sections, order: home.order }));

    // --- Templates: contactpagina (altijd, met échte contactgegevens)
    const contactPage = contactPageTemplate(spec, contact);
    files.push(jsonFile(contactPage.path, contactPage.data));

    // --- Templates: subpagina's uit het Design Plan (home-contact al gedaan)
    const plannedKeys = new Set<string>(["contact"]);
    for (const page of plan.pageStructure) {
      const key = page.key.trim();
      if (pageKeyHome.has(key.toLowerCase())) continue;
      const slugKey = slugifyPageKey(key);
      if (plannedKeys.has(slugKey)) continue;
      plannedKeys.add(slugKey);
      files.push(
        jsonFile(`templates/page.${slugKey}.json`, {
          sections: {
            main: {
              type: "main-page",
              settings: {},
            },
          },
          order: ["main"],
        })
      );
      notes.push(
        `Pagina "${page.title ?? key}" wordt als lege, bewerkbare Shopify-pagina aangeleverd (template page.${slugKey}) — content volgt in de revisierondes, er wordt niets verzonnen.`
      );
    }
  }

  // --- Templates: standaardpagina + systeempagina's
  files.push(jsonFile("templates/page.json", { sections: { main: { type: "main-page", settings: {} } }, order: ["main"] }));
  files.push(jsonFile("templates/404.json", { sections: { main: { type: "main-404", settings: {} } }, order: ["main"] }));
  files.push(jsonFile("templates/product.json", { sections: { main: { type: "main-product", settings: {} } }, order: ["main"] }));
  files.push(jsonFile("templates/collection.json", { sections: { main: { type: "main-collection", settings: {} } }, order: ["main"] }));
  files.push(jsonFile("templates/cart.json", { sections: { main: { type: "main-cart", settings: {} } }, order: ["main"] }));
  files.push(jsonFile("templates/search.json", { sections: { main: { type: "main-search", settings: {} } }, order: ["main"] }));

  if (hasGalleryRequirement(spec)) {
    notes.push(
      "Galerij-sectie geactiveerd met abstracte beeldplaceholders — echte foto's kiest de merchant via de image_picker-settings (geen stock-fabricatie)."
    );
  } else {
    notes.push(
      "Geen galerij geinstantieerd: de planning bevat geen gallery-achtig beeldvereiste."
    );
  }
  if (hasRealTestimonials(spec)) {
    notes.push(
      "Testimonials-sectie toont uitsluitend uit de specificatie bekende uitspraken; auteursnamen zijn bewust leeg gelaten (geen fabricatie)."
    );
  } else {
    notes.push(
      "Testimonials-sectie beschikbaar maar niet geactiveerd: geen echte klantuitingen bekend — niets verzonnen."
    );
  }
  if (spec.missingInformation.length > 0) {
    notes.push(
      `${spec.missingInformation.length} ontbrekende informatiepunten uit de specification zijn bewust placeholder gelaten (geen fabricatie).`
    );
  }

  return { files, notes };
}
