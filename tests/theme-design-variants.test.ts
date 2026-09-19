import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken (zelfde patroon als theme-zip-tests).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import { buildShopifyTheme, buildThemeDesignTokens } from "../lib/websites/theme-zip/theme-builder";
import { validateThemeFiles } from "../lib/websites/theme-zip/theme-validation";
import { designPlanSchema, type DesignPlan } from "../lib/websites/design-plan";
import { WebsiteSpecificationSchema } from "../lib/ai/schemas";
import type { WebsiteSpecification } from "../lib/websites/types";
import type { WebsiteContactContext } from "../lib/websites/generator";

// ---------------------------------------------------------------------------
// Theme Design Variants — stap 1+2 (2026-09-19)
// De theme-builder vertaalt bestaande, Zod-gevalideerde Design Plan-data
// (secondary/neutrals, typografie-scale/-weights, radius, hero-variant) naar
// Shopify-settings en CSS-tokens. Deterministisch; geen AI-CSS; de bestaande
// validatie, QC, payment/approval/delivery/download raken ongewijzigd.
// ---------------------------------------------------------------------------

const CONTACT: WebsiteContactContext = {
  phone: "+31555012345",
  email: "info@example.test",
  address: "Straat 1",
  city: "Apeldoorn",
  province: "Gelderland",
};

/** Minimaal geldig Design Plan (alle optionele velden null/leeg). */
function basePlanInput(): Record<string, unknown> {
  return {
    goals: { primaryGoal: null, secondaryGoals: [], conversionGoal: null },
    audience: { primaryAudience: null, secondaryAudiences: [], toneOfVoice: null },
    navigation: {
      items: [{ label: "Home", pageKey: "home" }],
      structure: null,
    },
    pageStructure: [
      { key: "home", title: "Home", purpose: "Landingspagina", sections: ["hero"] },
    ],
    visualHierarchy: { strategy: null, aboveTheFold: [] },
    branding: {
      styleDirection: null,
      mood: [],
      existingBrandAssets: null,
      preferredColors: [],
      dislikedColors: [],
      restrictions: [],
    },
    typography: { pairing: null, scale: null, weights: [], rationale: null },
    colors: { primary: null, secondary: null, accent: null, neutrals: [], usageGuidance: null },
    spacing: { scale: null, density: null },
    components: [{ key: "hero", purpose: "Eerste indruk met hoofd-CTA", notes: null }],
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
  structure: { pages: [{ key: "home", title: "Home" }], navigation: ["Home"], sections: [] },
  content: {
    headline: "Kop voor de test",
    subheadline: null,
    valueProposition: null,
    services: [{ title: "Testdienst", description: "Eén dienst voor de fixture." }],
    about: null,
    benefits: [],
    faq: [],
    testimonials: [],
    contactIntro: null,
    ctaPrimaryText: "Neem contact op",
    ctaSecondaryText: null,
  },
  conversion: { primaryCta: "contact", secondaryCta: null, contactMethods: [], leadCapture: true },
  media: { imageRequirements: [], imageDescriptions: [], imagePlaceholders: [] },
  seo: {
    title: "Testbedrijf — Utrecht",
    metaDescription: "Testmeta-omschrijving voor de themavalidatie.",
    keywords: [],
    localArea: "Utrecht",
  },
  missingInformation: [],
}) as WebsiteSpecification;

function planWith(overrides: Record<string, unknown>): DesignPlan {
  const input = basePlanInput();
  const merge = (target: Record<string, unknown>, patch: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(patch)) {
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof target[key] === "object" &&
        target[key] !== null &&
        !Array.isArray(target[key])
      ) {
        merge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        target[key] = value;
      }
    }
  };
  merge(input, overrides);
  return designPlanSchema.parse(input);
}

function builtTheme(plan: DesignPlan): { files: Map<string, string>; schema: unknown[]; data: Record<string, unknown> } {
  const { files } = buildShopifyTheme({
    specification: SPECIFICATION,
    designPlan: plan,
    contact: CONTACT,
  });
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const schema = JSON.parse(byPath.get("config/settings_schema.json")!) as unknown[];
  const data = JSON.parse(byPath.get("config/settings_data.json")!).current as Record<string, unknown>;
  return { files: byPath, schema, data };
}

function schemaSettingIds(schema: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const group of schema as Array<{ settings?: Array<{ id: string }> }>) {
    for (const setting of group.settings ?? []) ids.add(setting.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Stap 1: token-vertaling
// ---------------------------------------------------------------------------

test("variants: plan-kleuren (primary/secondary/neutrals) landen volledig in de tokens", () => {
  const plan = planWith({
    colors: {
      primary: "#2f5233",
      secondary: "#7a8f6d",
      accent: "#c9a55a",
      neutrals: ["#ffffff", "#f4f6f2", "#22301f", "#5b6657", "#dfe4dc"],
    },
  });
  const tokens = buildThemeDesignTokens(plan);
  assert.equal(tokens.secondary, "#7a8f6d");
  assert.equal(tokens.surface, "#f4f6f2");
  assert.equal(tokens.mutedText, "#5b6657");
  assert.equal(tokens.border, "#dfe4dc");
  assert.equal(tokens.text, "#22301f");
  assert.equal(tokens.background, "#ffffff");
});

test("variants: zonder plan-secondary wordt de fallback deterministisch van primary afgeleid", () => {
  const plan = planWith({ colors: { primary: "#2f5233" } });
  const tokens = buildThemeDesignTokens(plan);
  const second = buildThemeDesignTokens(planWith({ colors: { primary: "#2f5233" } }));
  assert.equal(tokens.secondary, second.secondary, "zelfde input → zelfde secondary");
  assert.match(tokens.secondary, /^#[0-9a-f]{6}$/);
});

test("variants: typografie-scale en weights worden deterministisch vertaald", () => {
  const compact = buildThemeDesignTokens(planWith({ typography: { scale: "Kleine, subtiele koppen", weights: ["300 licht", "400"] } }));
  assert.equal(compact.headingScale, 95);
  assert.equal(compact.headingWeight, 400);
  assert.equal(compact.bodyWeight, 300);

  const expressief = buildThemeDesignTokens(planWith({ typography: { scale: "Grote, expressieve koppen", weights: ["bold", "600 halfvet"] } }));
  assert.equal(expressief.headingScale, 115);
  assert.equal(expressief.headingWeight, 700);
  assert.equal(expressief.bodyWeight, 600);

  const leeg = buildThemeDesignTokens(planWith({}));
  assert.equal(leeg.headingScale, 100);
  assert.equal(leeg.headingWeight, 700);
  assert.equal(leeg.bodyWeight, 400);
});

test("variants: radius volgt stijlrichting/mood (hoekig 2px, zacht 16px, neutraal 10px)", () => {
  assert.equal(buildThemeDesignTokens(planWith({ branding: { styleDirection: "Strak, industrieel, technisch" } })).radius, "2");
  assert.equal(buildThemeDesignTokens(planWith({ branding: { mood: ["warm", "organisch"] } })).radius, "16");
  assert.equal(buildThemeDesignTokens(planWith({ branding: { styleDirection: null } })).radius, "10");
});

test("variants: hero-variant volgt imagery/aboveTheFold/mood — nooit random", () => {
  const split = buildThemeDesignTokens(planWith({ imagery: { style: "Sfeerbeelden van werk" } }));
  assert.equal(split.heroLayout, "split");
  const centered = buildThemeDesignTokens(
    planWith({
      imagery: { style: null },
      visualHierarchy: { aboveTheFold: ["Gecentreerde hoofdkop"] },
    })
  );
  assert.equal(centered.heroLayout, "centered");
  const focused = buildThemeDesignTokens(planWith({}));
  assert.equal(focused.heroLayout, "focused");
  // Beeld-signaal wint van centraal-signaal.
  const both = buildThemeDesignTokens(
    planWith({
      imagery: { style: "Fotografie centraal" },
      visualHierarchy: { aboveTheFold: ["Gecentreerde kop"] },
    })
  );
  assert.equal(both.heroLayout, "split");
});

// ---------------------------------------------------------------------------
// Stap 2: settings/CSS-tokens in het gebouwde thema
// ---------------------------------------------------------------------------

test("variants: nieuwe settings staan in schema EN settings_data met plannelijke defaults", () => {
  const plan = planWith({
    colors: {
      primary: "#2f5233",
      secondary: "#7a8f6d",
      accent: "#c9a55a",
      neutrals: ["#ffffff", "#f4f6f2", "#22301f", "#5b6657", "#dfe4dc"],
    },
    typography: { scale: "Grote koppen", weights: ["500", "700"] },
    branding: { mood: ["warm"] },
    imagery: { style: "Sfeerbeelden" },
  });
  const { schema, data } = builtTheme(plan);
  const ids = schemaSettingIds(schema);
  for (const id of [
    "color_secondary",
    "color_surface",
    "color_muted",
    "color_border",
    "heading_scale",
    "heading_weight",
    "body_weight",
    "corner_radius",
    "hero_layout",
  ]) {
    assert.ok(ids.has(id), `schema-setting ontbreekt: ${id}`);
  }
  assert.equal(data.color_secondary, "#7a8f6d");
  assert.equal(data.color_surface, "#f4f6f2");
  assert.equal(data.color_muted, "#5b6657");
  assert.equal(data.color_border, "#dfe4dc");
  assert.equal(data.heading_scale, 115);
  assert.equal(data.heading_weight, "700");
  assert.equal(data.body_weight, "500");
  assert.equal(data.corner_radius, 16);
  assert.equal(data.hero_layout, "split");
});

test("variants: layout/theme.liquid gebruikt settings-tokens i.p.v. color_mix-afleidingen", () => {
  const { files } = builtTheme(planWith({ colors: { primary: "#2f5233", neutrals: ["#ffffff", "#f4f6f2", "#22301f", "#5b6657", "#dfe4dc"] } }));
  const layout = files.get("layout/theme.liquid")!;
  for (const expected of [
    "--color-secondary: {{ settings.color_secondary }}",
    "--color-surface: {{ settings.color_surface }}",
    "--color-muted: {{ settings.color_muted }}",
    "--color-border: {{ settings.color_border }}",
    "--font-weight-heading: {{ settings.heading_weight }}",
    "--font-weight-body: {{ settings.body_weight }}",
    "--radius: {{ settings.corner_radius }}px",
  ]) {
    assert.ok(layout.includes(expected), `layout mist: ${expected}`);
  }
  assert.ok(!layout.includes("color_mix"), "color_mix-afleidingen zijn vervangen door settings");
});

test("variants: hero-sectie kent de variant-klasse en conditionele split-media", () => {
  const split = builtTheme(planWith({ imagery: { style: "Sfeerbeelden" } })).files.get("sections/hero.liquid")!;
  // Fase C: per-instantie layout valt terug op de theme-setting (hero_layout)
  assert.ok(split.includes("hero--{{ hero_layout }}"));
  assert.ok(split.includes("assign hero_layout = section.settings.layout | default: settings.hero_layout | default: 'focused'"));
  assert.ok(split.includes("hero_layout == 'split'"));
  assert.ok(split.includes("hero_layout != 'split'"));
  // R1: hero-media loopt via het centrale theme-media-snippet met de
  // hero-specifieke placeholder (niet langer de generieke placeholder.svg).
  assert.ok(split.includes("render 'theme-media'"));
  assert.ok(split.includes("placeholder-hero.svg"));
  assert.ok(!split.includes("'placeholder.svg' | asset_url"));

  const css = builtTheme(planWith({})).files.get("assets/theme.css")!;
  for (const expected of [".hero--centered", ".hero--split", "font-weight: var(--font-weight-heading)", "font-weight: var(--font-weight-body)"]) {
    assert.ok(css.includes(expected), `theme.css mist: ${expected}`);
  }
  assert.ok(css.includes("--color-secondary"), "secundaire kleur wordt écht geconsumeerd");
});

test("variants: gebouwd thema (vol plan én leeg plan) valideert zonder fouten", () => {
  for (const plan of [
    planWith({
      colors: { primary: "#2f5233", secondary: "#7a8f6d", accent: "#c9a55a", neutrals: ["#ffffff", "#f4f6f2", "#22301f", "#5b6657", "#dfe4dc"] },
      typography: { scale: "Grote koppen", weights: ["700", "400"] },
      branding: { mood: ["warm"], styleDirection: "Zacht en uitnodigend" },
      imagery: { style: "Sfeerbeelden van het bedrijf" },
      spacing: { density: "ruim" },
    }),
    planWith({}),
  ]) {
    const { files } = builtTheme(plan);
    const themeFiles = [...files.entries()].map(([path, content]) => ({ path, content }));
    const result = validateThemeFiles(themeFiles);
    assert.deepEqual(result.errors, [], `validatie faalt: ${result.errors.join("; ")}`);
    assert.equal(result.passed, true);
  }
});

test("variants: byte-deterministisch — identiek plan levert identieke bestanden", async () => {
  const plan = planWith({
    colors: { primary: "#2f5233", secondary: "#7a8f6d", neutrals: ["#ffffff", "#f4f6f2", "#22301f", "#5b6657", "#dfe4dc"] },
    imagery: { style: "Sfeerbeelden" },
  });
  const a = buildShopifyTheme({ specification: SPECIFICATION, designPlan: plan, contact: CONTACT });
  const b = buildShopifyTheme({ specification: SPECIFICATION, designPlan: plan, contact: CONTACT });
  assert.deepEqual(a.files, b.files);
  assert.equal(a.files.length, b.files.length);
});

test("variants: bestaande vereiste settings blijven ongewijzigd aanwezig", () => {
  const { schema, data } = builtTheme(planWith({}));
  const ids = schemaSettingIds(schema);
  for (const id of ["brand_name", "contact_email", "contact_phone", "contact_city", "seo_description", "share_image", "favicon"]) {
    assert.ok(ids.has(id), `bestaande setting verdwenen: ${id}`);
  }
  assert.equal(data.brand_name, SPECIFICATION.business.businessName);
  assert.equal(data.contact_phone, CONTACT.phone);
});

test("variants: settings_data-current kent geen keys die buiten het schema vallen", () => {
  const { schema, data } = builtTheme(planWith({}));
  const ids = schemaSettingIds(schema);
  for (const key of Object.keys(data)) {
    assert.ok(ids.has(key), `settings_data-key "${key}" staat niet in het schema`);
  }
});
