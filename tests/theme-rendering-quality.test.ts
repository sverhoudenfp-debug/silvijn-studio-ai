import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken (zelfde patroon als de andere theme-tests).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import {
  buildShopifyTheme,
  buildThemeDesignTokens,
  styleProfileFor,
  type BuiltTheme,
} from "../lib/websites/theme-zip/theme-builder";
import { designPlanSchema, type DesignPlan } from "../lib/websites/design-plan";
import { BLUEPRINT_SECTION_REGISTRY, type BlueprintSectionType } from "../lib/websites/blueprint/section-registry";
import { shopifySectionType, composeBlueprintTemplates } from "../lib/websites/theme-zip/blueprint-composition";
import { websiteBlueprintSchema, type WebsiteBlueprint } from "../lib/websites/blueprint/blueprint";
import { WebsiteSpecificationSchema } from "../lib/ai/schemas";
import type { WebsiteSpecification } from "../lib/websites/types";
import type { WebsiteContactContext } from "../lib/websites/generator";

// ---------------------------------------------------------------------------
// Rendering-stap 1 (2026-09-19): visuele kwaliteit van het gegenereerde
// Shopify-thema — DAADWERKELIJK onderscheidende layoutvarianten, correcte
// stagger-met-reduced-motion, echte media-achtergronden (nooit gradient),
// deterministische Design Plan-intentie-vertaling (stijlprofiel, dichtheid)
// en sectieritme. Alles deterministisch; geen AI, geen gates.
// ---------------------------------------------------------------------------

const CONTACT: WebsiteContactContext = {
  phone: "+31555012345",
  email: "info@example.test",
  address: "Straat 1",
  city: "Apeldoorn",
  province: "Gelderland",
};

const SPECIFICATION: WebsiteSpecification = WebsiteSpecificationSchema.parse({
  template: "business_standard",
  business: {
    businessName: "Testbedrijf B.V.",
    industry: "designstudio",
    city: "Utrecht",
    province: "Utrecht",
    description: null,
    targetAudience: null,
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
      { key: "about", title: "Over ons" },
      { key: "contact", title: "Contact" },
    ],
    navigation: ["Home", "Over ons", "Contact"],
    sections: [],
  },
  content: {
    headline: "Kop voor de test",
    subheadline: null,
    valueProposition: "Waardepropositie uit de specificatie",
    services: [
      { title: "Testdienst A", description: "Eerste dienst." },
      { title: "Testdienst B", description: "Tweede dienst." },
    ],
    about: "Echt verhaal uit de specificatie.",
    benefits: ["Echt voordeel"],
    faq: [{ question: "Echte vraag?", answer: "Echt antwoord." }],
    testimonials: ["Echte uitspraak uit de specificatie."],
    contactIntro: "Neem gerust contact op.",
    ctaPrimaryText: "Neem contact op",
    ctaSecondaryText: null,
  },
  conversion: { primaryCta: "contact", secondaryCta: null, contactMethods: [], leadCapture: true },
  media: { imageRequirements: [], imageDescriptions: [], imagePlaceholders: [] },
  seo: {
    title: "Testbedrijf — Utrecht",
    metaDescription: "Testmeta-omschrijving.",
    keywords: [],
    localArea: "Utrecht",
  },
  missingInformation: [],
}) as WebsiteSpecification;

function planInput(): Record<string, unknown> {
  return {
    goals: { primaryGoal: null, secondaryGoals: [], conversionGoal: null },
    audience: { primaryAudience: null, secondaryAudiences: [], toneOfVoice: null },
    navigation: {
      items: [
        { label: "Home", pageKey: "home" },
        { label: "Over ons", pageKey: "over-ons" },
        { label: "Contact", pageKey: "contact" },
      ],
      structure: null,
    },
    pageStructure: [
      { key: "home", title: "Home", purpose: "Landingspagina", sections: ["hero"] },
      { key: "over-ons", title: "Over ons", purpose: "Verhaal", sections: ["about"] },
      { key: "contact", title: "Contact", purpose: "Conversie", sections: ["contact"] },
    ],
    visualHierarchy: { strategy: null, aboveTheFold: [] },
    branding: {
      styleDirection: "Minimalistisch en modern",
      mood: ["strak"],
      existingBrandAssets: null,
      preferredColors: [],
      dislikedColors: [],
      restrictions: [],
    },
    typography: { pairing: null, scale: null, weights: [], rationale: null },
    colors: { primary: null, secondary: null, accent: null, neutrals: [], usageGuidance: null },
    spacing: { scale: null, density: "ruim" },
    components: [{ key: "hero", purpose: "Eerste indruk", notes: null }],
    ctaStrategy: { primary: null, secondary: null, placement: [], leadCapture: null },
    imagery: { style: null, requirements: [], placeholderStrategy: null },
    responsive: { mobile: null, tablet: null, desktop: null, breakpoints: [] },
    animation: { strategy: null, allowed: [], restrictions: [] },
    functionality: { features: [], integrations: [] },
    accessibility: { contrast: null, focusAndKeyboard: null, semantics: null, formsAndLabels: null, guidelines: [] },
    seoPerformance: {
      titleStrategy: null,
      metaStrategy: null,
      localSeo: null,
      performanceBudget: null,
      imageOptimization: null,
    },
    basis: { sources: ["lead"] },
    missingInformation: [],
  };
}

function plan(): DesignPlan {
  return designPlanSchema.parse(planInput());
}

function builtTheme(): BuiltTheme {
  return buildShopifyTheme({ specification: SPECIFICATION, designPlan: plan(), contact: CONTACT });
}

function fileContent(files: BuiltTheme["files"], path: string): string {
  const file = files.find((f) => f.path === path);
  assert.ok(file, `verwacht bestand ${path}`);
  return file.content;
}

/** Alle 18 blueprint-sectiebestanden (kebab-case) uit de SECTION-REGISTRY. */
const ALL_SECTION_FILES = (Object.keys(BLUEPRINT_SECTION_REGISTRY) as BlueprintSectionType[]).map(
  (type) => `sections/${shopifySectionType(type)}.liquid`
);

// ---------------------------------------------------------------------------

test("rendering: ELKE layoutvariant uit de SECTION-REGISTRY heeft een CSS-regel in theme.css", () => {
  const css = fileContent(builtTheme().files, "assets/theme.css");
  for (const type of Object.keys(BLUEPRINT_SECTION_REGISTRY) as BlueprintSectionType[]) {
    const file = shopifySectionType(type);
    for (const layout of BLUEPRINT_SECTION_REGISTRY[type].layouts) {
      assert.ok(
        css.includes(`.${file}--${layout.key}`),
        `theme.css mist layoutvariant .${file}--${layout.key} (registry: ${type})`
      );
    }
  }
});

test("rendering: hero-varianten zijn structureel onderscheidend (niet alleen een max-width)", () => {
  const css = fileContent(builtTheme().files, "assets/theme.css");
  // focused: smal + extra witruimte
  assert.ok(css.includes(".hero--focused .hero__inner { max-width: 640px; }"));
  assert.ok(css.includes(".hero--focused { padding-block: calc(var(--section-spacing) * 1.3); }"));
  // band: lage, gecentreerde band met kleinere kop
  assert.ok(css.includes(".hero--band .hero__inner { max-width: 860px; margin-inline: auto; text-align: center; }"));
  assert.ok(css.includes(".hero--band h1 { font-size: calc(1.9rem * var(--heading-scale)); }"));
  // minimal: sobere kernzin met kleinere kop
  assert.ok(css.includes(".hero--minimal h1 { font-size: calc(1.7rem * var(--heading-scale)); }"));
});

test("rendering: cta-varianten hebben een eigen compositie (band gecentreerd, split tweekoloms, closing compact)", () => {
  const files = builtTheme().files;
  const css = fileContent(files, "assets/theme.css");
  const liquid = fileContent(files, "sections/cta.liquid");
  // Structuur bestaat en geen inline-styled section__header meer
  assert.ok(liquid.includes("cta__inner"));
  assert.ok(liquid.includes("cta__copy"));
  assert.ok(liquid.includes("cta__action"));
  assert.ok(!liquid.includes('style="text-align:center'));
  assert.ok(!liquid.includes('style="margin-top:20px;"'));
  // band: gecentreerd + grote knop
  assert.ok(css.includes(".cta--band .cta__inner { max-width: 760px; margin-inline: auto; text-align: center; }"));
  assert.ok(css.includes(".cta--band .cta__button { padding: 16px 32px; font-size: 1.05rem; }"));
  // split: tweekoloms met rechts uitgelijnde actie
  assert.ok(css.includes(".cta--split .cta__inner { display: grid;"));
  assert.ok(css.includes(".cta--split .cta__action { margin-top: 0; text-align: right; }"));
  // closing: compact
  assert.ok(css.includes(".cta--closing .cta__inner { max-width: 560px; margin-inline: auto; text-align: center; }"));
});

test("rendering: contact-varianten onderscheidend (full breed met scheiding, minimal compact)", () => {
  const files = builtTheme().files;
  const css = fileContent(files, "assets/theme.css");
  const liquid = fileContent(files, "sections/contact.liquid");
  assert.ok(liquid.includes("contact__details"));
  assert.ok(css.includes(".contact--full .contact-grid { grid-template-columns: 1fr; max-width: 760px; }"));
  assert.ok(css.includes(".contact--full .contact__details { border-bottom: 1px solid var(--color-border);"));
  assert.ok(css.includes(".contact--minimal { padding-block: calc(var(--section-spacing) * .6); }"));
  assert.ok(css.includes(".contact--minimal .contact__details p { margin: 0 0 .35em; }"));
});

test("rendering: stagger animeert de BETEKENISvolle binnenblokken (niet de container) met nth-child-vertragingen", () => {
  const css = fileContent(builtTheme().files, "assets/theme.css");
  // Binnenblokken i.p.v. directe sectiekinderen (container is één kind)
  assert.ok(css.includes(".motion--stagger .section__header { animation: bp-fade-up"));
  assert.ok(css.includes(".motion--stagger :where(.card-grid, .process-list, .stats-row, .usp-row"));
  assert.ok(css.includes("> *:nth-child(2) { animation-delay: .07s; }"));
  assert.ok(css.includes("> *:nth-child(8) { animation-delay: .49s; }"));
  // Het oude, zinloze .motion--stagger > * patroon bestaat niet meer
  assert.ok(!css.includes(".motion--stagger > * {"));
});

test("rendering: prefers-reduced-motion schakelt álle sectie-animaties uit (fade_up én stagger)", () => {
  const css = fileContent(builtTheme().files, "assets/theme.css");
  // Er bestaan twee reduce-query's: de .btn-transitie (basis) en de
  // sectie-animaties (motion-segment). Laatstgenoemde moet fade_up én
  // stagger volledig uitschakelen.
  const matches = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\}/g)];
  assert.ok(matches.length >= 2, "verwacht minimaal twee reduced-motion-blocks");
  const motionBlock = matches.map((m) => m[0]).find((b) => b.includes(".motion--"));
  assert.ok(motionBlock, "geen reduced-motion-block dat motion-klassen uitschakelt");
  assert.ok(motionBlock.includes("animation: none"), "reduced-motion schakelt animaties niet uit");
  assert.ok(motionBlock.includes(".motion--stagger"), "reduced-motion noemt stagger niet");
  assert.ok(motionBlock.includes(".motion--fade_up"), "reduced-motion noemt fade_up niet");
});

test("rendering: achtergrondvariant image is ÉCHTE media — geen gradient-fallback meer", () => {
  const files = builtTheme().files;
  const css = fileContent(files, "assets/theme.css");
  const bgRule = css.slice(css.indexOf(".section--bg-image"), css.indexOf(".section--bg-image") + 120);
  assert.ok(!bgRule.includes("linear-gradient"), "bg-image mag geen gradient-fallback meer zijn");
  // Media-laag + overlay bestaan als echte CSS
  assert.ok(css.includes(".section__background { position: absolute; inset: 0;"));
  assert.ok(css.includes(".section__background-overlay { position: absolute; inset: 0;"));
  assert.ok(css.includes(".section__background .theme-media { height: 100%; aspect-ratio: auto;"));
  // Snippet bestaat en rendert theme-media (afbeelding óf placeholder)
  const snippet = fileContent(files, "snippets/section-background.liquid");
  assert.ok(snippet.includes("section__background"));
  assert.ok(snippet.includes("render 'theme-media'"));
  assert.ok(snippet.includes("aria-hidden"));
});

test("rendering: álle 18 blueprint-secties ondersteunen de beeld-achtergrond (guard + render + settings)", () => {
  const files = builtTheme().files;
  for (const path of ALL_SECTION_FILES) {
    const liquid = fileContent(files, path);
    assert.ok(
      liquid.includes("section.settings.background == 'image'"),
      `${path} mist de beeld-achtergrond-guard`
    );
    assert.ok(liquid.includes("render 'section-background'"), `${path} rendert de achtergrondlaag niet`);
    assert.ok(liquid.includes('"background_image"'), `${path} mist de background_image-setting`);
    assert.ok(liquid.includes('"background_overlay"'), `${path} mist de background_overlay-setting`);
  }
});

test("rendering: stijlprofiel komt deterministisch uit Design Plan mood/styleDirection", () => {
  assert.equal(styleProfileFor("Minimalistisch en modern", ["strak"]), "sharp");
  assert.equal(styleProfileFor(null, ["zacht", "warm"]), "soft");
  assert.equal(styleProfileFor("Luxe en elegant", []), "premium");
  assert.equal(styleProfileFor(null, []), "neutral");
  // Premium-woorden winnen van strak-woorden (profielvolgorde, geen toeval)
  assert.equal(styleProfileFor("Premium service, strak vormgegeven", []), "premium");
});

test("rendering: stijlprofiel stroomt door naar settings, body-klasse en CSS", () => {
  const files = builtTheme().files;
  const tokens = buildThemeDesignTokens(plan());
  assert.equal(tokens.styleProfile, "sharp"); // fixture: "Minimalistisch en modern" + strak
  const schema = fileContent(files, "config/settings_schema.json");
  assert.ok(schema.includes('"id": "style_profile"'));
  assert.ok(schema.includes('"default": "sharp"'));
  const settingsData = fileContent(files, "config/settings_data.json");
  assert.ok(settingsData.includes('"style_profile": "sharp"'));
  const layout = fileContent(files, "layout/theme.liquid");
  assert.ok(layout.includes("style-{{ settings.style_profile | default: 'neutral' }}"));
  const css = fileContent(files, "assets/theme.css");
  assert.ok(css.includes(".style-sharp h1, .style-sharp h2, .style-sharp h3 { letter-spacing: -0.02em; }"));
  assert.ok(css.includes(".style-premium .section__header { text-align: center; margin-inline: auto; }"));
  assert.ok(css.includes(".style-soft .section__header h2::after"));
});

test("rendering: sectiedichtheid uit het Design Plan is settings-gedreven (schema-default + liquid-mapping)", () => {
  const files = builtTheme().files;
  const tokens = buildThemeDesignTokens(plan());
  assert.equal(tokens.sectionSpacing, "spacious"); // plan.spacing.density = "ruim"
  const schema = fileContent(files, "config/settings_schema.json");
  assert.ok(schema.includes('"id": "section_spacing"'));
  assert.ok(schema.includes('"default": "spacious"'), "schema-default volgt het Design Plan");
  const layout = fileContent(files, "layout/theme.liquid");
  assert.ok(layout.includes("{% case settings.section_spacing %}{% when 'compact' %}48px{% when 'spacious' %}112px{% else %}72px{% endcase %}"));
  // theme.css :root overschrijft de setting niet meer (geen tweede --section-spacing)
  const css = fileContent(files, "assets/theme.css");
  assert.ok(!css.includes(":root {\n  --section-spacing"), "theme.css mag --section-spacing niet meer zelf zetten");
  assert.ok(css.includes("var(--section-spacing)"), "section-spacing custom property moet wel gebruikt worden");
});

test("rendering: sectieritme — aangrenzende default-secties krijgen deterministisch contrast, volgorde exact behouden", () => {
  const blueprint = websiteBlueprintSchema.parse({
    version: 2,
    pages: [
      {
        key: "home",
        title: "Home",
        purpose: "Landingspagina",
        seo: null,
        sectionInstances: [
          { type: "hero", layout: "centered", blocks: [], media: [], cta: null, background: "default", motion: "none", contentHints: null },
          { type: "services", layout: "cards", blocks: [{ kind: "service", hint: "Eerste dienst" }, { kind: "service", hint: "Tweede dienst" }], media: [], cta: null, background: "default", motion: "none", contentHints: null },
          { type: "cta", layout: "band", blocks: [], media: [], cta: { label: "Contact", target: "form", prominence: "primary" }, background: "default", motion: "none", contentHints: null },
        ],
      },
    ],
    trustElements: { usps: [], stats: [], badges: [] },
    conversionPlan: { primaryGoal: "Contact", leadCapture: true, contactPreference: "form" },
    missingInformation: [],
  }) as WebsiteBlueprint;

  const result = composeBlueprintTemplates({ blueprint, spec: SPECIFICATION, contact: CONTACT });
  const index = result.templates.find((t) => t.path === "templates/index.json")!;
  const data = JSON.parse(JSON.stringify(index.data)) as {
    sections: Record<string, { type: string; settings: { background: string } }>;
    order: string[];
  };
  assert.deepEqual(data.order, ["hero", "services", "cta"]);
  assert.equal(data.sections.hero.settings.background, "default");
  assert.equal(data.sections.services.settings.background, "surface", "tweede default krijgt contrastvlak");
  assert.equal(data.sections.cta.settings.background, "default", "na surface weer default: afwisseling");
  assert.equal(index.rhythmAdjustments, 1);
  assert.ok(result.notes.some((n) => n.includes("Sectieritme")), "ritme-notitie ontbreekt");
});

test("rendering: sectieritme raakt expliciete blueprint-keuzes NOOIT aan (image/accent_band blijven, geen gedwongen flips)", () => {
  const blueprint = websiteBlueprintSchema.parse({
    version: 2,
    pages: [
      {
        key: "home",
        title: "Home",
        purpose: "Landingspagina",
        seo: null,
        sectionInstances: [
          { type: "hero", layout: "centered", blocks: [], media: [], cta: null, background: "image", motion: "none", contentHints: null },
          { type: "services", layout: "cards", blocks: [{ kind: "service", hint: "Eerste dienst" }, { kind: "service", hint: "Tweede dienst" }], media: [], cta: null, background: "default", motion: "none", contentHints: null },
          { type: "about", layout: "split", blocks: [], media: [], cta: null, background: "accent_band", motion: "none", contentHints: null },
          { type: "cta", layout: "band", blocks: [], media: [], cta: { label: "Contact", target: "form", prominence: "primary" }, background: "default", motion: "none", contentHints: null },
        ],
      },
    ],
    trustElements: { usps: [], stats: [], badges: [] },
    conversionPlan: { primaryGoal: "Contact", leadCapture: true, contactPreference: "form" },
    missingInformation: [],
  }) as WebsiteBlueprint;

  const result = composeBlueprintTemplates({ blueprint, spec: SPECIFICATION, contact: CONTACT });
  const index = result.templates.find((t) => t.path === "templates/index.json")!;
  const data = JSON.parse(JSON.stringify(index.data)) as {
    sections: Record<string, { settings: { background: string } }>;
  };
  assert.equal(data.sections.hero.settings.background, "image");
  assert.equal(data.sections.about.settings.background, "accent_band");
  assert.equal(data.sections.services.settings.background, "default", "na image geen gedwongen flip");
  assert.equal(data.sections.cta.settings.background, "default", "na accent_band geen gedwongen flip");
  assert.equal(index.rhythmAdjustments, 0);
});

test("rendering: het volledige thema met alle renderingverbeteringen doorstaat de theme-validatie", async () => {
  const { validateThemeFiles } = await import("../lib/websites/theme-zip/theme-validation");
  const theme = builtTheme();
  const report = validateThemeFiles(theme.files);
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors, null, 2));
});
