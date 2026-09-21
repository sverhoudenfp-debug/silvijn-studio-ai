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
  ART_COMPOSITION_KEYS,
  ART_COMPOSITION_OPTION_LABELS,
  ARCHETYPE_ART_HINTS,
  artDirectionSchema,
  type ArtDirection,
} from "../lib/websites/art-direction";
import { designPlanSchema, validateDesignPlanConsistency, type DesignPlan } from "../lib/websites/design-plan";
import { websiteBlueprintSchema } from "../lib/websites/blueprint/blueprint";
import { BLUEPRINT_ARCHETYPE_REGISTRY } from "../lib/websites/blueprint/archetypes";
import { WebsiteSpecificationSchema } from "../lib/ai/schemas";
import { buildMockDesignPlan } from "../lib/ai/mock-provider";
import { DESIGN_PLANNING_JSON_CONTRACT, buildDesignPlanPrompt } from "../lib/ai/service";
import type { WebsiteSpecification } from "../lib/websites/types";
import type { WebsiteContactContext } from "../lib/websites/generator";
import type { ProjectRequirements } from "../lib/projects/types";

// ---------------------------------------------------------------------------
// Fixtures (spiegelen de D1-suite)
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

/** Volledig geldige art direction (variant "warm" voor de diversiteitstests). */
const ART_WARM: ArtDirection = {
  concept: "Warm, uitnodigend concept met gebalanceerde beeld-tel-tekstverhouding en zachte overgangen.",
  composition: "editorial",
  brandPersonality: "warm_friendly",
  headerStyle: "centered",
  heroTreatment: "split",
  cardTreatment: "shadow",
  imageryBalance: "balanced",
  imageStyle: "framed",
  decorativeStyle: "accent_bars",
  sectionTransition: "surface_alternate",
  motionStyle: "rise",
};

/** Volledig geldige art direction (variant "immersive"). */
const ART_IMMERSIVE: ArtDirection = {
  concept: "Immersief, beeldgedreven concept met transparante header over een beeldvullende hero.",
  composition: "immersive",
  brandPersonality: "premium_refined",
  headerStyle: "overlay",
  heroTreatment: "immersive",
  cardTreatment: "flat",
  imageryBalance: "image_forward",
  imageStyle: "full_bleed",
  decorativeStyle: "none",
  sectionTransition: "hard_cut",
  motionStyle: "fade",
};

function planWith(overrides: Record<string, unknown> = {}): DesignPlan {
  return designPlanSchema.parse({ ...PLAN_BASE, ...overrides });
}

const D0_PLAN = planWith();
const D2_WARM = planWith({ artDirection: ART_WARM });
const D2_IMMERSIVE = planWith({ artDirection: ART_IMMERSIVE });

/** Minimaal geldig blueprint met beheersbare hero-layout (guard-tests). */
function blueprintWith(heroLayout: string, heroMotion = "none") {
  return websiteBlueprintSchema.parse({
    version: 2,
    pages: [
      {
        key: "home",
        title: "Home",
        purpose: "Kernpagina met aanbod en conversie.",
        seo: null,
        sectionInstances: [
          {
            type: "hero",
            layout: heroLayout,
            blocks: [],
            media: [{ role: "image", ratio: "wide", alt: null }],
            cta: { label: "Neem contact op", target: "form", prominence: "primary" },
            background: "default",
            motion: heroMotion,
            contentHints: null,
          },
          {
            type: "contact",
            layout: "split",
            blocks: [],
            media: [],
            cta: null,
            background: "default",
            motion: "none",
            contentHints: null,
          },
        ],
      },
    ],
    trustElements: { usps: [], stats: [], badges: [] },
    conversionPlan: { primaryGoal: null, leadCapture: null, contactPreference: null },
    missingInformation: ["Geen echte USP's, cijfers of reviews aangeleverd — trust-secties niet gepland."],
  });
}

const REQUIREMENTS: ProjectRequirements = { numberOfPages: 1 };

// ---------------------------------------------------------------------------
// 1. Contract — enum-gesloten catalogus
// ---------------------------------------------------------------------------

test("D2: artDirection-schema accepteert exact de catalogus en weigert eigen waarden", () => {
  const parsed = artDirectionSchema.parse(ART_WARM);
  assert.equal(parsed.composition, "editorial");
  assert.equal(parsed.headerStyle, "centered");
  assert.equal(parsed.motionStyle, "rise");

  assert.equal(artDirectionSchema.safeParse({ ...ART_WARM, composition: "vibes" }).success, false);
  assert.equal(artDirectionSchema.safeParse({ ...ART_WARM, cardTreatment: "glitter" }).success, false);
  assert.equal(artDirectionSchema.safeParse({ ...ART_WARM, heroTreatment: "beamer" }).success, false);
  assert.equal(artDirectionSchema.safeParse({ ...ART_WARM, concept: "" }).success, false);
  assert.equal(artDirectionSchema.safeParse({ ...ART_WARM, concept: "x".repeat(301) }).success, false);
  // Alle tien de enum-velden zijn verplicht.
  for (const key of ["composition", "brandPersonality", "headerStyle", "heroTreatment", "cardTreatment", "imageryBalance", "imageStyle", "decorativeStyle", "sectionTransition", "motionStyle"]) {
    const partial = { ...ART_WARM } as Record<string, unknown>;
    delete partial[key];
    assert.equal(artDirectionSchema.safeParse(partial).success, false, `${key} moet verplicht zijn`);
  }
});

test("D2: compositie-optielabels zijn max 50 tekens (hardste Shopify-regel)", () => {
  assert.equal(ART_COMPOSITION_KEYS.length, 6);
  for (const label of Object.values(ART_COMPOSITION_OPTION_LABELS)) {
    assert.ok(label.length <= 50, `compositielabel te lang: "${label}"`);
  }
});

test("D2: archetype-art-hints dekken alle vier de archetypen met geldige composities", () => {
  for (const key of Object.keys(BLUEPRINT_ARCHETYPE_REGISTRY)) {
    const hint = ARCHETYPE_ART_HINTS[key as keyof typeof ARCHETYPE_ART_HINTS];
    assert.ok(hint, `geen art-hint voor archetype ${key}`);
    assert.ok(ART_COMPOSITION_KEYS.includes(hint.composition), `hint-compositie ongeldig voor ${key}`);
    for (const alt of hint.alternatives) {
      assert.ok(ART_COMPOSITION_KEYS.includes(alt), `alternatief ongeldig voor ${key}`);
    }
    assert.notEqual(hint.alternatives.includes(hint.composition), true, "alternatief duplicaat");
  }
});

test("D2: mock-plan levert een contract-conforme artDirection (heroTreatment == blueprint-hero)", () => {
  const mockPlan = designPlanSchema.parse(JSON.parse(buildMockDesignPlan("mock-prompt")));
  assert.ok(mockPlan.artDirection, "mock heeft artDirection");
  assert.equal(artDirectionSchema.safeParse(mockPlan.artDirection).success, true);
  const hero = mockPlan.blueprint?.pages[0].sectionInstances.find((i) => i.type === "hero");
  assert.ok(hero, "mock heeft blueprint met hero");
  assert.equal(hero?.layout, mockPlan.artDirection?.heroTreatment);
  const consistency = validateDesignPlanConsistency(mockPlan, REQUIREMENTS);
  assert.equal(consistency.passed, true, `mock-consistency: ${consistency.errors.join(" | ")}`);
});

// ---------------------------------------------------------------------------
// 2. Backward compat — plannen zonder artDirection zijn exact D0/D1
// ---------------------------------------------------------------------------

test("D2: plan zonder artDirection blijft exact geldig en levert géén D2-artefacten", () => {
  assert.equal(D0_PLAN.artDirection, undefined);
  assert.equal(buildThemeDesignTokens(D0_PLAN).artDirection, null);

  const files = buildShopifyTheme({ specification: SPECIFICATION, designPlan: D0_PLAN, contact: CONTACT }).files;
  assert.ok(!files.some((f) => f.path === "assets/art-direction.css"), "D0 krijgt geen art-direction.css");
  const layout = files.find((f) => f.path === "layout/theme.liquid")!;
  assert.ok(!layout.content.includes("art-direction.css"), "D0-layout koppelt art-direction.css niet");
  assert.ok(!layout.content.includes("ad-{{ settings.composition }}"), "D0-layout heeft geen compositieklasse");
  const schemaFile = files.find((f) => f.path === "config/settings_schema.json")!;
  assert.ok(!schemaFile.content.includes('"id": "composition"'), "D0-schema heeft geen composition-setting");
  const dataFile = files.find((f) => f.path === "config/settings_data.json")!;
  assert.ok(!dataFile.content.includes('"composition"'), "D0-data heeft geen composition-key");
  const group = JSON.parse(files.find((f) => f.path === "sections/header-group.json")!.content);
  const headerSettings = group.sections.header.settings;
  assert.ok(!("layout" in headerSettings), "D0-header-group zonder layout-default");
  assert.ok(!("sticky" in headerSettings), "D0-header-group zonder sticky-default");
});

test("D2: plan met artDirection activeert de volledige D2-laag", () => {
  const tokens = buildThemeDesignTokens(D2_WARM);
  assert.equal(tokens.artDirection?.composition, "editorial");
  assert.equal(tokens.heroLayout, "split", "heroTreatment uit het contract wint");

  const files = buildShopifyTheme({ specification: SPECIFICATION, designPlan: D2_WARM, contact: CONTACT }).files;
  const art = files.find((f) => f.path === "assets/art-direction.css");
  assert.ok(art, "art-direction.css aanwezig");
  const layout = files.find((f) => f.path === "layout/theme.liquid")!;
  assert.ok(layout.content.includes("'art-direction.css' | asset_url"), "layout koppelt art-direction.css");
  assert.ok(layout.content.includes("ad-{{ settings.composition }}"), "compositie-bodyclass");

  const schemaJson = JSON.parse(files.find((f) => f.path === "config/settings_schema.json")!.content);
  const layoutGroup = schemaJson.find((g: { name?: string }) => g.name === "Layout");
  const compositionSetting = layoutGroup.settings.find((s: { id?: string }) => s.id === "composition");
  assert.ok(compositionSetting, "composition-setting in de Layout-groep");
  assert.equal(compositionSetting.default, "editorial");
  assert.equal(compositionSetting.options.length, 6, "alle zes composities switchbaar");
  for (const option of compositionSetting.options) {
    assert.ok(option.label.length <= 50, `optielabel te lang: "${option.label}"`);
  }

  const dataJson = JSON.parse(files.find((f) => f.path === "config/settings_data.json")!.content);
  assert.equal(dataJson.current.composition, "editorial");

  const group = JSON.parse(files.find((f) => f.path === "sections/header-group.json")!.content);
  assert.equal(group.sections.header.settings.layout, "centered", "headerStyle-default");
  assert.equal(group.sections.header.settings.sticky, true);
  assert.equal(group.sections.header.settings.show_cta, true);
});

// ---------------------------------------------------------------------------
// 3. Header — verplichte core component met echte varianten
// ---------------------------------------------------------------------------

test("D2: header-sectie is een volwaardige core component (varianten, logo, mobiel, state)", () => {
  const files = buildShopifyTheme({ specification: SPECIFICATION, designPlan: D2_WARM, contact: CONTACT }).files;
  const header = files.find((f) => f.path === "sections/header.liquid")!;
  const schemaMatch = header.content.match(/"settings": \[([\s\S]*?)\]/);
  assert.ok(schemaMatch, "header-schema settings aanwezig");
  const layoutOptions = header.content.match(/"id": "layout"[\s\S]*?"options": (\[[\s\S]*?\])/);
  assert.ok(layoutOptions, "layout-varianten in schema");
  const options = JSON.parse(layoutOptions[1]);
  assert.equal(options.length, 4, "vier header-layoutvarianten");
  for (const option of options) {
    assert.ok(option.label.length <= 50, `header-optielabel te lang: "${option.label}"`);
  }
  assert.ok(header.content.includes('"id": "logo"'), "logo-setting");
  assert.ok(header.content.includes('"id": "sticky"'), "sticky-setting");
  assert.ok(header.content.includes('"id": "show_cta"'), "show_cta-setting");
  assert.ok(header.content.includes("data-nav-toggle"), "mobiele toggle");
  assert.ok(header.content.includes("site-header--{{ section.settings.layout"), "variant-klasse");
  assert.ok(header.content.includes('aria-expanded'), "aria-state op de toggle");

  const css = files.find((f) => f.path === "assets/theme.css")!.content;
  assert.ok(css.includes(".site-header--centered"), "centered-variant in CSS");
  assert.ok(css.includes(".site-header--split"), "split-variant in CSS");
  assert.ok(css.includes(".site-header--overlay"), "overlay-variant in CSS");
  assert.ok(css.includes(".site-header--scrolled"), "scrolled-state in CSS");
  assert.ok(css.includes('[aria-current="page"]'), "active-nav-state in CSS");
  assert.ok(css.includes(".site-header__logo"), "logo-stijl in CSS");
  assert.ok(css.includes("@media (max-width: 989px)"), "mobiel menu-breakpoint");

  const js = files.find((f) => f.path === "assets/theme.js")!.content;
  assert.ok(js.includes("site-header--scrolled"), "JS scrolled-state");
  assert.ok(js.includes("aria-current"), "JS active-nav-state");
  assert.ok(js.includes("Escape"), "Escape sluit het mobiele menu");
});

test("D2: alle vier de header-composities renderen zonder overlay zijn exact de oude look", () => {
  // minimal = de historische D0-header: flex space-between, geen extra regio's.
  const css = buildShopifyTheme({ specification: SPECIFICATION, designPlan: D0_PLAN, contact: CONTACT }).files
    .find((f) => f.path === "assets/theme.css")!.content;
  assert.ok(css.includes(".site-header__inner { display: flex; align-items: center; gap: 16px; justify-content: space-between"), "minimal-variant behoudt de D0-structuur");
});

// ---------------------------------------------------------------------------
// 4. Hero immersive + guards
// ---------------------------------------------------------------------------

test("D2: heroTreatment 'immersive' levert de immersive-variant (schema, CSS, géén mediaband)", () => {
  const tokens = buildThemeDesignTokens(D2_IMMERSIVE);
  assert.equal(tokens.heroLayout, "immersive");

  const files = buildShopifyTheme({ specification: SPECIFICATION, designPlan: D2_IMMERSIVE, contact: CONTACT }).files;
  const dataJson = JSON.parse(files.find((f) => f.path === "config/settings_data.json")!.content);
  assert.equal(dataJson.current.hero_layout, "immersive");
  const schemaJson = JSON.parse(files.find((f) => f.path === "config/settings_schema.json")!.content);
  const heroOptions = JSON.stringify(schemaJson).match(/"id":\s*"hero_layout"[\s\S]*?"options":\s*(\[[\s\S]*?\])/);
  assert.equal(JSON.parse(heroOptions![1]).length, 4, "vier hero-layoutopties");

  const heroLiquid = files.find((f) => f.path === "sections/hero.liquid")!.content;
  assert.ok(heroLiquid.includes("hero_layout != 'split' and hero_layout != 'immersive'"), "immersive slaat de mediaband over");
  const css = files.find((f) => f.path === "assets/theme.css")!.content;
  assert.ok(css.includes(".hero--immersive"), "immersive-hero-CSS in de kern");
});

test("D2: consistency-guard weigert hero-inkohérentie tussen artDirection en blueprint", () => {
  const plan = planWith({ artDirection: ART_WARM, blueprint: blueprintWith("centered") });
  const result = validateDesignPlanConsistency(plan, REQUIREMENTS);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes("heroTreatment")), "hero-mismatch gerapporteerd");
  // En de coherente variant slaagt op dít veld:
  const coherent = planWith({ artDirection: ART_WARM, blueprint: blueprintWith("split") });
  const result2 = validateDesignPlanConsistency(coherent, REQUIREMENTS);
  assert.ok(!result2.errors.some((e) => e.includes("heroTreatment")), "coherente hero geen fout");
});

test("D2: motionLevel 'none' blokkeert elke blueprint-motion (ook zonder artDirection)", () => {
  const plan = planWith({
    visualContract: { fontPairing: "geometric_sans", paletteMood: "monochrome", typographicCurve: "balanced", density: "normal", motionLevel: "none" },
    artDirection: ART_WARM,
    blueprint: blueprintWith("split", "fade_up"),
  });
  const result = validateDesignPlanConsistency(plan, REQUIREMENTS);
  assert.ok(result.errors.some((e) => e.includes("motionLevel")), "motion-mismatch gerapporteerd");
  const still = planWith({
    visualContract: { fontPairing: "geometric_sans", paletteMood: "monochrome", typographicCurve: "balanced", density: "normal", motionLevel: "none" },
    artDirection: ART_WARM,
    blueprint: blueprintWith("split", "none"),
  });
  const result2 = validateDesignPlanConsistency(still, REQUIREMENTS);
  assert.ok(!result2.errors.some((e) => e.includes("motionLevel")), "coherente motion geen fout");
});

// ---------------------------------------------------------------------------
// 5. Art-direction.css — inhoud, anti-template, motion
// ---------------------------------------------------------------------------

test("D2: art-direction.css bevat de zes compositie-blokken + regels voor de gekozen enums", () => {
  const files = buildShopifyTheme({ specification: SPECIFICATION, designPlan: D2_WARM, contact: CONTACT }).files;
  const art = files.find((f) => f.path === "assets/art-direction.css")!.content;
  // Alle zes composities switchbaar (merchant kan wijzigen):
  for (const key of ART_COMPOSITION_KEYS) {
    assert.ok(art.includes(`body.ad-${key} `), `compositieblok ${key} ontbreekt`);
  }
  // De gekozen enums:
  assert.ok(art.includes("box-shadow"), "cardTreatment shadow");
  assert.ok(art.includes("accent-bar") || art.includes(".section__header h2::before"), "decorativeStyle accent_bars");
  assert.ok(art.includes("nth-of-type(even)"), "sectionTransition surface_alternate");
  assert.ok(art.includes("ad-rise"), "motionStyle rise");
  assert.ok(art.includes("@keyframes ad-rise"), "rise-keyframes");
  assert.ok(!art.includes("animation-duration"), "motion overschrijft geen duur");
});

test("D2: anti-template — verschillende artDirections leverten wezenlijk andere thema's", () => {
  const warm = buildShopifyTheme({ specification: SPECIFICATION, designPlan: D2_WARM, contact: CONTACT }).files;
  const immersive = buildShopifyTheme({ specification: SPECIFICATION, designPlan: D2_IMMERSIVE, contact: CONTACT }).files;

  const artWarm = warm.find((f) => f.path === "assets/art-direction.css")!.content;
  const artImmersive = immersive.find((f) => f.path === "assets/art-direction.css")!.content;
  assert.notEqual(artWarm, artImmersive, "art-direction.css verschilt per contract");

  const groupWarm = JSON.parse(warm.find((f) => f.path === "sections/header-group.json")!.content);
  const groupImmersive = JSON.parse(immersive.find((f) => f.path === "sections/header-group.json")!.content);
  assert.notEqual(groupWarm.sections.header.settings.layout, groupImmersive.sections.header.settings.layout, "header-variant verschilt");
  assert.equal(groupImmersive.sections.header.settings.layout, "overlay");

  const dataWarm = JSON.parse(warm.find((f) => f.path === "config/settings_data.json")!.content);
  const dataImmersive = JSON.parse(immersive.find((f) => f.path === "config/settings_data.json")!.content);
  assert.notEqual(dataWarm.current.hero_layout, dataImmersive.current.hero_layout, "hero-variant verschilt");
  assert.equal(dataImmersive.current.hero_layout, "immersive");
});

test("D2: motion-stijlen fade/rise/scale bestaan als keyframes; reduced-motion onverkort", () => {
  const base = buildShopifyTheme({ specification: SPECIFICATION, designPlan: D2_WARM, contact: CONTACT }).files;
  const themeCss = base.find((f) => f.path === "assets/theme.css")!.content;
  assert.ok(themeCss.includes("prefers-reduced-motion"), "reduced-motion blijft in theme.css");
  assert.ok(themeCss.includes("animation: none !important"), "reduced-motion schakelt motion uit");
  for (const style of ["fade", "scale"]) {
    const art = planWith({
      artDirection: { ...ART_WARM, motionStyle: style },
    });
    const files = buildShopifyTheme({ specification: SPECIFICATION, designPlan: art, contact: CONTACT }).files;
    const css = files.find((f) => f.path === "assets/art-direction.css")!.content;
    assert.ok(css.includes(`@keyframes ad-${style}`), `keyframes ad-${style}`);
  }
});

// ---------------------------------------------------------------------------
// 6. AI-contract — prompt levert de volledige enum-catalogus aan
// ---------------------------------------------------------------------------

test("D2: JSON-contract bevat artDirection met alle enum-opties", () => {
  const contract = DESIGN_PLANNING_JSON_CONTRACT;
  assert.ok(contract.includes("artDirection: VERPLICHT object"), "artDirection in het JSON-contract");
  for (const key of ART_COMPOSITION_KEYS) {
    assert.ok(contract.includes(key), `compositie-optie ${key} in het contract`);
  }
  for (const key of ["minimal", "centered", "split", "overlay"]) {
    assert.ok(contract.includes(key), `header-optie ${key} in het contract`);
  }
  for (const key of ["focused", "centered", "split", "immersive"]) {
    assert.ok(contract.includes(key), `hero-optie ${key} in het contract`);
  }
  for (const key of ["bordered", "shadow", "flat", "accent_top"]) {
    assert.ok(contract.includes(key), `kaartoptie ${key} in het contract`);
  }
});

test("D2: design-prompt noemt ART DIRECTION-regels én archetype-hints", () => {
  const prompt = buildDesignPlanPrompt({
    businessName: "Hovenier van Dijk",
    industry: "hovenier en tuinonderhoud",
    city: "Apeldoorn",
    province: "Gelderland",
    leadNotes: [],
    requirementsSummary: "3 pagina's, contactformulier",
    numberOfPages: 3,
    ecommerce: null,
    specialRequirements: null,
    existingWebsite: false,
    googleRating: null,
    reviewCount: null,
    questionnaireSummary: [],
    hasCompletedQuestionnaire: false,
    suggestedTemplate: "local_service",
  });
  assert.ok(prompt.includes("ART DIRECTION"), "ART DIRECTION-regel in de prompt");
  assert.ok(prompt.includes("ART DIRECTION-RICHTING"), "archetype-hint in de prompt");
});

// ---------------------------------------------------------------------------
// 7. Validator + ZIP — D2-thema's zijn valide en deterministisch
// ---------------------------------------------------------------------------

test("D2: volledig D2-thema passeert de validatie en is ZIP-deterministisch", async () => {
  const build = () => buildShopifyTheme({ specification: SPECIFICATION, designPlan: D2_IMMERSIVE, contact: CONTACT }).files;
  const validation = validateThemeFiles(build());
  assert.equal(validation.errors.length, 0, `validatiefouten: ${validation.errors.join(" | ")}`);

  const zipA = await createThemeZip(build());
  const zipB = await createThemeZip(build());
  assert.deepEqual(Buffer.from(zipA), Buffer.from(zipB), "ZIP byte-identiek bij zelfde input");
  const readBack = await readThemeZip(zipA);
  assert.ok(readBack.some((f) => f.path === "assets/art-direction.css"), "art-direction.css overleeft de roundtrip");
});

test("D2: validator weigert gekoppelde art-direction.css zonder bestand en vice versa", () => {
  const files = buildShopifyTheme({ specification: SPECIFICATION, designPlan: D2_WARM, contact: CONTACT }).files;

  // (a) koppeling zonder bestand
  const withoutFile = files.filter((f) => f.path !== "assets/art-direction.css");
  const resultA = validateThemeFiles(withoutFile);
  assert.ok(resultA.errors.some((e) => e.includes("art-direction.css")), "koppeling zonder bestand geweigerd");

  // (b) bestand zonder koppeling
  const withoutLink = files.map((f) =>
    f.path === "layout/theme.liquid" ? { ...f, content: f.content.replace("{{ 'art-direction.css' | asset_url | stylesheet_tag }}\n", "") } : f
  );
  const resultB = validateThemeFiles(withoutLink);
  assert.ok(resultB.errors.some((e) => e.includes("art-direction.css")), "bestand zonder koppeling geweigerd");

  // (c) koppeling zonder compositie-bodyclass
  const withoutClass = files.map((f) =>
    f.path === "layout/theme.liquid" ? { ...f, content: f.content.replace(" ad-{{ settings.composition }}", "") } : f
  );
  const resultC = validateThemeFiles(withoutClass);
  assert.ok(resultC.errors.some((e) => e.includes("compositie-bodyclass")), "koppeling zonder bodyclass geweigerd");
});
