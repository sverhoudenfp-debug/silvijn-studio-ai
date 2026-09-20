import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken (zelfde patroon als de compositietests).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import { composeBlueprintTemplates } from "../lib/websites/theme-zip/blueprint-composition";
import { buildShopifyTheme } from "../lib/websites/theme-zip/theme-builder";
import { designPlanSchema, type DesignPlan } from "../lib/websites/design-plan";
import { WebsiteSpecificationSchema } from "../lib/ai/schemas";
import { websiteBlueprintSchema, type WebsiteBlueprint } from "../lib/websites/blueprint/blueprint";
import {
  contentPlanSchema,
  contentUnitSchema,
  type ContentPlan,
  type ContentUnit,
} from "../lib/websites/content/content-plan";
import {
  buildContentPlanIndex,
  contentPlanTrustedClaims,
  resolveSlotText,
  resolveBlockTexts,
  unitRenderText,
} from "../lib/websites/content/content-plan-consumption";
import {
  resolveConsumablePlan,
  ContentPlanStaleError,
} from "../lib/websites/content/content-plan-service";
import type { ContentPlanRecord } from "../lib/websites/content/content-plan-repository";
import type { ContentPlanStatus } from "../lib/websites/content/content-plan";
import type { WebsiteSpecification } from "../lib/websites/types";
import type { WebsiteContactContext } from "../lib/websites/generator";

// ---------------------------------------------------------------------------
// C3d: ContentPlan → Website Generation (2026-09-20)
// De compositie consumeert units per exact pad ("<pageKey>/<sectionIndex>"):
// generated/fixed = tekst, customer/merchant_slot = bewust leeg, geen unit =
// legacy specification-flow. Blueprint-volgorde is heilig; backward compat
// zonder plan; stale/incomplete plannen zijn fail-loud veilig.
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

/**
 * Blueprint met MEERDERE instanties van hetzelfde type op home (hero x1,
 * services, cta x2) — de kerncase voor pad-gebonden content.
 */
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
          instance({ type: "hero", layout: "centered", cta: { label: "Neem contact op", target: "contact", prominence: "primary" } }),
          instance({ type: "services", layout: "cards", blocks: [{ kind: "service", hint: "Dienst" }, { kind: "service", hint: "Dienst" }] }),
          instance({ type: "cta", layout: "band", cta: { label: "Plan een gesprek", target: "form", prominence: "primary" } }),
          instance({ type: "cta", layout: "closing", cta: { label: "Bekijk onze werkwijze", target: "home", prominence: "secondary" } }),
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
    trustElements: {
      usps: [{ label: "10 jaar ervaring", source: "requirements" }],
      stats: [],
      badges: [],
    },
    conversionPlan: { primaryGoal: "Contact via formulier", leadCapture: true, contactPreference: "form" },
    missingInformation: [],
  });
}

function makeUnit(
  path: string,
  kind: string,
  status: "generated" | "fixed" | "customer_slot" | "merchant_slot",
  text: string | null,
  extra: Record<string, unknown> = {}
): ContentUnit {
  return contentUnitSchema.parse({
    path,
    kind,
    status,
    text,
    evidence: status === "generated" ? ["Letterlijk bewijsfragment uit de bron."] : [],
    sourceOrigin: status === "fixed" ? "requirements" : null,
    instruction: status === "customer_slot" ? "De klant levert hier een concrete tekst over het echte verhaal." : null,
    ...extra,
  });
}

function makePlan(pages: Array<{ key: string; units: ContentUnit[] }>): ContentPlan {
  return contentPlanSchema.parse({
    version: 1,
    designPlanId: "dp-test-1",
    sourceFingerprint: "fp-actueel",
    pages: pages.map((page) => ({
      key: page.key,
      seo: null,
      units: page.units,
    })),
    missingInformation: [],
  });
}

function templateByPath(result: { templates: Array<{ path: string; data: unknown }> }, path: string): Record<string, unknown> {
  const template = result.templates.find((t) => t.path === path);
  assert.ok(template, `Template ${path} ontbreekt`);
  return template.data as Record<string, unknown>;
}

function sectionOf(templateData: Record<string, unknown>, key: string): Record<string, unknown> {
  const sections = templateData.sections as Record<string, Record<string, unknown>>;
  const entry = sections[key];
  assert.ok(entry, `Sectie ${key} ontbreekt in de template`);
  return entry;
}

// ---------------------------------------------------------------------------
// 1. ContentPlan → juiste pagina
// ---------------------------------------------------------------------------
test("C3d: units landen op de juiste pagina (home → index.json, contact → page.contact.json)", () => {
  const plan = makePlan([
    {
      key: "home",
      units: [makeUnit("home/0", "headline", "generated", "Plan-kop voor de homepage")],
    },
    {
      key: "contact",
      units: [makeUnit("contact/0", "heading", "generated", "Plan-kop voor de contactpagina")],
    },
  ]);
  const result = composeBlueprintTemplates({ blueprint: baseBlueprint(), spec: SPECIFICATION, contact: CONTACT, contentPlan: plan });

  const home = templateByPath(result, "templates/index.json");
  const hero = sectionOf(home, "hero");
  assert.equal((hero.settings as Record<string, unknown>).heading, "Plan-kop voor de homepage");

  const contactPage = templateByPath(result, "templates/page.contact.json");
  const contact = sectionOf(contactPage, "contact");
  assert.equal((contact.settings as Record<string, unknown>).heading, "Plan-kop voor de contactpagina");
});

// ---------------------------------------------------------------------------
// 2. ContentPlan → juiste sectie-instance (pad-gebonden)
// ---------------------------------------------------------------------------
test("C3d: units zijn gebonden aan de exacte sectie-instantie (home/0 vs home/1)", () => {
  const plan = makePlan([
    {
      key: "home",
      units: [
        makeUnit("home/0", "headline", "generated", "Hero-kop uit het plan"),
        makeUnit("home/1", "item_title", "fixed", "Webdesign uit het plan", { sourceOrigin: "requirements" }),
      ],
    },
  ]);
  const result = composeBlueprintTemplates({ blueprint: baseBlueprint(), spec: SPECIFICATION, contact: CONTACT, contentPlan: plan });
  const home = templateByPath(result, "templates/index.json");

  const hero = sectionOf(home, "hero");
  assert.equal((hero.settings as Record<string, unknown>).heading, "Hero-kop uit het plan");

  const services = sectionOf(home, "services");
  const blocks = services.blocks as Record<string, Record<string, unknown>>;
  const firstService = blocks["service-1"].settings as Record<string, unknown>;
  assert.equal(firstService.title, "Webdesign uit het plan");
});

// ---------------------------------------------------------------------------
// 3. Meerdere instanties van hetzelfde type krijgen nooit dezelfde content
// ---------------------------------------------------------------------------
test("C3d: twee cta-instanties krijgen hun eigen pad-gebonden content", () => {
  const plan = makePlan([
    {
      key: "home",
      units: [
        makeUnit("home/2", "cta_label", "generated", "Plan vrijblijvend gesprek"),
        makeUnit("home/3", "cta_label", "generated", "Plan terug naar home"),
      ],
    },
  ]);
  const result = composeBlueprintTemplates({ blueprint: baseBlueprint(), spec: SPECIFICATION, contact: CONTACT, contentPlan: plan });
  const home = templateByPath(result, "templates/index.json");

  const cta1 = sectionOf(home, "cta");
  const cta2 = sectionOf(home, "cta_2");
  assert.equal((cta1.settings as Record<string, unknown>).cta_label, "Plan vrijblijvend gesprek");
  assert.equal((cta2.settings as Record<string, unknown>).cta_label, "Plan terug naar home");
  // De volgorde blijft exact: cta vóór cta_2 in order.
  const order = home.order as string[];
  assert.ok(order.indexOf("cta") < order.indexOf("cta_2"));
});

test("C3d: een unit op home landt nergens op een andere pagina", () => {
  const plan = makePlan([
    { key: "home", units: [makeUnit("home/0", "headline", "generated", "Alleen-home-kop")] },
    { key: "contact", units: [] },
  ]);
  const result = composeBlueprintTemplates({ blueprint: baseBlueprint(), spec: SPECIFICATION, contact: CONTACT, contentPlan: plan });
  const contactPage = templateByPath(result, "templates/page.contact.json");
  const contact = sectionOf(contactPage, "contact");
  // Geen unit op contact/0 → legacy specificatie-flow (fallback), nooit de home-tekst.
  assert.equal((contact.settings as Record<string, unknown>).heading, "Contact");
  assert.notEqual((contact.settings as Record<string, unknown>).heading, "Alleen-home-kop");
});

// ---------------------------------------------------------------------------
// 4. Generated content (evidence-gedragen)
// ---------------------------------------------------------------------------
test("C3d: generated unit-tekst vervangt de specificatie-waarde exact", () => {
  const plan = makePlan([
    { key: "home", units: [makeUnit("home/0", "headline", "generated", "Waarom Testbedrijf kiest voor maatwerk")] },
  ]);
  const result = composeBlueprintTemplates({ blueprint: baseBlueprint(), spec: SPECIFICATION, contact: CONTACT, contentPlan: plan });
  const hero = sectionOf(templateByPath(result, "templates/index.json"), "hero");
  assert.equal((hero.settings as Record<string, unknown>).heading, "Waarom Testbedrijf kiest voor maatwerk");
});

// ---------------------------------------------------------------------------
// 5. Fixed content (fact-locked verbatim)
// ---------------------------------------------------------------------------
test("C3d: fixed unit wordt verbatim overgenomen (deterministisch beschermd)", () => {
  const plan = makePlan([
    {
      key: "home",
      units: [
        makeUnit("home/1", "item_title", "fixed", "Strakke hoveniersdiensten", { sourceOrigin: "requirements" }),
        makeUnit("home/1", "item_body", "fixed", "Van aanleg tot onderhoud: alles volgens plan.", { sourceOrigin: "requirements" }),
      ],
    },
  ]);
  const result = composeBlueprintTemplates({ blueprint: baseBlueprint(), spec: SPECIFICATION, contact: CONTACT, contentPlan: plan });
  const services = sectionOf(templateByPath(result, "templates/index.json"), "services");
  const blocks = services.blocks as Record<string, Record<string, unknown>>;
  assert.equal((blocks["service-1"].settings as Record<string, unknown>).title, "Strakke hoveniersdiensten");
  assert.equal((blocks["service-1"].settings as Record<string, unknown>).description, "Van aanleg tot onderhoud: alles volgens plan.");
});

// ---------------------------------------------------------------------------
// 6. customer_slot: bewust leeg, nooit als verzonnen tekst weergegeven
// ---------------------------------------------------------------------------
test("C3d: customer_slot blijft leeg (invulbaar) en wordt eerlijk gerapporteerd", () => {
  const plan = makePlan([
    {
      key: "home",
      units: [
        makeUnit("home/0", "headline", "generated", "Plan-kop"),
        makeUnit("home/0", "subheadline", "customer_slot", null),
      ],
    },
  ]);
  const result = composeBlueprintTemplates({ blueprint: baseBlueprint(), spec: SPECIFICATION, contact: CONTACT, contentPlan: plan });
  const hero = sectionOf(templateByPath(result, "templates/index.json"), "hero");
  const settings = hero.settings as Record<string, unknown>;
  assert.equal(settings.heading, "Plan-kop");
  assert.equal(settings.subheading, null); // bewust leeg, niet de specificatie-fallback
  const slotNote = result.notes.find((n) => n.includes("wachten op klantcontent"));
  assert.ok(slotNote, "customer_slot moet in de notities zichtbaar blijven");
  assert.ok(slotNote!.includes("home/0/subheadline"));
});

// ---------------------------------------------------------------------------
// 7. merchant_slot: bewust leeg, invulbaar in de theme editor
// ---------------------------------------------------------------------------
test("C3d: merchant_slot blijft leeg (geen AI-tekst) en wordt genoteerd", () => {
  const plan = makePlan([
    {
      key: "home",
      units: [
        makeUnit("home/0", "headline", "generated", "Plan-kop"),
        makeUnit("home/1", "item_body", "merchant_slot", null),
      ],
    },
  ]);
  const result = composeBlueprintTemplates({ blueprint: baseBlueprint(), spec: SPECIFICATION, contact: CONTACT, contentPlan: plan });
  const services = sectionOf(templateByPath(result, "templates/index.json"), "services");
  const blocks = services.blocks as Record<string, Record<string, unknown>>;
  // service-1: item_body is merchant_slot → bewust null (specificatie-fallback wordt NIET gebruikt).
  assert.equal((blocks["service-1"].settings as Record<string, unknown>).description, null);
  const merchantNote = result.notes.find((n) => n.includes("ruimte voor de merchant"));
  assert.ok(merchantNote, "merchant_slot moet in de notities zichtbaar blijven");
});

// ---------------------------------------------------------------------------
// 8. Evidence/trustedClaims richting ZIP-validatie
// ---------------------------------------------------------------------------
test("C3d: contentPlanTrustedClaims bevat alléén fact-locked teksten", () => {
  const plan = makePlan([
    {
      key: "home",
      units: [
        makeUnit("home/0", "headline", "generated", "AI-geformuleerde kop"),
        makeUnit("home/1", "item_title", "fixed", "Verbatim dienstnaam", { sourceOrigin: "lead" }),
      ],
    },
  ]);
  const claims = contentPlanTrustedClaims(plan);
  assert.deepEqual(claims, ["Verbatim dienstnaam"]);
  assert.ok(!claims.includes("AI-geformuleerde kop"));
});

test("C3d: buildShopifyTheme geeft het plan door naar de compositie (E2E-keten)", () => {
  const designPlan = designPlanSchema.parse({
    goals: { primaryGoal: null, secondaryGoals: [], conversionGoal: null },
    audience: { primaryAudience: null, secondaryAudiences: [], toneOfVoice: null },
    navigation: { items: [{ label: "Home", pageKey: "home" }, { label: "Contact", pageKey: "contact" }], structure: null },
    pageStructure: [
      { key: "home", title: "Home", purpose: "Landingspagina", sections: ["hero"] },
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
    blueprint: baseBlueprint(),
  }) as DesignPlan;

  const plan = makePlan([
    { key: "home", units: [makeUnit("home/0", "headline", "generated", "Theme-builder E2E-kop uit het plan")] },
  ]);

  const withPlan = buildShopifyTheme({ specification: SPECIFICATION, designPlan, contact: CONTACT, contentPlan: plan });
  const indexFile = withPlan.files.find((f) => f.path === "templates/index.json");
  assert.ok(indexFile);
  const index = JSON.parse(indexFile.content) as { sections: Record<string, Record<string, unknown>> };
  assert.equal((index.sections.hero.settings as Record<string, unknown>).heading, "Theme-builder E2E-kop uit het plan");
  assert.ok(withPlan.notes.some((n) => n.includes("ContentPlan-consumptie")));
});

// ---------------------------------------------------------------------------
// 9. Geen ContentPlan → legacy flow (byte-identiek)
// ---------------------------------------------------------------------------
test("C3d: zonder ContentPlan is de compositie byte-identiek aan de legacy-flow", () => {
  const blueprint = baseBlueprint();
  const legacy = composeBlueprintTemplates({ blueprint, spec: SPECIFICATION, contact: CONTACT });
  const zonderParam = composeBlueprintTemplates({ blueprint, spec: SPECIFICATION, contact: CONTACT, contentPlan: null });
  assert.deepEqual(JSON.stringify(zonderParam), JSON.stringify(legacy));
  // En de legacy-flow zelf bevat géén C3d-notities.
  assert.ok(!legacy.notes.some((n) => n.includes("ContentPlan")));
});

test("C3d: v1-plan zonder blueprint breekt niets (legacy homepage-compositie)", () => {
  // buildShopifyTheme zonder blueprint-val is al gedekt door de bestaande
  // blueprint-composition-tests; hier: plan zonder blueprint-properties op
  // het Design Plan-object is onmogelijk (Zod), dus alleen de compositie-check:
  const blueprint = baseBlueprint();
  const result = composeBlueprintTemplates({ blueprint, spec: SPECIFICATION, contact: CONTACT, contentPlan: makePlan([{ key: "home", units: [] }]) });
  // Plan aanwezig maar leeg → fallback specificatie-content, correcte notitie.
  const hero = sectionOf(templateByPath(result, "templates/index.json"), "hero");
  assert.equal((hero.settings as Record<string, unknown>).heading, SPECIFICATION.content.headline);
});

// ---------------------------------------------------------------------------
// 10. Stale/incomplete ContentPlan → veilig/fail-loud
// ---------------------------------------------------------------------------
function record(version: number, status: ContentPlanStatus, fingerprint: string, plan: ContentPlan | null): ContentPlanRecord {
  return {
    id: `cp-${version}`,
    projectId: "p-1",
    leadId: "l-1",
    designPlanId: "dp-test-1",
    version,
    status,
    mode: "live",
    model: "claude-sonnet-5",
    sourceFingerprint: fingerprint,
    plan,
    missingInformation: [],
    validationErrors: [],
    generationNotes: "",
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
  };
}

test("C3d: resolveConsumablePlan — geen completed plan → null (legacy-flow)", () => {
  const completed = makePlan([{ key: "home", units: [makeUnit("home/0", "headline", "generated", "Kop")] }]);
  assert.equal(resolveConsumablePlan([record(1, "failed", "fp-actueel", completed)], "fp-actueel"), null);
  assert.equal(resolveConsumablePlan([record(1, "draft", "fp-actueel", completed)], "fp-actueel"), null);
  assert.equal(resolveConsumablePlan([], "fp-actueel"), null);
});

test("C3d: resolveConsumablePlan — actueel completed plan → het gevalideerde plan", () => {
  const plan = makePlan([{ key: "home", units: [makeUnit("home/0", "headline", "generated", "Kop")] }]);
  const result = resolveConsumablePlan([record(1, "completed", "fp-actueel", plan)], "fp-actueel");
  assert.ok(result);
  assert.equal(result.pages[0].units[0].text, "Kop");
});

test("C3d: resolveConsumablePlan — stale completed plan → ContentPlanStaleError (fail-loud)", () => {
  const plan = makePlan([{ key: "home", units: [makeUnit("home/0", "headline", "generated", "Kop")] }]);
  assert.throws(
    () => resolveConsumablePlan([record(2, "completed", "fp-oud", plan)], "fp-nieuw"),
    (error: unknown) => error instanceof ContentPlanStaleError && error.existing.version === 2
  );
});

test("C3d: resolveConsumablePlan — nieuwste completed versie wint", () => {
  const oud = makePlan([{ key: "home", units: [makeUnit("home/0", "headline", "generated", "Oude kop")] }]);
  const nieuw = makePlan([{ key: "home", units: [makeUnit("home/0", "headline", "generated", "Nieuwe kop")] }]);
  const result = resolveConsumablePlan(
    [record(1, "completed", "fp-actueel", oud), record(2, "completed", "fp-actueel", nieuw)],
    "fp-actueel"
  );
  assert.ok(result);
  assert.equal(result.pages[0].units[0].text, "Nieuwe kop");
});

// ---------------------------------------------------------------------------
// 11. Blueprint-volgorde exact behouden
// ---------------------------------------------------------------------------
test("C3d: de sectievolgorde blijft exact gelijk met en zonder ContentPlan", () => {
  const blueprint = baseBlueprint();
  const plan = makePlan([
    {
      key: "home",
      units: [
        makeUnit("home/0", "headline", "generated", "Kop"),
        makeUnit("home/2", "cta_label", "generated", "Eerste CTA"),
        makeUnit("home/3", "cta_label", "generated", "Tweede CTA"),
      ],
    },
  ]);
  const zonder = composeBlueprintTemplates({ blueprint, spec: SPECIFICATION, contact: CONTACT });
  const met = composeBlueprintTemplates({ blueprint, spec: SPECIFICATION, contact: CONTACT, contentPlan: plan });
  for (const template of zonder.templates) {
    const withPlan = met.templates.find((t) => t.path === template.path);
    assert.ok(withPlan, `Template ${template.path} verdwijnt niet`);
    assert.deepEqual(
      (withPlan.data as { order: string[] }).order,
      (template.data as { order: string[] }).order,
      `Volgorde op ${template.path} wijkt af`
    );
    assert.deepEqual(
      Object.keys((template.data as { sections: Record<string, unknown> }).sections),
      Object.keys((withPlan.data as { sections: Record<string, unknown> }).sections),
      `Sectie-set op ${template.path} wijkt af`
    );
  }
});

// ---------------------------------------------------------------------------
// 12. Zuivere helpers
// ---------------------------------------------------------------------------
test("C3d: unitRenderText — statuses correct", () => {
  assert.equal(unitRenderText(makeUnit("home/0", "headline", "generated", "Tekst")), "Tekst");
  assert.equal(unitRenderText(makeUnit("home/0", "item_title", "fixed", "Vast", { sourceOrigin: "lead" })), "Vast");
  assert.equal(unitRenderText(makeUnit("home/0", "subheadline", "customer_slot", null)), null);
  assert.equal(unitRenderText(makeUnit("home/0", "item_body", "merchant_slot", null)), null);
  assert.equal(unitRenderText(makeUnit("home/0", "headline", "generated", "  ")), null);
});

test("C3d: resolveSlotText — tri-state (afwezig=fallback, slot=null, tekst=tekst)", () => {
  const plan = makePlan([
    {
      key: "home",
      units: [
        makeUnit("home/0", "headline", "generated", "Kop"),
        makeUnit("home/0", "subheadline", "customer_slot", null),
      ],
    },
  ]);
  const index = buildContentPlanIndex(plan);
  const units = index.get("home")!.unitsByPath.get("home/0")!;
  assert.equal(resolveSlotText(units, "headline", "fallback"), "Kop");
  assert.equal(resolveSlotText(units, "subheadline", "fallback"), null);
  assert.equal(resolveSlotText(units, "cta_label", "fallback"), "fallback");
});

test("C3d: resolveBlockTexts — blokken volgen unitvolgorde met specificatie-fallback", () => {
  const plan = makePlan([
    {
      key: "home",
      units: [
        makeUnit("home/1", "item_title", "fixed", "Dienst één", { sourceOrigin: "requirements" }),
        makeUnit("home/1", "item_title", "fixed", "Dienst twee", { sourceOrigin: "requirements" }),
      ],
    },
  ]);
  const index = buildContentPlanIndex(plan);
  const units = index.get("home")!.unitsByPath.get("home/1")!;
  const result = resolveBlockTexts(units, "item_title", 3, ["Spec-dienst"]);
  assert.deepEqual(result, ["Dienst één", "Dienst twee", null]);
  // Zonder units: exact de specificatie-flow.
  assert.deepEqual(resolveBlockTexts(null, "item_title", 3, ["Spec-dienst"]), ["Spec-dienst", null, null]);
});
