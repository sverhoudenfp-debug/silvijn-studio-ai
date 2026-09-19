import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  BLUEPRINT_SECTION_REGISTRY,
  BLUEPRINT_SECTION_TYPES,
  assertBlueprintRegistryInvariants,
  buildBlueprintSectionContract,
  blueprintBlockKeys,
  isBlueprintLayout,
} from "@/lib/websites/blueprint/section-registry";
import {
  validateBlueprintConsistency,
  websiteBlueprintSchema,
  blueprintSectionInstanceSchema,
  type WebsiteBlueprint,
} from "@/lib/websites/blueprint/blueprint";
import { designPlanSchema, validateDesignPlanConsistency } from "@/lib/websites/design-plan";
import { buildMockDesignPlan } from "../lib/ai/mock-provider";
import type { ProjectRequirements } from "@/lib/projects/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_SOURCE = readFileSync(path.join(__dirname, "../lib/ai/service.ts"), "utf8");

const requirements = (pages: number | null): ProjectRequirements => ({ numberOfPages: pages });

/** Minimaal geldig blueprint-object (compositie conform de registry). */
function minimalBlueprint(pages = 1): Record<string, unknown> {
  const blueprintPages = [
    {
      key: "home",
      title: "Home",
      purpose: "Kernpagina met aanbod en conversie.",
      seo: null,
      sectionInstances: [
        {
          type: "hero",
          layout: "split",
          blocks: [],
          media: [{ role: "image", ratio: "wide", alt: null }],
          cta: { label: "Neem contact op", target: "form", prominence: "primary" },
          background: "default",
          motion: "none",
          contentHints: null,
        },
        {
          type: "services",
          layout: "grid",
          blocks: [
            { kind: "service", hint: "Dienst A" },
            { kind: "service", hint: "Dienst B" },
          ],
          media: [],
          cta: null,
          background: "default",
          motion: "none",
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
  ];
  for (let i = 2; i <= pages; i += 1) {
    blueprintPages.push({
      key: `page-${i}`,
      title: `Pagina ${i}`,
      purpose: "Aanvullende pagina.",
      seo: null,
      sectionInstances: [
        {
          type: "rich_text",
          layout: "article",
          blocks: [{ kind: "paragraph", hint: "Inleiding" }],
          media: [],
          cta: null,
          background: "default",
          motion: "none",
          contentHints: null,
        },
        {
          type: "cta",
          layout: "closing",
          blocks: [],
          media: [],
          cta: { label: "Terug naar het aanbod", target: "home", prominence: "secondary" },
          background: "default",
          motion: "none",
          contentHints: null,
        },
      ],
    });
  }
  return {
    version: 2,
    pages: blueprintPages,
    trustElements: { usps: [], stats: [], badges: [] },
    conversionPlan: { primaryGoal: null, leadCapture: null, contactPreference: null },
    missingInformation: ["Geen echte USP's, cijfers of reviews aangeleverd — trust-secties niet gepland."],
  };
}

// ---------------------------------------------------------------------------
// Fase B — SECTION-REGISTRY
// ---------------------------------------------------------------------------

test("registry: gesloten catalogus is intern consistent (types, layouts, defaults, bloklimieten)", () => {
  assert.doesNotThrow(() => assertBlueprintRegistryInvariants());
  for (const type of BLUEPRINT_SECTION_TYPES) {
    const def = BLUEPRINT_SECTION_REGISTRY[type];
    assert.equal(def.type, type);
    assert.ok(def.layouts.length >= 1, `${type} moet minstens één layout hebben`);
    assert.ok(def.purpose.length > 10);
  }
  // Bestaande WEBSITE_SECTION_TYPES die ook blueprint-secties zijn bestaan nog steeds
  for (const type of ["hero", "services", "about", "gallery", "testimonials", "benefits", "faq", "cta", "contact"]) {
    assert.ok((BLUEPRINT_SECTION_TYPES as readonly string[]).includes(type), `${type} ontbreekt in de registry`);
  }
});

test("registry: helpers valideren layout- en blokkeys tegen de definitie", () => {
  assert.equal(isBlueprintLayout("hero", "split"), true);
  assert.equal(isBlueprintLayout("hero", "zigzag"), false);
  assert.equal(isBlueprintLayout("unknown_type" as never, "split"), false);
  assert.ok(blueprintBlockKeys("services").has("service"));
  assert.equal(blueprintBlockKeys("cta").size, 0);
});

test("registry: buildBlueprintSectionContract bevat élk sectietype (prompt = schema-bron)", () => {
  const contract = buildBlueprintSectionContract();
  for (const type of BLUEPRINT_SECTION_TYPES) {
    assert.ok(contract.includes(`- ${type} (`), `contract mist sectietype ${type}`);
  }
  assert.ok(contract.includes("layouts split|centered|focused|band|minimal"), "layoutvarianten moeten expliciet in het contract staan");
});

// ---------------------------------------------------------------------------
// Fase A — blueprint-schema
// ---------------------------------------------------------------------------

test("schema: minimaal geldig blueprint parsed volledig", () => {
  const parsed = websiteBlueprintSchema.parse(minimalBlueprint());
  assert.equal(parsed.version, 2);
  assert.equal(parsed.pages[0].sectionInstances[0].type, "hero");
  assert.equal(parsed.pages[0].sectionInstances[0].background, "default");
  assert.equal(parsed.pages[0].sectionInstances[0].motion, "none");
});

test("schema: onbekend sectietype/layout/blokkind/mediarol/CTA-combinatie wordt verworpen", () => {
  const base = minimalBlueprint() as { pages: Array<{ sectionInstances: Array<Record<string, unknown>> }> };
  const instance = base.pages[0].sectionInstances[0];

  const withType = { ...instance, type: "mega_banner" };
  assert.equal(blueprintSectionInstanceSchema.safeParse(withType).success, false);

  const withLayout = { ...instance, layout: "zigzag" };
  assert.equal(blueprintSectionInstanceSchema.safeParse(withLayout).success, false);

  const withBlock = { ...instance, type: "services", layout: "grid", blocks: [{ kind: "banner", hint: null }] };
  assert.equal(blueprintSectionInstanceSchema.safeParse(withBlock).success, false);

  const withMedia = { ...instance, media: [{ role: "video", ratio: "wide", alt: null }] };
  assert.equal(blueprintSectionInstanceSchema.safeParse(withMedia).success, false);

  // contact ondersteunt geen CTA-configuratie
  const withCta = {
    type: "contact",
    layout: "split",
    blocks: [],
    media: [],
    cta: { label: "Bel ons", target: "form", prominence: "primary" },
    background: "default",
    motion: "none",
    contentHints: null,
  };
  assert.equal(blueprintSectionInstanceSchema.safeParse(withCta).success, false);
});

test("schema: bloklimieten worden afgedwongen (services min 2, max 8; verplichte soorten)", () => {
  const make = (count: number) =>
    blueprintSectionInstanceSchema.safeParse({
      type: "services",
      layout: "grid",
      blocks: Array.from({ length: count }, () => ({ kind: "service", hint: "Dienst" })),
      media: [],
      cta: null,
      background: "default",
      motion: "none",
      contentHints: null,
    });
  assert.equal(make(1).success, false, "services vereist minimaal 2 service-blokken");
  assert.equal(make(2).success, true);
  assert.equal(make(9).success, false, "services staat maximaal 8 service-blokken toe");
});

test("schema: cta-sectie zonder cta-configuratie is ongeldig; trustElements vereisen source", () => {
  const ctaNoConfig = blueprintSectionInstanceSchema.safeParse({
    type: "cta",
    layout: "band",
    blocks: [],
    media: [],
    cta: null,
    background: "default",
    motion: "none",
    contentHints: null,
  });
  assert.equal(ctaNoConfig.success, false, "cta-instantie vereist cta-configuratie");

  const noSource = websiteBlueprintSchema.safeParse({
    ...minimalBlueprint(),
    trustElements: { usps: [{ label: "Snel" }], stats: [], badges: [] },
  });
  assert.equal(noSource.success, false, "trustElement-usp vereist een source (requirements|questionnaire|lead_notes)");
});

// ---------------------------------------------------------------------------
// Deterministische consistentie (compositie-vloer + scope)
// ---------------------------------------------------------------------------

function consistentBlueprint(): WebsiteBlueprint {
  return websiteBlueprintSchema.parse(minimalBlueprint(2));
}

test("consistentie: geldig blueprint slaagt (scope, nav, compositie)", () => {
  const blueprint = consistentBlueprint();
  const result = validateBlueprintConsistency(
    blueprint,
    requirements(2),
    [{ label: "Home", pageKey: "home" }, { label: "Pagina 2", pageKey: "page-2" }],
    ["home", "page-2"]
  );
  assert.deepEqual(result, { passed: true, errors: [] });
});

test("consistentie: prijsintegriteit — pagina-aantal moet exact de requirements volgen", () => {
  const blueprint = consistentBlueprint();
  const result = validateBlueprintConsistency(blueprint, requirements(5));
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes("requirements vermelden 5")));
});

test("consistentie: navigatie moet naar blueprint-pagina's wijzen; v1-paginaset moet gespiegeld zijn", () => {
  const blueprint = consistentBlueprint();
  const nav = validateBlueprintConsistency(
    blueprint,
    requirements(2),
    [{ label: "Tarieven", pageKey: "rates" }],
    ["home", "page-2"]
  );
  assert.equal(nav.passed, false);
  assert.ok(nav.errors.some((e) => e.includes('blueprint-onbekende pagina "rates"')));

  const divergent = validateBlueprintConsistency(
    blueprint,
    requirements(2),
    [{ label: "Home", pageKey: "home" }],
    ["home", "extra-pagina"]
  );
  assert.equal(divergent.passed, false);
  assert.ok(divergent.errors.some((e) => e.includes("staat in pageStructure maar niet in het blueprint")));
  assert.ok(divergent.errors.some((e) => e.includes("staat in het blueprint maar niet in pageStructure")));
});

test("consistentie: homepage moet met hero beginnen en een conversiesectie bevatten", () => {
  const blueprint = consistentBlueprint();
  (blueprint.pages[0].sectionInstances as WebsiteBlueprint["pages"][number]["sectionInstances"]).shift();
  const result = validateBlueprintConsistency(blueprint, requirements(2));
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes("moet met een hero-sectie beginnen")));

  const noConversion = consistentBlueprint();
  noConversion.pages[0].sectionInstances = noConversion.pages[0].sectionInstances.filter((s) => s.type !== "contact");
  const result2 = validateBlueprintConsistency(noConversion, requirements(2));
  assert.equal(result2.passed, false);
  assert.ok(result2.errors.some((e) => e.includes("geen conversiesectie")));
});

test("consistentie: geen twee identieke secties naast elkaar; max cta-secties en primaire CTA's", () => {
  const duplicate = consistentBlueprint();
  duplicate.pages[1].sectionInstances.splice(1, 0, {
    ...duplicate.pages[1].sectionInstances[1],
  });
  const result = validateBlueprintConsistency(duplicate, requirements(2));
  assert.ok(result.errors.some((e) => e.includes("direct achter elkaar")));

  const manyCtas = consistentBlueprint();
  const ctaInstance = manyCtas.pages[1].sectionInstances[1];
  manyCtas.pages[1].sectionInstances.push({ ...ctaInstance }, { ...ctaInstance });
  const result2 = validateBlueprintConsistency(manyCtas, requirements(2));
  assert.ok(result2.errors.some((e) => e.includes("maximaal 2 cta-secties") || e.includes("cta-secties")));
});

test("consistentie: contactpagina moet een contact-sectie bevatten; CTA-targets moeten uitvoerbaar zijn", () => {
  const contactPage = consistentBlueprint();
  contactPage.pages[1].key = "contact";
  const result = validateBlueprintConsistency(contactPage, requirements(2));
  assert.ok(result.errors.some((e) => e.includes("geen contact-sectie")));

  const badTarget = consistentBlueprint();
  badTarget.pages[1].sectionInstances[1].cta = { label: "Ga", target: "niet-bestaand-doel", prominence: "secondary" };
  const result2 = validateBlueprintConsistency(badTarget, requirements(2));
  assert.ok(result2.errors.some((e) => e.includes("niet uitvoerbaar")));
});

// ---------------------------------------------------------------------------
// Design Plan-integratie (backward compat + consistentiecheck)
// ---------------------------------------------------------------------------

/** Minimaal geldig v1-plan (zonder blueprint) zoals de bestaande flow die produceert. */
function v1Plan(blueprint?: unknown) {
  return {
    goals: { primaryGoal: "Aanvragen genereren", secondaryGoals: [], conversionGoal: null },
    audience: { primaryAudience: null, secondaryAudiences: [], toneOfVoice: null },
    navigation: {
      items: [
        { label: "Home", pageKey: "home" },
        { label: "Pagina 2", pageKey: "page-2" },
      ],
      structure: null,
    },
    pageStructure: [
      { key: "home", title: "Home", purpose: "Kernpagina.", sections: ["hero", "diensten"] },
      { key: "page-2", title: "Pagina 2", purpose: "Aanvulling.", sections: ["intro"] },
    ],
    visualHierarchy: { strategy: null, aboveTheFold: [] },
    branding: { styleDirection: null, mood: [], existingBrandAssets: null, preferredColors: [], dislikedColors: [], restrictions: [] },
    typography: { pairing: null, scale: null, weights: [], rationale: null },
    colors: { primary: null, secondary: null, accent: null, neutrals: [], usageGuidance: null },
    spacing: { scale: null, density: null },
    components: [{ key: "hero", purpose: "Primaire boodschap", notes: null }],
    ctaStrategy: { primary: null, secondary: null, placement: [], leadCapture: null },
    imagery: { style: null, requirements: [], placeholderStrategy: null },
    responsive: { mobile: null, tablet: null, desktop: null, breakpoints: [] },
    animation: { strategy: null, allowed: [], restrictions: [] },
    functionality: { features: [], integrations: [] },
    accessibility: { contrast: null, focusAndKeyboard: null, semantics: null, formsAndLabels: null, guidelines: [] },
    seoPerformance: { titleStrategy: null, metaStrategy: null, localSeo: null, performanceBudget: null, imageOptimization: null },
    basis: { sources: ["lead"] },
    ...(blueprint === undefined ? {} : { blueprint }),
    missingInformation: ["Geen echte USP's, cijfers of reviews aangeleverd — trust-secties niet gepland."],
  };
}

test("backward compat: v1-plan zonder blueprint blijft exact geldig (schema + consistentie ongewijzigd)", () => {
  const parsed = designPlanSchema.parse(v1Plan());
  assert.equal(parsed.blueprint, undefined);
  const result = validateDesignPlanConsistency(parsed, requirements(2));
  assert.deepEqual(result, { passed: true, errors: [] }, "v1-gedrag ongewijzigd");
});

test("integratie: plan met geldig blueprint slaagt; met inconsistent blueprint faalt de bestaande check", () => {
  const withBlueprint = designPlanSchema.parse(v1Plan(minimalBlueprint(2)));
  const ok = validateDesignPlanConsistency(withBlueprint, requirements(2));
  assert.equal(ok.passed, true, `onverwacht: ${ok.errors.join(" | ")}`);

  // blueprint plant 3 pagina's terwijl requirements 2 vermelden -> prijsintegriteit
  const inconsistent = designPlanSchema.parse(v1Plan(minimalBlueprint(3)));
  const failed = validateDesignPlanConsistency(inconsistent, requirements(2));
  assert.equal(failed.passed, false);
  assert.ok(failed.errors.some((e) => e.startsWith("Blueprint:")), "blueprint-fouten krijgen een Blueprint:-prefix");
  assert.ok(failed.errors.some((e) => e.includes("requirements vermelden 2")));
});

// ---------------------------------------------------------------------------
// AI-wiring: prompt-contract, budget en mock-output
// ---------------------------------------------------------------------------

test("AI-wiring: designplanning-prompt bevat het blueprint-veld, de registry-catalogus en de compositie-regels", () => {
  const start = SERVICE_SOURCE.indexOf("function buildDesignPlanPrompt");
  const end = SERVICE_SOURCE.indexOf("const WEBSITE_QC_SYSTEM", start);
  const block = SERVICE_SOURCE.slice(start, end);
  assert.ok(block.includes("BLUEPRINT-REGELS"), "prompt moet blueprint-regels bevatten");
  assert.ok(block.includes("buildBlueprintSectionContract()"), "prompt moet de registry-catalogus opnemen");
});

test("AI-wiring: designplanning-service gebruikt het thinking-proof blueprint-budget (16000)", () => {
  const start = SERVICE_SOURCE.indexOf("async generateDesignPlan");
  const end = SERVICE_SOURCE.indexOf("designPlanSchema", start);
  const block = SERVICE_SOURCE.slice(start, end);
  assert.match(block, /maxTokens: 16000/);
  assert.doesNotMatch(block, /maxTokens: 4000/);
  assert.doesNotMatch(block, /maxTokens: 12000/);
});

test("mock: mock-designplan bevat een registry-conform, schema-geldig blueprint (1 en 3 pagina's)", () => {
  for (const pages of [1, 3]) {
    const prompt = [
      "Plan het INTERNE Design Plan (JSON).",
      `Bedrijf: Testbedrijf (TESTDATA)`,
      `Branche: Dienstverlening (TESTDATA)`,
      `Plaats: Teststad (TESTDATA)`,
      `AANTAL PAGINA'S (bindend voor de paginastructuur): ${pages}`,
      "E-COMMERCE: nee",
    ].join("\n");
    const plan = designPlanSchema.parse(JSON.parse(buildMockDesignPlan(prompt)));
    assert.ok(plan.blueprint, "mock-plan moet een blueprint bevatten");
    const blueprint = websiteBlueprintSchema.parse(plan.blueprint);
    assert.equal(blueprint.pages.length, pages);
    const result = validateDesignPlanConsistency(plan, requirements(pages));
    assert.equal(result.passed, true, `mock-blueprint inconsistent: ${result.errors.join(" | ")}`);
  }
});

test("mock: mock-blueprint bevat géén verzonnen trust-data (alleen echte data toegestaan)", () => {
  const prompt = [
    "Plan het INTERNE Design Plan (JSON).",
    "Bedrijf: Testbedrijf (TESTDATA)",
    `AANTAL PAGINA'S (bindend voor de paginastructuur): 2`,
    "E-COMMERCE: nee",
  ].join("\n");
  const plan = designPlanSchema.parse(JSON.parse(buildMockDesignPlan(prompt)));
  assert.deepEqual(plan.blueprint?.trustElements, { usps: [], stats: [], badges: [] });
});
