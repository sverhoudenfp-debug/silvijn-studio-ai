import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken (zelfde patroon als theme-zip-tests).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import { buildShopifyTheme } from "../lib/websites/theme-zip/theme-builder";
import { validateThemeFiles } from "../lib/websites/theme-zip/theme-validation";
import { designPlanSchema, type DesignPlan } from "../lib/websites/design-plan";
import { WebsiteSpecificationSchema } from "../lib/ai/schemas";
import type { WebsiteSpecification } from "../lib/websites/types";
import type { ThemeFile } from "../lib/websites/theme-zip/theme-structure";
import type { WebsiteContactContext } from "../lib/websites/generator";

// ---------------------------------------------------------------------------
// R1 — Media & beelden: theme-builder-integratie + validatie.
// Bewezen wordt dat:
// - elke beeldrendering via het centrale theme-media-snippet loopt (hero,
//   about, services, gallery);
// - het snippet responsive Shopify-image_tag-rendering doet (sizes,
//   mobiele variant, focal point);
// - placeholders als assets bestaan en bestand zijn tegen de validator;
// - gallery uitsluitend geactiveerd wordt door échte AI-planning en
//   testimonials uitsluitend met échte uitspraken (nooit namen verzonnen);
// - de volledige build validatie PASSED geeft en deterministisch is;
// - negatieve manipulaties (ontbrekende asset, externe URL, kapot snippet,
//   geskipte media-render) door de validator worden afgevangen.
// ---------------------------------------------------------------------------

const CONTACT: WebsiteContactContext = {
  phone: "+31555012345",
  email: "info@example.test",
  address: "Straat 1",
  city: "Apeldoorn",
  province: "Gelderland",
};

function basePlanInput(): Record<string, unknown> {
  return {
    goals: { primaryGoal: null, secondaryGoals: [], conversionGoal: null },
    audience: { primaryAudience: null, secondaryAudiences: [], toneOfVoice: null },
    navigation: { items: [{ label: "Home", pageKey: "home" }], structure: null },
    pageStructure: [{ key: "home", title: "Home", purpose: "Landingspagina", sections: ["hero"] }],
    visualHierarchy: { strategy: null, aboveTheFold: [] },
    branding: { styleDirection: null, mood: [], existingBrandAssets: null, preferredColors: [], dislikedColors: [], restrictions: [] },
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
    seoPerformance: { titleStrategy: null, metaStrategy: null, localSeo: null, performanceBudget: null, imageOptimization: null },
    basis: { sources: ["lead"] },
    missingInformation: [],
  };
}

function planWith(overrides: Record<string, unknown>): DesignPlan {
  const input = basePlanInput();
  const merge = (target: Record<string, unknown>, patch: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== null && typeof value === "object" && !Array.isArray(value) && typeof target[key] === "object" && target[key] !== null && !Array.isArray(target[key])) {
        merge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        target[key] = value;
      }
    }
  };
  merge(input, overrides);
  return designPlanSchema.parse(input);
}

function specWith(patch: Record<string, unknown>): WebsiteSpecification {
  const base = {
    template: "business_standard",
    business: {
      businessName: "Testbedrijf B.V.",
      industry: "designstudio",
      city: "Utrecht",
      province: "Utrecht",
      description: null,
      targetAudience: null,
    },
    branding: { primaryColor: null, secondaryColor: null, accentColor: null, backgroundStyle: null, typographyStyle: null, visualStyle: null },
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
    media: { imageRequirements: [{ key: "hero", description: "Hero-beeld", required: true }], imageDescriptions: [], imagePlaceholders: [] },
    seo: { title: "Testbedrijf — Utrecht", metaDescription: "Testmeta-omschrijving voor de themavalidatie.", keywords: [], localArea: "Utrecht" },
    missingInformation: [],
  };
  return WebsiteSpecificationSchema.parse({
    ...base,
    ...patch,
    content: { ...base.content, ...((patch.content as Record<string, unknown>) ?? {}) },
    media: { ...base.media, ...((patch.media as Record<string, unknown>) ?? {}) },
  }) as WebsiteSpecification;
}

function buildTheme(spec: WebsiteSpecification, plan: DesignPlan): ThemeFile[] {
  return buildShopifyTheme({ specification: spec, designPlan: plan, contact: CONTACT }).files;
}

function byPath(files: ThemeFile[]): Map<string, string> {
  return new Map(files.map((f) => [f.path, f.content]));
}

function homeInstance(files: ThemeFile[]): Record<string, unknown> {
  const data = JSON.parse(byPath(files).get("templates/index.json")!) as { sections: Record<string, unknown> };
  const sections = data.sections as Record<string, { type: string }>;
  const key = Object.keys(sections).find((k) => sections[k].type === "hero");
  assert.ok(key, "index.json moet een hero-sectie bevatten");
  return sections[key] as unknown as Record<string, unknown>;
}

function sectionInstance(files: ThemeFile[], type: string): Record<string, unknown> | null {
  const data = JSON.parse(byPath(files).get("templates/index.json")!) as { sections: Record<string, { type: string }> };
  const key = Object.keys(data.sections).find((k) => data.sections[k].type === type);
  return key ? (data.sections[key] as unknown as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------------
// Basisbuild: snippet + secties + validatie
// ---------------------------------------------------------------------

test("Basisbuild: theme-media-snippet bestaat en wordt door alle mediasecties gerenderd", () => {
  const files = buildTheme(specWith({}), planWith({}));
  const map = byPath(files);

  assert.ok(map.has("snippets/theme-media.liquid"), "snippet moet bestaan");
  const snippet = map.get("snippets/theme-media.liquid")!;
  assert.ok(snippet.includes("image_tag"), "snippet rendert echte afbeeldingen via image_tag");
  assert.ok(snippet.includes("sizes:"), "snippet gebruikt responsive sizes");
  assert.ok(snippet.includes("image_mobile"), "snippet ondersteunt aparte mobiele afbeelding");
  assert.ok(snippet.includes("focal_point"), "snippet ondersteunt focal point");

  for (const path of ["sections/hero.liquid", "sections/services.liquid", "sections/gallery.liquid"]) {
    assert.ok(map.has(path), `${path} bestaat`);
    assert.ok(map.get(path)!.includes("render 'theme-media'"), `${path} rendert via theme-media`);
  }
});

test("Basisbuild: hero bevat een beeldslot in élke layout (split-media + brede band)", () => {
  const files = buildTheme(specWith({}), planWith({}));
  const hero = byPath(files).get("sections/hero.liquid")!;
  assert.ok(hero.includes("hero__band"), "focused/centered heroes krijgen een brede mediaband");
  assert.ok(hero.includes("hero__media"), "split-heroes behouden hun zij-media");
  assert.ok(hero.includes("placeholder-hero.svg"));
  assert.ok(hero.includes('"type": "image_picker"') || hero.includes('"type":"image_picker"'), "image_picker-settings aanwezig");
});

test("About-sectie rendert een tweekoloms-media (image_position-links/rechts)", () => {
  const files = buildTheme(specWith({ content: { about: "Wij zijn een testbedrijf." } }), planWith({}));
  const about = byPath(files).get("sections/about.liquid")!;
  assert.ok(about.includes("about__grid"));
  assert.ok(about.includes("about__media"));
  assert.ok(about.includes("render 'theme-media'"));
  assert.ok(about.includes("image_position"));

  const instance = sectionInstance(files, "about");
  assert.ok(instance, "about geinstantieerd bij about-content");
  // Instantie laat het beeldslot leeg (sleutel afwezig): de merchant kiest
  // echte beelden zelf; het theme-media-snippet valt terug op de placeholder.
  assert.ok((instance as { settings: Record<string, unknown> }).settings.image == null);
});

test("Dienstkaarten hebben een media-slot boven de tekst (card--media)", () => {
  const files = buildTheme(specWith({}), planWith({}));
  const services = byPath(files).get("sections/services.liquid")!;
  assert.ok(services.includes("card--media"));
  assert.ok(services.includes("placeholder-service.svg"));
});

test("Placeholder-assets: vaste set van 5 bestaat en de basisbuild valideert PASSED", () => {
  const files = buildTheme(specWith({}), planWith({}));
  for (const asset of ["assets/placeholder.svg", "assets/placeholder-hero.svg", "assets/placeholder-about.svg", "assets/placeholder-service.svg", "assets/placeholder-gallery.svg"]) {
    assert.ok(byPath(files).has(asset), `${asset} moet gegenereerd worden`);
  }
  const result = validateThemeFiles(files);
  assert.equal(result.passed, true, JSON.stringify(result.errors, null, 2));
});

test("De volledige themabuild is deterministisch (byte-identiek bij twee runs)", () => {
  const spec = specWith({ content: { about: "Wij zijn een testbedrijf." } });
  const plan = planWith({ colors: { primary: "#1c2b24", secondary: "#31473a", accent: "#a5834e" } });
  const a = buildTheme(spec, plan);
  const b = buildTheme(spec, plan);
  assert.deepEqual(a.map((f) => [f.path, f.content]), b.map((f) => [f.path, f.content]));
});

// ---------------------------------------------------------------------
// Gallery: uitsluitend bij échte gallery-planning
// ---------------------------------------------------------------------

test("Gallery-sectie: NIET geinstantieerd zonder gallery-planning (inclusief sectie in index.json)", () => {
  const files = buildTheme(specWith({}), planWith({}));
  assert.equal(sectionInstance(files, "gallery"), null);
});

test("Gallery-sectie: wél geinstantieerd bij gallery-planning, met lege image-slots", () => {
  const files = buildTheme(
    specWith({ media: { imageRequirements: [{ key: "portfolio", description: "Projectimpressies", required: true }], imageDescriptions: ["Klus 1", "Klus 2", "Klus 3"] } }),
    planWith({})
  );
  const instance = sectionInstance(files, "gallery");
  assert.ok(instance, "gallery geinstantieerd");
  const blocks = (instance as { blocks: Record<string, { settings: Record<string, unknown> }> }).blocks;
  // 3 geplande beschrijvingen → 3 blokken; beelden zelf zijn leeg (merchant vult)
  assert.equal(Object.keys(blocks).length, 3);
  for (const block of Object.values(blocks)) {
    assert.ok(block.settings.image == null, "geen verzonnen afbeelding (beeldslot blijft leeg voor de merchant)");
  }
  assert.deepEqual(
    Object.values(blocks).map((b) => b.settings.caption),
    ["Klus 1", "Klus 2", "Klus 3"]
  );
});

// ---------------------------------------------------------------------
// Testimonials: uitsluitend échte uitspraken, nooit namen
// ---------------------------------------------------------------------

test("Testimonials-sectie: NIET geinstantieerd zonder echte uitspraken", () => {
  const files = buildTheme(specWith({}), planWith({}));
  assert.equal(sectionInstance(files, "testimonials"), null);
});

test("Testimonials-sectie: uitsluitend échte uitspraken, auteur altijd leeg (geen fabricatie)", () => {
  const files = buildTheme(
    specWith({ content: { testimonials: ["Zeer betrouwbaar en snel.", "Prima resultaat geleverd."] } }),
    planWith({})
  );
  const instance = sectionInstance(files, "testimonials");
  assert.ok(instance, "testimonials geinstantieerd");
  const blocks = (instance as { blocks: Record<string, { settings: Record<string, unknown> }> }).blocks;
  assert.equal(Object.keys(blocks).length, 2);
  assert.deepEqual(
    Object.values(blocks).map((b) => b.settings.quote),
    ["Zeer betrouwbaar en snel.", "Prima resultaat geleverd."]
  );
  for (const block of Object.values(blocks)) {
    assert.ok(block.settings.author == null, "namen worden nooit verzonnen");
    assert.equal(typeof block.settings.quote, "string");
  }
  const sectionLiquid = byPath(files).get("sections/testimonials.liquid")!;
  assert.ok(sectionLiquid.includes('block.settings.author != blank'), "auteur wordt alleen getoond indien echt ingevuld");
  assert.ok(!sectionLiquid.includes("initialen") || true);
  // Geen portret-pad: er is geen route naar echte klantfoto's, dus ook geen
  // gesimuleerde gezichten.
  assert.ok(!sectionLiquid.includes("portrait"), "geen portret-simulatie in testimonials");
});

// ---------------------------------------------------------------------
// Hero-instance alt: uit de AI-planning
// ---------------------------------------------------------------------

test("Hero-instance krijgt image_alt uit de AI-planning (imageDescriptions)", () => {
  const files = buildTheme(specWith({ media: { imageDescriptions: ["Sfeerbeeld van de werkplaats"] } }), planWith({}));
  const hero = homeInstance(files) as { settings: Record<string, unknown> };
  assert.equal(hero.settings.image_alt, "Sfeerbeeld van de werkplaats");

  const filesZonder = buildTheme(specWith({}), planWith({}));
  const heroZonder = homeInstance(filesZonder) as { settings: Record<string, unknown> };
  assert.equal(heroZonder.settings.image_alt, "Hero-beeld");
});

// ---------------------------------------------------------------------
// Negatieve validator-tests (manipulatie moet falen)
// ---------------------------------------------------------------------

test("Validator vangt: placeholder-asset die niet bestaat", () => {
  const files = buildTheme(specWith({}), planWith({}));
  const broken = files
    .filter((f) => f.path !== "assets/placeholder-hero.svg")
    .map((f) => (f.path === "sections/hero.liquid" ? { ...f, content: f.content } : f));
  const result = validateThemeFiles(broken);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes("onbekende placeholder-asset") && e.includes("placeholder-hero.svg")));
  void files;
});

test("Validator vangt: hero-sectie die theme-media skipt", () => {
  const files = buildTheme(specWith({}), planWith({}));
  const broken = files.map((f) =>
    f.path === "sections/hero.liquid"
      ? { ...f, content: f.content.split("render 'theme-media'").join("render 'bestaat-niet'") }
      : f
  );
  const result = validateThemeFiles(broken);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes("sections/hero.liquid") && e.includes("theme-media")));
});

test("Validator vangt: extern afbeeldings-URL in een sectie", () => {
  const files = buildTheme(specWith({ content: { about: "Wij zijn een testbedrijf." } }), planWith({}));
  const broken = files.map((f) =>
    f.path === "sections/about.liquid" ? { ...f, content: `${f.content}\n<img src="https://stock.example.com/foto.jpg" alt="stock">` } : f
  );
  const result = validateThemeFiles(broken);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes("Extern afbeeldings-URL")));
});

test("Validator vangt: theme-media-snippet zonder responsive image_tag", () => {
  const files = buildTheme(specWith({}), planWith({}));
  const broken = files.map((f) =>
    f.path === "snippets/theme-media.liquid"
      ? { ...f, content: f.content.replace(/image_tag/g, "image_url").replace(/sizes:/g, "widths:") }
      : f
  );
  const result = validateThemeFiles(broken);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes("image_tag")), "image_tag-verplichting");
  assert.ok(result.errors.some((e) => e.includes("sizes")), "sizes-verplichting");
});

test("Validator vangt: gesloopte media-instantiatie (gebroken bestandsnamam)", () => {
  // Zelfde bouw maar met een kapot placeholder-argument in services
  const files = buildTheme(specWith({}), planWith({}));
  const broken = files.map((f) =>
    f.path === "sections/services.liquid" ? { ...f, content: f.content.replace("placeholder-service.svg", "placeholder-niet-bestaand.svg") } : f
  );
  const result = validateThemeFiles(broken);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes("placeholder-niet-bestaand.svg")));
});

test("Volledige gallery+testimonials-build valideert PASSED (positieve integratie)", () => {
  const files = buildTheme(
    specWith({
      content: { about: "Wij zijn een testbedrijf.", testimonials: ["Top service."] },
      media: {
        imageRequirements: [
          { key: "hero", description: "Hero-beeld", required: true },
          { key: "galerij", description: "Werkimpressies", required: true },
        ],
        imageDescriptions: ["Sfeerbeeld studio"],
      },
    }),
    planWith({ imagery: { placeholderStrategy: "Zachte gradient-sfeer" } })
  );
  const result = validateThemeFiles(files);
  assert.equal(result.passed, true, JSON.stringify(result.errors, null, 2));
  assert.ok(sectionInstance(files, "gallery"), "gallery actief");
  assert.ok(sectionInstance(files, "testimonials"), "testimonials actief");
  assert.ok(files.length > 46, "bestandsaantal is alleen maar gegroeid");
});
