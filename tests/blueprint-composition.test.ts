import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken (zelfde patroon als theme-zip-tests).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import { buildShopifyTheme, type BuiltTheme } from "../lib/websites/theme-zip/theme-builder";
import { validateThemeFiles } from "../lib/websites/theme-zip/theme-validation";
import { designPlanSchema, type DesignPlan } from "../lib/websites/design-plan";
import { WebsiteSpecificationSchema } from "../lib/ai/schemas";
import { websiteBlueprintSchema, type WebsiteBlueprint } from "../lib/websites/blueprint/blueprint";
import type { WebsiteSpecification } from "../lib/websites/types";
import type { WebsiteContactContext } from "../lib/websites/generator";

// ---------------------------------------------------------------------------
// Fase C: Blueprint → Shopify-compositie (2026-09-19)
// Deterministische vertaling van blueprint.pages[].sectionInstances naar
// JSON-templates. Homepage én subpagina's uit het blueprint; uitsluitend
// registry-types; exacte volgorde; geen ongeplande secties; backward compat
// zonder blueprint; deterministische output.
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
  structure: { pages: [{ key: "home", title: "Home" }, { key: "about", title: "Over ons" }, { key: "contact", title: "Contact" }], navigation: ["Home", "Over ons", "Contact"], sections: [] },
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
    metaDescription: "Testmeta-omschrijving voor de compositietest.",
    keywords: [],
    localArea: "Utrecht",
  },
  missingInformation: [],
}) as WebsiteSpecification;

function instance(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "hero",
    layout: "centered",
    blocks: [],
    media: [],
    cta: null,
    background: "default",
    motion: "none",
    contentHints: null,
    ...overrides,
  };
}

/** Blueprint met home (hero/services/cta/contact), about- en contactpagina. */
function baseBlueprint(): WebsiteBlueprint {
  return websiteBlueprintSchema.parse({
    version: 2,
    pages: [
      {
        key: "home",
        title: "Home",
        purpose: "Landingspagina",
        seo: null,
        sectionInstances: [
          instance({ type: "hero", layout: "centered", media: [{ role: "image", ratio: "wide", alt: "Sfeerbeeld hero" }], cta: { label: "Neem contact op", target: "contact", prominence: "primary" } }),
          instance({ type: "usp_band", layout: "row", blocks: [{ kind: "usp", hint: "USP 1" }, { kind: "usp", hint: "USP 2" }] }),
          instance({ type: "services", layout: "cards", blocks: [{ kind: "service", hint: "Dienst" }, { kind: "service", hint: "Dienst" }, { kind: "service", hint: "Dienst" }] }),
          instance({ type: "about", layout: "story" }),
          instance({ type: "cta", layout: "band", cta: { label: "Vraag een offerte aan", target: "form", prominence: "primary" } }),
          instance({ type: "contact", layout: "split" }),
        ],
      },
      {
        key: "over-ons",
        title: "Over ons",
        purpose: "Verhaal",
        seo: null,
        sectionInstances: [
          instance({ type: "about", layout: "timeline" }),
          instance({ type: "cta", layout: "closing", cta: { label: "Terug naar home", target: "home", prominence: "secondary" } }),
        ],
      },
      {
        key: "contact",
        title: "Contact",
        purpose: "Conversie",
        seo: null,
        sectionInstances: [instance({ type: "contact", layout: "full" })],
      },
    ],
    trustElements: {
      usps: [{ label: "10 jaar ervaring", source: "requirements" }],
      stats: [{ label: "Opdrachten per jaar", value: "120", source: "requirements" }],
      badges: [],
    },
    conversionPlan: { primaryGoal: "Contact via formulier", leadCapture: true, contactPreference: "form" },
    missingInformation: [],
  });
}

function basePlanInput(): Record<string, unknown> {
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

function planWithoutBlueprint(): DesignPlan {
  return designPlanSchema.parse(basePlanInput());
}

function planWithBlueprint(blueprint: WebsiteBlueprint): DesignPlan {
  const input = basePlanInput() as Record<string, unknown>;
  input.blueprint = blueprint;
  return designPlanSchema.parse(input);
}

interface ComposedSectionEntry {
  type: string;
  settings: Record<string, unknown>;
  blocks?: Record<string, { type: string; settings: Record<string, unknown> }>;
  block_order?: string[];
}
type ComposedTemplateData = { sections: Record<string, ComposedSectionEntry>; order: string[] };
function templateJson(files: BuiltTheme["files"], path: string): ComposedTemplateData {
  const file = files.find((f) => f.path === path);
  assert.ok(file, `verwacht template ${path}`);
  return JSON.parse(file.content);
}

function build(plan: DesignPlan): BuiltTheme {
  return buildShopifyTheme({ specification: SPECIFICATION, designPlan: plan, contact: CONTACT });
}

// ---------------------------------------------------------------------------

test("blueprint → homepage exact uit de blueprint opgebouwd", () => {
  const theme = build(planWithBlueprint(baseBlueprint()));
  const index = templateJson(theme.files, "templates/index.json");
  const types = index.order.map((k) => index.sections[k].type);
  assert.deepEqual(types, ["hero", "usp-band", "services", "about", "cta", "contact"]);
  assert.equal(index.sections.hero.settings.heading, SPECIFICATION.content.headline);
  assert.equal(index.sections.contact.settings.phone, CONTACT.phone);
  assert.equal(index.sections.contact.settings.email, CONTACT.email);
});

test("blueprint → subpagina's (incl. contact) daadwerkelijk gecomponeerd", () => {
  const theme = build(planWithBlueprint(baseBlueprint()));
  const over = templateJson(theme.files, "templates/page.over-ons.json");
  assert.deepEqual(over.order.map((k) => over.sections[k].type), ["about", "cta"]);
  const contact = templateJson(theme.files, "templates/page.contact.json");
  assert.deepEqual(contact.order.map((k) => contact.sections[k].type), ["contact"]);
  assert.equal(contact.sections.contact.settings.show_form, true);
  // Legacy lege main-page-shells bestaan niet meer zodra het blueprint er is
  assert.ok(!theme.files.some((f) => f.path === "templates/page.over-ons.json" && f.content.includes("main-page")));
});

test("sectievolgorde volgt het blueprint exact (ook bij herhaling van een type)", () => {
  const blueprint = baseBlueprint();
  blueprint.pages[1].sectionInstances = [
    instance({ type: "rich_text", layout: "article", blocks: [{ kind: "paragraph", hint: "Intro" }, { kind: "paragraph", hint: "Verder" }] }),
    instance({ type: "about", layout: "quote" }),
    instance({ type: "rich_text", layout: "columns", blocks: [{ kind: "paragraph", hint: "Slot" }] }),
    instance({ type: "cta", layout: "closing", cta: { label: "Terug", target: "home", prominence: "secondary" } }),
  ] as never;
  const theme = build(planWithBlueprint(blueprint));
  const over = templateJson(theme.files, "templates/page.over-ons.json");
  assert.deepEqual(over.order.map((k) => over.sections[k].type), ["rich-text", "about", "rich-text", "cta"]);
  // Unieke section-keys bij herhaald type
  assert.deepEqual(over.order, ["rich-text", "about", "rich-text_2", "cta"]);
});

test("layoutvarianten zijn daadwerkelijk zichtbaar in Shopify (setting + klasse + CSS)", () => {
  const theme = build(planWithBlueprint(baseBlueprint()));
  const index = templateJson(theme.files, "templates/index.json");
  assert.equal(index.sections.hero.settings.layout, "centered");
  assert.equal(index.sections.services.settings.layout, "cards");
  assert.equal(index.sections.about.settings.layout, "story");
  assert.equal(index.sections.cta.settings.layout, "band");

  const css = theme.files.find((f) => f.path === "assets/theme.css")!.content;
  const hero = theme.files.find((f) => f.path === "sections/hero.liquid")!.content;
  const services = theme.files.find((f) => f.path === "sections/services.liquid")!.content;
  // Liquid rendert de variant-klasse uit de section-setting
  assert.ok(hero.includes("hero--{{ hero_layout }}"));
  assert.ok(services.includes("services--{{ section.settings.layout"));
  // CSS maakt elke registry-layout zichtbaar
  for (const rule of [".hero--centered", ".hero--focused", ".hero--band", ".hero--minimal", ".hero--split",
    ".services--grid", ".services--cards", ".services--list", ".services--alternating",
    ".about--story", ".about--quote", ".about--timeline", ".about--split",
    ".gallery--grid", ".gallery--full_width",
    ".testimonials--band", ".testimonials--carousel", ".testimonials--grid",
    ".benefits--grid", ".benefits--checklist", ".benefits--split",
    ".faq--accordion", ".faq--list",
    ".cta--band", ".cta--split", ".cta--closing",
    ".contact--split", ".contact--full", ".contact--minimal",
    ".rich-text--article", ".rich-text--columns",
    ".usp-band--row", ".usp-band--grid",
    ".stats--row", ".stats--grid",
    ".process--steps", ".process--numbered_row",
    ".projects--grid", ".projects--feature_row",
    ".team--grid", ".team--row",
    ".rates--table", ".rates--cards",
    ".newsletter--band", ".newsletter--split",
    ".booking--band", ".booking--split"]) {
    assert.ok(css.includes(rule), `CSS mist layoutvariant ${rule}`);
  }
  // Achtergrond + motion als settings + klassen
  assert.ok(css.includes(".section--bg-accent_band"));
  assert.ok(css.includes(".motion--fade_up"));
  assert.ok(css.includes(".motion--stagger"));
  assert.ok(css.includes("prefers-reduced-motion"));
});

test("elke section-instantie zet background/motion-settings (accent_band + stagger)", () => {
  const blueprint = baseBlueprint();
  blueprint.pages[0].sectionInstances[1].background = "accent_band";
  blueprint.pages[0].sectionInstances[1].motion = "stagger";
  const theme = build(planWithBlueprint(blueprint));
  const index = templateJson(theme.files, "templates/index.json");
  assert.equal(index.sections["usp-band"].settings.background, "accent_band");
  assert.equal(index.sections["usp-band"].settings.motion, "stagger");
  assert.equal(index.sections.hero.settings.background, "default");
});

test("geen ongeplande secties: alleen blueprint-types in de templates", () => {
  const theme = build(planWithBlueprint(baseBlueprint()));
  const planned = new Set<string>();
  for (const page of baseBlueprint().pages) {
    for (const inst of page.sectionInstances) planned.add(inst.type);
  }
  const shopifyTypes = new Set<string>(["hero", "usp-band", "services", "about", "cta", "contact"]);
  for (const file of theme.files) {
    // templates/page.json is de systeem-default (niet-blueprint), geen compositie
    if (file.path === "templates/page.json" || (!file.path.startsWith("templates/page.") && file.path !== "templates/index.json")) continue;
    const data = JSON.parse(file.content);
    for (const key of data.order) {
      const type = data.sections[key].type;
      assert.ok(shopifyTypes.has(type), `ongepland sectietype "${type}" in ${file.path}`);
      assert.ok(planned.has(type.replace(/-/g, "_")), `sectietype "${type}" staat niet in het blueprint`);
    }
  }
  // Geen legacy-waakhond-secties toegevoegd (geen gallery/testimonials/benefits/faq)
  const index = templateJson(theme.files, "templates/index.json");
  assert.ok(!index.order.some((k) => ["gallery", "testimonials", "benefits", "faq"].includes(index.sections[k].type)));
});

test("trust-elements: echte usps/stats alleen, blokken uit trustElements, geen fabricatie", () => {
  const theme = build(planWithBlueprint(baseBlueprint()));
  const index = templateJson(theme.files, "templates/index.json");
  const usp = index.sections["usp-band"];
  assert.ok(usp.block_order && usp.blocks);
  // Echte USP uit trustElements komt terecht; overige slots blijven leeg (bewerkbaar)
  assert.equal(usp.block_order.length, 2);
  assert.equal(usp.blocks["usp-1"].settings.label, "10 jaar ervaring");
  assert.equal(usp.blocks["usp-2"].settings.label, null);
});

test("CTA-doelen worden deterministisch opgelost (paginakey, form, mailto)", () => {
  const blueprint = baseBlueprint();
  blueprint.pages[0].sectionInstances[0].cta = { label: "Mail ons", target: "mailto:info@example.test", prominence: "primary" };
  const theme = build(planWithBlueprint(blueprint));
  const index = templateJson(theme.files, "templates/index.json");
  assert.equal(index.sections.hero.settings.cta_link, "mailto:info@example.test");
  // "form" → contactpagina uit het blueprint
  assert.equal(index.sections.cta.settings.cta_link, "/pages/contact");
  // paginakey "home" → "/"
  const over = templateJson(theme.files, "templates/page.over-ons.json");
  assert.equal(over.sections.cta.settings.cta_link, "/");
  // paginakey naar subpagina → /pages/<slug>
  blueprint.pages[0].sectionInstances[0].cta = { label: "Over ons", target: "over-ons", prominence: "secondary" };
  const theme2 = build(planWithBlueprint(blueprint));
  const index2 = templateJson(theme2.files, "templates/index.json");
  assert.equal(index2.sections.hero.settings.cta_link, "/pages/over-ons");
});

test("content komt alléén uit de specificatie (services/faq/testimonials) — geen verzonnen blokken", () => {
  const theme = build(planWithBlueprint(baseBlueprint()));
  const index = templateJson(theme.files, "templates/index.json");
  const services = index.sections.services;
  assert.ok(services.block_order && services.blocks);
  assert.equal(services.block_order.length, 3); // 3 geplande slots, 2 echte diensten
  assert.equal(services.blocks["service-1"].settings.title, "Testdienst A");
  assert.equal(services.blocks["service-3"].settings.title, null); // geen derde dienst verzonnen
});

test("backward compat: v1-plan zonder blueprint levert de bestaande compositie", () => {
  const plan = planWithoutBlueprint();
  const theme = build(plan);
  const index = templateJson(theme.files, "templates/index.json");
  // Legacy hardcoded homepage-compositie (échte testimonials/benefits/faq
  // uit de specificatie verschijnen; geen gallery: geen beeldvereiste gepland)
  assert.deepEqual(index.order, ["hero", "services", "about", "testimonials", "benefits", "faq", "cta", "contact"]);
  assert.ok(!("layout" in index.sections.hero.settings));
  // Contactpagina blijft altijd aanwezig
  const contact = templateJson(theme.files, "templates/page.contact.json");
  assert.deepEqual(contact.order, ["contact"]);
  // Subpagina's blijven lege main-page-shells
  const over = templateJson(theme.files, "templates/page.over-ons.json");
  assert.deepEqual(over.order, ["main"]);
  assert.equal(over.sections.main.type, "main-page");
});

test("deterministisch: twee builds met hetzelfde blueprint zijn byte-identiek", () => {
  const plan = planWithBlueprint(baseBlueprint());
  const a = build(plan);
  const b = build(plan);
  const paths = (t: BuiltTheme) => t.files.map((f) => `${f.path}:${f.content.length}:${hash(f.content)}`).join("|");
  assert.equal(paths(a), paths(b));
});

test("het volledige blueprint-thema doorstaat de theme-validatie", () => {
  const theme = build(planWithBlueprint(baseBlueprint()));
  // Bewezen trust-claims (bron: requirements) passeren het fabricatie-net
  const trusted = ["10 jaar ervaring", "120 Opdrachten per jaar"];
  const result = validateThemeFiles(theme.files, { trustedClaims: trusted });
  assert.deepEqual(result.errors, []);
  // Zonder trusted-claims blijft het net even streng als voorheen
  const strict = validateThemeFiles(theme.files);
  assert.ok(strict.errors.some((e) => e.includes('Fabricatie-patroon "ervaring"')));
  assert.ok(theme.files.some((f) => f.path === "sections/usp-band.liquid"));
  assert.ok(theme.files.some((f) => f.path === "sections/booking.liquid"));
});

test("ook het v1-thema (zonder blueprint) blijft volledig geldig", () => {
  const theme = build(planWithoutBlueprint());
  const result = validateThemeFiles(theme.files);
  assert.deepEqual(result.errors, []);
});

test("alle 18 registry-sectietypes hebben een liquid-bestand in het thema", () => {
  const theme = build(planWithBlueprint(baseBlueprint()));
  const expected = ["hero", "usp-band", "stats", "services", "about", "process", "gallery", "projects", "testimonials", "team", "benefits", "faq", "rates", "newsletter", "booking", "cta", "contact", "rich-text"];
  for (const name of expected) {
    assert.ok(theme.files.some((f) => f.path === `sections/${name}.liquid`), `sections/${name}.liquid ontbreekt`);
  }
});

/** Kleine deterministische hash om byte-identiteit te vergelijken. */
function hash(content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i += 1) {
    h = (h * 31 + content.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}
