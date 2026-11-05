import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import { buildShopifyTheme, toThemeName } from "../lib/websites/theme-zip/theme-builder";
import { validateThemeFiles } from "../lib/websites/theme-zip/theme-validation";
import {
  THEME_NAME_MAX_LENGTH,
  THEME_REQUIRED_VISUAL_SETTING_IDS,
} from "../lib/websites/theme-zip/theme-structure";
import { designPlanSchema, type DesignPlan } from "../lib/websites/design-plan";
import { WebsiteSpecificationSchema } from "../lib/ai/schemas";
import { websiteBlueprintSchema, type WebsiteBlueprint } from "../lib/websites/blueprint/blueprint";
import type { WebsiteSpecification } from "../lib/websites/types";
import type { WebsiteContactContext } from "../lib/websites/generator";

// ---------------------------------------------------------------------------
// REGRESSIE (2026-11-05) — Shopify weigert config/settings_schema.json volledig
// wanneer theme_info.theme_name langer is dan 25 tekens. Bewezen met een echte
// theme push: "Section 1: theme_name is too long (max 25 characters)" en het
// bestand kwam als lege array ([]) terug, waardoor de instellingen-UI leeg was.
// ---------------------------------------------------------------------------

const LONG_NAME = "[TEST-FIXTURE] Studio Fictief (Project→ZIP flow) — Shopify-thema";

const CONTACT: WebsiteContactContext = {
  phone: "+31555012345",
  email: "info@example.test",
  address: "Straat 1",
  city: "Apeldoorn",
  province: "Gelderland",
};

function specification(businessName: string): WebsiteSpecification {
  return WebsiteSpecificationSchema.parse({
    template: "business_standard",
    business: {
      businessName,
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
        { key: "contact", title: "Contact" },
      ],
      navigation: ["Home", "Contact"],
      sections: [],
    },
    content: {
      headline: "Kop voor de regressietest",
      subheadline: null,
      valueProposition: "Waardepropositie uit de specificatie",
      services: [{ title: "Testdienst A", description: "Eerste dienst." }],
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
      title: `${businessName} — Utrecht`,
      metaDescription: "Testmeta-omschrijving voor de regressietest.",
      keywords: [],
      localArea: "Utrecht",
    },
    missingInformation: [],
  }) as WebsiteSpecification;
}

function blueprint(): WebsiteBlueprint {
  const instance = (overrides: Record<string, unknown>) => ({
    type: "hero",
    layout: "centered",
    blocks: [],
    media: [],
    cta: null,
    background: "default",
    motion: "none",
    contentHints: null,
    ...overrides,
  });
  return websiteBlueprintSchema.parse({
    version: 2,
    pages: [
      {
        key: "home",
        title: "Home",
        purpose: "Landingspagina",
        seo: null,
        sectionInstances: [
          instance({ type: "hero", layout: "centered", cta: { label: "Neem contact op", target: "contact", prominence: "primary" } }),
          instance({ type: "services", layout: "cards", blocks: [{ kind: "service", hint: "Dienst" }, { kind: "service", hint: "Dienst" }] }),
        ],
      },
      {
        key: "contact",
        title: "Contact",
        purpose: "Conversie",
        seo: null,
        sectionInstances: [instance({ type: "contact", layout: "split" })],
      },
    ],
    trustElements: { usps: [{ label: "10 jaar ervaring", source: "requirements" }], stats: [], badges: [] },
    conversionPlan: { primaryGoal: "Contact via formulier", leadCapture: true, contactPreference: "form" },
    missingInformation: [],
  });
}

function designPlan(): DesignPlan {
  return designPlanSchema.parse({
    goals: { primaryGoal: null, secondaryGoals: [], conversionGoal: null },
    audience: { primaryAudience: null, secondaryAudiences: [], toneOfVoice: null },
    navigation: { items: [{ label: "Home", pageKey: "home" }, { label: "Contact", pageKey: "contact" }], structure: null },
    pageStructure: [
      { key: "home", title: "Home", purpose: "Landingspagina", sections: ["hero", "services"] },
      { key: "contact", title: "Contact", purpose: "Conversie", sections: ["contact"] },
    ],
    visualHierarchy: { strategy: null, aboveTheFold: [] },
    branding: { styleDirection: null, mood: [], existingBrandAssets: null, preferredColors: [], dislikedColors: [], restrictions: [] },
    typography: { pairing: null, scale: null, weights: [], rationale: null },
    colors: { primary: null, secondary: null, accent: null, neutrals: [], usageGuidance: null },
    spacing: { scale: null, density: null },
    components: [{ key: "hero", purpose: "Eerste indruk", notes: null }],
    ctaStrategy: { primary: null, secondary: null, placement: [], leadCapture: null },
    imagery: { style: null, requirements: [], placeholderStrategy: null },
    responsive: { mobile: null, tablet: null, desktop: null, breakpoints: [] },
    animation: { strategy: null, allowed: [], restrictions: [] },
    functionality: { features: [], integrations: [] },
    accessibility: { contrast: null, focusAndKeyboard: null, semantics: null, formsAndLabels: null, guidelines: [] },
    seoPerformance: { titleStrategy: null, metaStrategy: null, localSeo: null, performanceBudget: null, imageOptimization: null },
    basis: { sources: ["lead"] },
    missingInformation: [],
    blueprint: blueprint(),
  }) as DesignPlan;
}

function settingsSchema(files: { path: string; content: string }[]): Record<string, unknown>[] {
  const file = files.find((f) => f.path === "config/settings_schema.json");
  assert.ok(file, "config/settings_schema.json ontbreekt in de gegenereerde bestanden");
  const parsed = JSON.parse(file!.content);
  assert.ok(Array.isArray(parsed), "settings_schema moet een JSON-array zijn");
  return parsed as Record<string, unknown>[];
}

test("toThemeName: lange bedrijfsnaam wordt afgekapt op 25 tekens", () => {
  const name = toThemeName(LONG_NAME);
  assert.ok(name.length <= THEME_NAME_MAX_LENGTH, `lengte ${name.length} > ${THEME_NAME_MAX_LENGTH}`);
  assert.ok(name.length > 0);
  assert.doesNotMatch(name, /[\s—–\-,.;:]+$/u, "naam mag niet eindigen op scheidingsteken");
});

test("toThemeName: korte naam blijft ongewijzigd en lege naam krijgt een fallback", () => {
  assert.equal(toThemeName("Hovenier van Dijk"), "Hovenier van Dijk");
  assert.equal(toThemeName("A".repeat(THEME_NAME_MAX_LENGTH)), "A".repeat(THEME_NAME_MAX_LENGTH));
  assert.ok(toThemeName("   ").length > 0);
  assert.ok(toThemeName("---").length > 0);
});

test("buildShopifyTheme: theme_name respecteert de Shopify-limiet ondanks een lange projectnaam", () => {
  const { files } = buildShopifyTheme({
    specification: specification(LONG_NAME),
    designPlan: designPlan(),
    contact: CONTACT,
  });
  const schema = settingsSchema(files);
  const themeInfo = schema[0] as Record<string, unknown>;
  assert.equal(themeInfo.name, "theme_info");
  const themeName = String(themeInfo.theme_name ?? "");
  assert.ok(themeName.length > 0 && themeName.length <= THEME_NAME_MAX_LENGTH, `theme_name lengte ${themeName.length}`);
});

test("buildShopifyTheme: settings_schema is volledig (theme_info + secties + visuele sleutels)", () => {
  const { files } = buildShopifyTheme({
    specification: specification(LONG_NAME),
    designPlan: designPlan(),
    contact: CONTACT,
  });
  const schema = settingsSchema(files);
  assert.ok(schema.length > 1, "schema bevat alleen theme_info");
  const ids = new Set<string>();
  for (const group of schema) {
    for (const setting of (group.settings as Record<string, unknown>[]) ?? []) {
      if (typeof setting.id === "string") ids.add(setting.id);
    }
  }
  for (const requiredId of THEME_REQUIRED_VISUAL_SETTING_IDS) {
    assert.ok(ids.has(requiredId), `setting ${requiredId} ontbreekt`);
  }
});

test("buildShopifyTheme: gegenereerd thema is zonder fouten te valideren", () => {
  const { files } = buildShopifyTheme({
    specification: specification(LONG_NAME),
    designPlan: designPlan(),
    contact: CONTACT,
  });
  const result = validateThemeFiles(files);
  assert.deepEqual(result.errors, []);
});

test("REGRESSIE: validator weigert een theme_name boven de Shopify-limiet", () => {
  const { files } = buildShopifyTheme({
    specification: specification(LONG_NAME),
    designPlan: designPlan(),
    contact: CONTACT,
  });
  const patched = files.map((file) => {
    if (file.path !== "config/settings_schema.json") return file;
    const schema = JSON.parse(file.content) as Record<string, unknown>[];
    schema[0].theme_name = "X".repeat(THEME_NAME_MAX_LENGTH + 1);
    return { ...file, content: `${JSON.stringify(schema, null, 2)}\n` };
  });
  const result = validateThemeFiles(patched);
  assert.ok(
    result.errors.some((e) => e.includes("theme_name is te lang")),
    `verwacht een lengtefout, kreeg: ${JSON.stringify(result.errors)}`
  );
});

test("REGRESSIE: validator weigert een schema met alleen theme_info", () => {
  const { files } = buildShopifyTheme({
    specification: specification(LONG_NAME),
    designPlan: designPlan(),
    contact: CONTACT,
  });
  const patched = files.map((file) => {
    if (file.path !== "config/settings_schema.json") return file;
    const schema = JSON.parse(file.content) as Record<string, unknown>[];
    return { ...file, content: `${JSON.stringify([schema[0]], null, 2)}\n` };
  });
  const result = validateThemeFiles(patched);
  assert.ok(
    result.errors.some((e) => e.includes("geen instellingensecties")),
    `verwacht een volledigheidsfout, kreeg: ${JSON.stringify(result.errors)}`
  );
});
