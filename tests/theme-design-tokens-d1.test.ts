import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken (zelfde patroon als alle websitetests).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import { buildShopifyTheme, buildThemeDesignTokens } from "../lib/websites/theme-zip/theme-builder";
import { createThemeZip, readThemeZip } from "../lib/websites/theme-zip/theme-zip";
import { validateThemeFiles } from "../lib/websites/theme-zip/theme-validation";
import {
  FONT_PAIRING_KEYS,
  FONT_PAIRING_OPTION_LABELS,
  PALETTE_MOOD_KEYS,
  PALETTE_MOOD_OPTION_LABELS,
  TYPOGRAPHIC_CURVE_SCALE,
  visualContractSchema,
  type VisualContract,
} from "../lib/websites/visual-contract";
import {
  contrastRatio,
  derivePalette,
  enforceContrast,
  hexToHsl,
  hslToHex,
} from "../lib/websites/theme-zip/palette-engine";
import { buildFontFaceCss, fontFamilyValues, fontPairingAssets } from "../lib/websites/theme-zip/font-library";
import { designPlanSchema, type DesignPlan } from "../lib/websites/design-plan";
import { WebsiteSpecificationSchema } from "../lib/ai/schemas";
import type { WebsiteSpecification } from "../lib/websites/types";
import type { WebsiteContactContext } from "../lib/websites/generator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONTACT: WebsiteContactContext = {
  phone: "+31555012345",
  email: "info@hovandijk.example",
  address: "Tuinstraat 12",
  city: "Apeldoorn",
  province: "Gelderland",
};

const SPECIFICATION: WebsiteSpecification = WebsiteSpecificationSchema.parse({
  template: "local_service",
  business: {
    businessName: "Hovenier van Dijk",
    industry: "hovenier",
    city: "Apeldoorn",
    province: "Gelderland",
    description: null,
    targetAudience: "Particuliere tuineigenaren",
  },
  branding: {
    primaryColor: null,
    secondaryColor: null,
    accentColor: null,
    backgroundStyle: null,
    typographyStyle: null,
    visualStyle: null,
  },
  structure: {
    pages: [
      { key: "home", title: "Home" },
      { key: "diensten", title: "Diensten" },
      { key: "contact", title: "Contact" },
    ],
    navigation: ["Home", "Diensten", "Contact"],
    sections: ["hero", "services", "cta", "contact"],
  },
  content: {
    headline: "Onderhoud en aanleg van tuinen in Apeldoorn",
    subheadline: "Vakwerk, op tijd",
    valueProposition: "Meer dan tien jaar ervaring",
    services: [{ title: "Tuinaanleg", description: "Complete aanleg van nieuwe tuinen." }],
    about: "Hovenier van Dijk is een lokaal bedrijf uit Apeldoorn.",
    benefits: ["Persoonlijk contact"],
    faq: [],
    testimonials: [],
    contactIntro: "Vraag een vrijblijvende offerte aan.",
    ctaPrimaryText: "Vraag een offerte aan",
    ctaSecondaryText: "Bekijk onze diensten",
  },
  conversion: {
    primaryCta: "offerte",
    secondaryCta: "diensten",
    contactMethods: ["telefoon"],
    leadCapture: true,
  },
  media: {
    imageRequirements: [],
    imageDescriptions: [],
    imagePlaceholders: [],
  },
  seo: {
    title: "Hovenier van Dijk — Apeldoorn",
    metaDescription: "Hovenier van Dijk verzorgt tuinaanleg in Apeldoorn.",
    keywords: ["hovenier apeldoorn"],
    localArea: "Apeldoorn",
  },
  missingInformation: [],
}) as WebsiteSpecification;

const PLAN_BASE = {
  goals: {
    primaryGoal: "Meer offerteaanvragen",
    secondaryGoals: [],
    conversionGoal: "Offerteaanvraag via formulier",
  },
  audience: { primaryAudience: "Particulieren", secondaryAudiences: [], toneOfVoice: "Nederlands" },
  navigation: {
    items: [
      { label: "Home", pageKey: "home" },
      { label: "Diensten", pageKey: "diensten" },
      { label: "Contact", pageKey: "contact" },
    ],
    structure: "Horizontaal",
  },
  pageStructure: [
    { key: "home", title: "Home", purpose: "Landingspagina", sections: ["hero", "diensten"] },
    { key: "diensten", title: "Diensten", purpose: "Diensten", sections: ["diensten"] },
    { key: "contact", title: "Contact", purpose: "Contact", sections: ["formulier"] },
  ],
  visualHierarchy: { strategy: "Grote hero-kop", aboveTheFold: ["Hoofdkop"] },
  branding: {
    styleDirection: "Rustig, groen, vakmanschap",
    mood: ["natuurlijk"],
    existingBrandAssets: null,
    preferredColors: ["groen"],
    dislikedColors: [],
    restrictions: [],
  },
  typography: {
    pairing: "Serif-koppen met sans-serif lopende tekst",
    scale: "1.25 major third",
    weights: ["400", "600"],
    rationale: "Serif onderstreept vakmanschap",
  },
  colors: {
    primary: "#2f5233",
    secondary: "#7a8f6d",
    accent: "#c9a55a",
    neutrals: ["#ffffff", "#f4f6f2", "#22301f", "#5b6657", "#dfe4dc"],
    usageGuidance: "Groen voor koppen en CTA",
  },
  spacing: { scale: "8px-basis", density: "ruim" },
  components: [
    { key: "hero", purpose: "Eerste indruk", notes: null },
    { key: "contact", purpose: "Contactformulier", notes: null },
  ],
  ctaStrategy: {
    primary: "Vraag een offerte aan",
    secondary: null,
    placement: ["Hero"],
    leadCapture: true,
  },
  imagery: {
    style: "Natuurlijke sfeerbeelden",
    requirements: ["Eigen fotomateriaal"],
    placeholderStrategy: "Neutrale SVG-placeholder",
  },
  responsive: {
    mobile: "Eénkoloms",
    tablet: "Tweekoloms",
    desktop: "Driekoloms",
    breakpoints: ["760px", "1024px"],
  },
  animation: { strategy: "Minimaal", allowed: ["hover"], restrictions: [] },
  functionality: {
    features: [{ key: "contactformulier", description: "Contactformulier", source: "requirements" }],
    integrations: [],
  },
  accessibility: {
    contrast: "4.5:1",
    focusAndKeyboard: "Focus-states",
    semantics: "Secties met koppen",
    formsAndLabels: "Elk veld een label",
    guidelines: ["WCAG 2.2 AA"],
  },
  seoPerformance: {
    titleStrategy: "Plaats + vak",
    metaStrategy: "Lokaal",
    localSeo: "Apeldoorn",
    performanceBudget: "Systeemstack",
    imageOptimization: "Lazy loading",
  },
  basis: { sources: ["lead", "project", "requirements"] },
  missingInformation: [],
};

const CONTRACT: VisualContract = {
  fontPairing: "editorial_serif",
  paletteMood: "premium_dark",
  typographicCurve: "dramatic",
  density: "spacious",
  motionLevel: "subtle",
};

function planWith(overrides: Record<string, unknown> = {}): DesignPlan {
  return designPlanSchema.parse({ ...PLAN_BASE, ...overrides });
}

const D0_PLAN = planWith();
const D1_PLAN = planWith({ visualContract: CONTRACT });

// ---------------------------------------------------------------------------
// 1. Visual contract — schema, enums, backward compat
// ---------------------------------------------------------------------------

test("D1: visualContract-schema accepteert exact de enum-catalogus en weigert eigen waarden", () => {
  const parsed = visualContractSchema.parse(CONTRACT);
  assert.equal(parsed.fontPairing, "editorial_serif");
  assert.equal(parsed.paletteMood, "premium_dark");
  assert.equal(parsed.typographicCurve, "dramatic");
  assert.equal(parsed.density, "spacious");
  assert.equal(parsed.motionLevel, "subtle");

  assert.equal(visualContractSchema.safeParse({ ...CONTRACT, fontPairing: "comic_sans" }).success, false);
  assert.equal(visualContractSchema.safeParse({ ...CONTRACT, paletteMood: "vibes" }).success, false);
  assert.equal(visualContractSchema.safeParse(null).success, false);
});

test("D1: Design Plan zonder visualContract blijft exact geldig (backward compat)", () => {
  assert.equal(D0_PLAN.visualContract, undefined);
  // Met explicit null eveneens geldig (schema staat nullable toe).
  const nullable = planWith({ visualContract: null });
  assert.equal(nullable.visualContract, null);
  // En een D1-plan met contract parseert zonder de rest te veranderen.
  assert.equal(D1_PLAN.visualContract?.fontPairing, "editorial_serif");
});

test("D1: typografische curves liggen binnen de settings-range (90-130, stap 5)", () => {
  for (const value of Object.values(TYPOGRAPHIC_CURVE_SCALE)) {
    assert.ok(value >= 90 && value <= 130, `curve ${value} buiten range`);
    assert.equal(value % 5, 0, `curve ${value} geen veelvoud van 5`);
  }
});

test("D1: alle merchant-optielabels (Shopify-grens) zijn max 50 tekens", () => {
  for (const label of Object.values(FONT_PAIRING_OPTION_LABELS)) {
    assert.ok(label.length <= 50, `font-pairing label te lang: "${label}"`);
  }
  for (const label of Object.values(PALETTE_MOOD_OPTION_LABELS)) {
    assert.ok(label.length <= 50, `palette-mood label te lang: "${label}"`);
  }
  assert.equal(FONT_PAIRING_KEYS.length, 6);
  assert.equal(PALETTE_MOOD_KEYS.length, 7);
});

// ---------------------------------------------------------------------------
// 2. Palette engine — HSL, WCAG, mood
// ---------------------------------------------------------------------------

test("D1: hex/HSL-conversie is roundtrip-exact", () => {
  for (const hex of ["#2f5233", "#c9a55a", "#ffffff", "#000000", "#f4f6f2"]) {
    assert.equal(hslToHex(hexToHsl(hex)), hex.toLowerCase());
  }
});

test("D1: contrastRatio volgt WCAG (zwart/wit = 21, kleur met zichzelf = 1)", () => {
  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 0.01);
  assert.ok(Math.abs(contrastRatio("#2f5233", "#2f5233") - 1) < 0.001);
});

test("D1: enforceContrast verduistert een te lichte kleur tot AA en laat geldige kleuren met rust", () => {
  const teLicht = enforceContrast("#a8c5e0", "#ffffff", 4.5, "darken");
  assert.ok(teLicht.corrected);
  assert.ok(contrastRatio(teLicht.hex, "#ffffff") >= 4.5);
  assert.ok(hexToHsl(teLicht.hex).l < hexToHsl("#a8c5e0").l, "correctie moet verduisteren");

  const geldig = enforceContrast("#1f3a2e", "#ffffff", 4.5, "darken");
  assert.equal(geldig.corrected, false);
  assert.equal(geldig.hex, "#1f3a2e");
});

test("D1: derivePalette garandeert WCAG AA op alle tekstrollen en rapporteert correcties", () => {
  const result = derivePalette({
    primary: "#a8c5e0", // te licht: moet verduisterd worden
    secondary: "#c9d8e8",
    accent: "#c9a55a",
    background: "#ffffff",
    surface: "#f0f3f7",
    text: "#9aa7b5", // te licht als lopende tekst
    mutedText: "#b0bcc9",
    border: "#dde3ea",
    mood: "cool_professional",
  });
  assert.ok(contrastRatio(result.text, result.background) >= 4.5, "text op background");
  assert.ok(contrastRatio(result.mutedText, result.background) >= 4.5, "mutedText op background");
  assert.ok(contrastRatio(result.primary, result.background) >= 4.5, "primary als tekst");
  assert.ok(contrastRatio(result.primary, "#ffffff") >= 4.5, "primary met witte knoptekst");
  assert.ok(result.corrections.length > 0, "correcties worden expliciet gerapporteerd (nooit stilzwijgend)");
  assert.ok(result.corrections.every((c) => c.includes("WCAG") || c.includes("contrast")));
});

test("D1: palet-stemmingen tinten de neutrale waarden verschillend (cool vs warm)", () => {
  // Grijze neutrals (s <= 4): de mood legt hier zijn eigen tint op —
  // de zichtbare plek waar stemmigingsverschillen deterministisch bewijsbaar zijn.
  const base = {
    primary: "#2f5233",
    secondary: "#7a8f6d",
    accent: "#c9a55a",
    background: "#ffffff",
    surface: "#f0f0f0",
    text: "#22301f",
    mutedText: "#5b6657",
    border: "#d8d8d8",
  };
  const cool = derivePalette({ ...base, mood: "cool_professional" });
  const warm = derivePalette({ ...base, mood: "warm_organic" });
  assert.notEqual(cool.surface, warm.surface, "mood tint de oppervlakte");
  assert.notEqual(cool.border, warm.border, "mood tint de randkleur");
  assert.equal(cool.primary, base.primary, "geldende AA-kleur blijft ongewijzigd");
});

// ---------------------------------------------------------------------------
// 3. Font library — licenties, assets, @font-face
// ---------------------------------------------------------------------------

test("D1: alle fontbestanden zijn echte woff2's (magic bytes) met OFL-licentietekst", () => {
  for (const key of FONT_PAIRING_KEYS) {
    const assets = fontPairingAssets(key);
    const fonts = assets.filter((a) => a.path.endsWith(".woff2"));
    const licenses = assets.filter((a) => a.path.endsWith(".txt"));
    assert.ok(fonts.length >= 3, `${key}: te weinig fontbestanden`);
    assert.ok(licenses.length >= 1, `${key}: OFL-licentie ontbreekt`);
    for (const font of fonts) {
      assert.ok(font.bytes, `${key}: ${font.path} mist bytes`);
      const magic = String.fromCharCode(font.bytes![0], font.bytes![1], font.bytes![2], font.bytes![3]);
      assert.equal(magic, "wOF2", `${font.path} is geen woff2`);
    }
    for (const license of licenses) {
      assert.ok(license.content.includes("SIL Open Font License"), `${license.path} bevat geen OFL-verklaring`);
    }
  }
});

test("D1: @font-face-declaraties verwijzen exact naar de meegeleverde assets", () => {
  for (const key of FONT_PAIRING_KEYS) {
    const css = buildFontFaceCss(key);
    const assets = new Set(fontPairingAssets(key).map((a) => a.path.slice("assets/".length)));
    const refs = [...css.matchAll(/'([^']+\.woff2)'/g)].map((m) => m[1]);
    assert.ok(refs.length >= 3);
    for (const ref of refs) {
      assert.ok(assets.has(ref), `${key}: @font-face verwijst naar niet-meegeleverde asset "${ref}"`);
    }
    assert.ok(css.includes("font-display: swap"));
    assert.ok(css.includes("format('woff2')"));
  }
});

test("D1: fontFamilyValues behoudt systeemfallbacks per pairing", () => {
  const editorial = fontFamilyValues("editorial_serif");
  assert.ok(editorial.heading.includes("Fraunces"));
  assert.ok(editorial.heading.includes("serif"), "serif-pairing valt terug op serif-systeemfonts");
  const modern = fontFamilyValues("modern_sans");
  assert.ok(modern.heading.includes("Inter"));
  assert.ok(modern.body.includes("sans-serif"));
});

// ---------------------------------------------------------------------------
// 4. Theme-builder — backward compat (D0) en D1-activatie
// ---------------------------------------------------------------------------

test("D1: plan zonder visualContract gedraagt zich exact als D0 (systeemfonts, geen paletcorrecties)", () => {
  const tokens = buildThemeDesignTokens(D0_PLAN);
  // D0-fixture is een serif-plan (typography.pairing noemt "Serif-koppen"):
  // het D0-gedrag is system_serif (settings.font_heading default "serif").
  assert.equal(tokens.fontPairing, "system_serif");
  assert.equal(tokens.paletteMood, "neutral_default");
  assert.deepEqual(tokens.paletteCorrections, []);
  // D0-keyword-mapping blijft de autoriteit (serif-proza → systeemserif).
  const serifPlan = planWith({ typography: { pairing: "Klassiek serif met gevoel", scale: "1.25", weights: ["400"], rationale: null } });
  assert.equal(buildThemeDesignTokens(serifPlan).fontPairing, "system_serif");
  const sansPlan = planWith({ typography: { pairing: "Strakke moderne sans", scale: "1.25", weights: ["400"], rationale: null } });
  assert.equal(buildThemeDesignTokens(sansPlan).fontPairing, "system_sans");

  const files = buildShopifyTheme({ specification: SPECIFICATION, designPlan: D0_PLAN, contact: CONTACT }).files;
  assert.equal(files.filter((f) => f.path.endsWith(".woff2")).length, 0, "D0-plan levert GEEN fontbestanden");
  const layout = files.find((f) => f.path === "layout/theme.liquid")!;
  assert.ok(!layout.content.includes("@font-face { font-family"), "D0-plan krijgt geen @font-face");
});

test("D1: plan met visualContract activeert webfonts, curve, dichtheid en palet-engine", () => {
  const tokens = buildThemeDesignTokens(D1_PLAN);
  assert.equal(tokens.fontPairing, "editorial_serif");
  assert.equal(tokens.paletteMood, "premium_dark");
  assert.equal(tokens.headingScale, TYPOGRAPHIC_CURVE_SCALE.dramatic);
  assert.equal(tokens.sectionSpacing, "spacious");
  // Webfont-weights klemmen naar geleverde weights (400/600/700).
  assert.ok([400, 600, 700].includes(tokens.headingWeight));
  assert.ok([400, 600].includes(tokens.bodyWeight));

  const files = buildShopifyTheme({ specification: SPECIFICATION, designPlan: D1_PLAN, contact: CONTACT }).files;
  const woff2 = files.filter((f) => f.path.endsWith(".woff2"));
  assert.ok(woff2.length >= 5, "editorial_serif levert heading- + body-woff2 mee");
  assert.ok(files.some((f) => f.path.startsWith("assets/font-license-")), "OFL-licentiebestand aanwezig");

  const layout = files.find((f) => f.path === "layout/theme.liquid")!;
  assert.ok(layout.content.includes("@font-face { font-family"), "@font-face in theme.liquid");
  assert.ok(layout.content.includes("Fraunces"), "editorial heading-family gebouwd");
  assert.ok(layout.content.includes("{% case settings.font_pairing %}"), "merchant-switchbare case-structuur");
  assert.ok(layout.content.includes("'editorial_serif'"), "pairing-optie in de case");

  const data = JSON.parse(files.find((f) => f.path === "config/settings_data.json")!.content).current;
  assert.equal(data.font_pairing, "editorial_serif");
  assert.equal(data.palette_mood, "premium_dark");

  const schemaFile = files.find((f) => f.path === "config/settings_schema.json")!;
  const schema = JSON.parse(schemaFile.content);
  const typografie = schema.find((g: { name: string }) => g.name === "Typografie");
  const pairing = typografie.settings.find((s: { id: string }) => s.id === "font_pairing");
  assert.equal(pairing.default, "editorial_serif");
  assert.equal(pairing.options.length, 8, "2 systeemopties + 6 pairings");
  for (const option of pairing.options) {
    assert.ok(option.label.length <= 50, `option label te lang: "${option.label}"`);
  }
});

test("D1: gegenereerd thema met visualContract passeert de volledige Shopify-validatie en is byte-deterministisch", async () => {
  const build = () =>
    buildShopifyTheme({ specification: SPECIFICATION, designPlan: D1_PLAN, contact: CONTACT }).files;
  const files = build();
  const validation = validateThemeFiles(files);
  assert.equal(validation.errors.length, 0, `validatiefouten: ${validation.errors.join(" | ")}`);

  const zipA = await createThemeZip(files);
  const zipB = await createThemeZip(build());
  assert.deepEqual(Buffer.from(zipA), Buffer.from(zipB), "ZIP byte-identiek bij zelfde input");

  const readBack = await readThemeZip(zipA);
  const fraunces = readBack.find((f) => f.path === "assets/font-fraunces-400.woff2")!;
  assert.ok(fraunces.bytes, "binaire fontinhoud overleeft de ZIP-roundtrip");
  const magic = String.fromCharCode(fraunces.bytes[0], fraunces.bytes[1], fraunces.bytes[2], fraunces.bytes[3]);
  assert.equal(magic, "wOF2", "na roundtrip nog steeds woff2");
  const original = files.find((f) => f.path === "assets/font-fraunces-400.woff2")!;
  assert.deepEqual(fraunces.bytes, original.bytes, "fontbytes na roundtrip identiek");
});

test("D1: WCAG-guard past een te lichte merkkleur uit het plan deterministisch aan", () => {
  const lichtPlan = planWith({
    colors: { ...PLAN_BASE.colors, primary: "#a8c5e0" },
    visualContract: { ...CONTRACT, paletteMood: "cool_professional" },
  });
  const tokens = buildThemeDesignTokens(lichtPlan);
  assert.ok(contrastRatio(tokens.primary, tokens.background) >= 4.5, "primary als tekst AA");
  assert.ok(contrastRatio(tokens.primary, "#ffffff") >= 4.5, "primary met witte knoptekst AA");
  assert.ok(tokens.paletteCorrections.some((c) => c.includes("Primaire kleur")), "correctie gedocumenteerd");
  assert.notEqual(tokens.primary, "#a8c5e0");
});
