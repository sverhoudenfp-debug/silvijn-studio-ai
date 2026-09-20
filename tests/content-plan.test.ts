import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contentPlanSchema,
  contentUnitSchema,
  validateContentPlanConsistency,
  type ContentPlan,
  type ContentUnit,
} from "@/lib/websites/content/content-plan";
import { websiteBlueprintSchema, type WebsiteBlueprint } from "@/lib/websites/blueprint/blueprint";
import { assembleContentSourceBundle, type ContentSourceBundle, type ContentSourceInput } from "@/lib/websites/content/content-source";
import { designPlanSchema } from "@/lib/websites/design-plan";
import { buildMockDesignPlan } from "@/lib/ai/mock-provider";
import type { ProjectRequirements } from "@/lib/projects/types";

// ---------------------------------------------------------------------------
// C3a — CONTENT PLAN: schema-invarianten, consistency, v1/v2-compatibiliteit
// ---------------------------------------------------------------------------

const REQUIREMENTS: ProjectRequirements = { numberOfPages: 3, copywriting: true };

const MOCK_PROMPT = [
  "Plan het INTERNE Design Plan (JSON).",
  "Bedrijf: Bakkerij De Gouden Korst",
  "Branche: Bakkerij",
  "Plaats: Utrecht",
  "AANTAL PAGINA'S (bindend voor de paginastructuur): 3",
  "E-COMMERCE: nee",
].join("\n");

function mockPlan(): ReturnType<typeof designPlanSchema.parse> {
  return designPlanSchema.parse(JSON.parse(buildMockDesignPlan(MOCK_PROMPT)));
}

function makeBlueprint(): WebsiteBlueprint {
  return websiteBlueprintSchema.parse({
    version: 2,
    pages: [
      {
        key: "home",
        title: "Home",
        purpose: "Voorstelfpagina met primaire conversie",
        seo: { title: null, metaDescription: null },
        sectionInstances: [
          {
            type: "hero",
            layout: "split",
            blocks: [],
            media: [],
            cta: { label: "Neem contact op", target: "/contact", prominence: "primary" },
            background: "default",
            motion: "fade_up",
            contentHints: "Warm en zakelijk",
          },
          {
            type: "services",
            layout: "cards",
            blocks: [
              { kind: "service", hint: "Webdesign" },
              { kind: "service", hint: "Logo-vernieuwing" },
            ],
            media: [],
            cta: null,
            background: "default",
            motion: "none",
            contentHints: null,
          },
          {
            type: "cta",
            layout: "band",
            blocks: [],
            media: [],
            cta: { label: "Plan een gesprek", target: "/contact", prominence: "primary" },
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
    ],
    trustElements: { usps: [], stats: [], badges: [] },
    conversionPlan: { primaryGoal: "Contact aanvragen", leadCapture: true, contactPreference: "form" },
    missingInformation: [],
  });
}

function makeBundle(): ContentSourceBundle {
  const plan = mockPlan();
  plan.blueprint = makeBlueprint();
  const input: ContentSourceInput = {
    lead: {
      businessName: "Bakkerij De Gouden Korst",
      industry: "Bakkerij",
      address: null,
      city: "Utrecht",
      province: "Utrecht",
      phone: "030-1234567",
      email: "info@goudenkorst.nl",
      website: null,
      websiteStatus: "no_website",
      googleRating: 4.8,
      reviewCount: 23,
    },
    qualificationNotes: ["Bel ons: 030-1234567"],
    questionnaire: null,
    requirements: REQUIREMENTS,
    designPlan: plan,
  };
  return assembleContentSourceBundle(input);
}

function unit(path: string, kind: string, status: string, extra: Partial<ContentUnit> = {}): Record<string, unknown> {
  return {
    path,
    kind,
    status,
    text: extra.text ?? null,
    evidence: extra.evidence ?? [],
    sourceOrigin: extra.sourceOrigin ?? null,
    instruction: extra.instruction ?? null,
  };
}

function makePlan(bundle: ContentSourceBundle, units: Record<string, unknown>[]): ContentPlan {
  return contentPlanSchema.parse({
    version: 1,
    designPlanId: "11111111-1111-1111-1111-111111111111",
    sourceFingerprint: bundle.fingerprint,
    pages: [
      {
        key: "home",
        seo: { title: "Bakkerij De Gouden Korst — Utrecht", metaDescription: "Verse broodjes en taarten in Utrecht." },
        units,
      },
    ],
    missingInformation: [],
  });
}

/** Volledig geldige units voor het blauwdrukfixture (coverage-compleet). */
function validUnits(bundle: ContentSourceBundle): Record<string, unknown>[] {
  const phoneText = bundle.items.find((i) => i.key === "phone")!.text;
  const noteText = bundle.items.find((i) => i.key === "note:0")!.text;
  return [
    unit("home/0", "headline", "generated", {
      text: "Verse bakkerij in het hart van Utrecht",
      evidence: [bundle.items.find((i) => i.key === "businessName")!.text, bundle.items.find((i) => i.key === "location")!.text],
      sourceOrigin: "lead",
    }),
    unit("home/0", "cta_label", "generated", { text: "Neem contact op", evidence: [phoneText], sourceOrigin: "lead" }),
    unit("home/1", "item_title", "customer_slot", {
      instruction: "Vul per dienst de exacte naam in zoals klanten die kennen (webdesign, logo-vernieuwing).",
    }),
    unit("home/1", "item_body", "customer_slot", {
      instruction: "Beschrijf per dienst in 2-3 zinnen wat je aanbiedt, zoals je het aan een klant zou uitleggen.",
    }),
    unit("home/2", "cta_label", "generated", { text: "Plan een gesprek", evidence: [phoneText], sourceOrigin: "lead" }),
    unit("home/3", "heading", "customer_slot", { instruction: "Geef een korte kop boven het contactformulier." }),
    unit("home/3", "cta_label", "generated", { text: "Verstuur bericht", evidence: [phoneText], sourceOrigin: "lead" }),
    // fixed = deterministisch overgenomen waarde: byte-gelijk aan de
    // qualification-notitie in de bundel.
    unit("home/3", "microcopy", "fixed", { text: noteText, sourceOrigin: "qualification" }),
  ];
}

test("content-plan: schema-invarianten per status", () => {
  // generated vereist evidence
  assert.ok(!contentUnitSchema.safeParse(unit("home/0", "headline", "generated", { text: "Zomaar" })).success);
  // customer_slot vereist instructie
  assert.ok(!contentUnitSchema.safeParse(unit("home/0", "headline", "customer_slot", {})).success);
  // merchant_slot mag geen tekst hebben
  assert.ok(!contentUnitSchema.safeParse(unit("home/0", "alt_text", "merchant_slot", { text: " AI" })).success);
  // fixed vereist text + sourceOrigin, zonder evidence
  assert.ok(!contentUnitSchema.safeParse(unit("home/0", "cta_label", "fixed", { text: "Klik hier" })).success);
  assert.ok(
    !contentUnitSchema.safeParse(unit("home/0", "cta_label", "fixed", { text: "Klik hier", sourceOrigin: "lead", evidence: ["onverwacht"] }))
      .success
  );
  // Alleen generated mag evidence dragen
  assert.ok(
    !contentUnitSchema.safeParse(
      unit("home/1", "item_title", "customer_slot", { instruction: "Vul de dienstnaam in.", evidence: ["webdesign"] })
    ).success
  );
});

test("content-plan: gesloten kinds en statussen", () => {
  const plan = makePlan(makeBundle(), validUnits(makeBundle()));
  assert.ok(plan.pages[0].units.length >= 6);
  assert.ok(!contentUnitSchema.safeParse(unit("home/0", "niet_bestaand_kind", "generated", { evidence: ["abc"] })).success);
  assert.ok(!contentUnitSchema.safeParse(unit("home/0", "headline", "vreemde_status")).success);
});

test("content-plan: consistency — geldig plan slaagt", () => {
  const bundle = makeBundle();
  const plan = makePlan(bundle, validUnits(bundle));
  const result = validateContentPlanConsistency(plan, makeBlueprint(), bundle);
  assert.deepEqual(result.errors, []);
  assert.equal(result.passed, true);
});

test("content-plan: consistency — onbekend pad en verkeerd kind failen", () => {
  const bundle = makeBundle();
  const blueprint = makeBlueprint();

  const badPath = makePlan(bundle, [...validUnits(bundle), unit("home/99", "headline", "customer_slot", { instruction: "Vul de kop in." })]);
  const r1 = validateContentPlanConsistency(badPath, blueprint, bundle);
  assert.equal(r1.passed, false);
  assert.ok(r1.errors.some((e) => e.includes("home/99")), r1.errors.join(" | "));

  // quote-kind hoort niet bij hero
  const badKind = makePlan(bundle, [
    ...validUnits(bundle),
    unit("home/0", "quote", "generated", { text: "Top!", evidence: [bundle.items[0].text], sourceOrigin: "lead" }),
  ]);
  const r2 = validateContentPlanConsistency(badKind, blueprint, bundle);
  assert.equal(r2.passed, false);
  assert.ok(r2.errors.some((e) => e.includes("niet toegestaan bij sectietype")), r2.errors.join(" | "));
});

test("content-plan: consistency — ontbrekende verplichte slot en missende pagina failen", () => {
  const bundle = makeBundle();
  const blueprint = makeBlueprint();

  // hero zonder cta_label (verplicht)
  const noCta = makePlan(
    bundle,
    validUnits(bundle).filter((u) => !(u.path === "home/0" && u.kind === "cta_label"))
  );
  const r1 = validateContentPlanConsistency(noCta, blueprint, bundle);
  assert.equal(r1.passed, false);
  assert.ok(r1.errors.some((e) => e.includes('mist verplicht content-slot "cta_label"')), r1.errors.join(" | "));

  // plan-pagina die niet in het blueprint bestaat
  const extraPage = makePlan(bundle, validUnits(bundle));
  extraPage.pages.push({ key: "niet-bestaand", seo: null, units: [] });
  const r2 = validateContentPlanConsistency(extraPage, blueprint, bundle);
  assert.equal(r2.passed, false);
  assert.ok(r2.errors.some((e) => e.includes('bestaat niet in het blueprint')), r2.errors.join(" | "));

  // blueprint-pagina die het plan niet dekt: blueprint krijgt een tweede
  // pagina die het plan niet bevat.
  const blueprintTwoPages = makeBlueprint();
  blueprintTwoPages.pages.push({
    key: "over-ons",
    title: "Over ons",
    purpose: "Bedrijfsverhaal",
    seo: { title: null, metaDescription: null },
    sectionInstances: [
      {
        type: "about", layout: "default",
        blocks: [{ kind: "paragraph", hint: "Verhaal" }],
        media: [], cta: null, background: "default", motion: "none", contentHints: null,
      },
    ],
  });
  const missingPage = makePlan(bundle, []);
  const r3 = validateContentPlanConsistency(missingPage, blueprintTwoPages, bundle);
  assert.ok(r3.errors.some((e) => e.includes('mist in het ContentPlan')), r3.errors.join(" | "));
});

test("content-plan: consistency — fixed moet byte-gelijk aan een brontekst zijn", () => {
  const bundle = makeBundle();
  const blueprint = makeBlueprint();
  const tampered = makePlan(bundle, [
    ...validUnits(bundle).map((u) =>
      u.path === "home/3" && u.kind === "microcopy" ? { ...u, text: "AI-verzonnen hulptekst", sourceOrigin: "qualification" } : u
    ),
  ]);
  const result = validateContentPlanConsistency(tampered, blueprint, bundle);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes("niet byte-gelijk aan een brontekst")), result.errors.join(" | "));

  // De originele fixed unit (byte-gelijk aan de notitie) geeft géén fout.
  const clean = validateContentPlanConsistency(makePlan(bundle, validUnits(bundle)), blueprint, bundle);
  assert.ok(!clean.errors.some((e) => e.includes("byte-gelijk")), clean.errors.join(" | "));
});

test("content-plan: consistency — evidence_only-instanties zijn bron-gebonden", () => {
  const bundle = makeBundle();
  const blueprint = makeBlueprint();
  // Voeg een evidence_only-instantie (stats) toe aan het blueprint mét echte trust-data.
  blueprint.trustElements.stats = [{ label: "Jaren ervaring", value: "12", source: "questionnaire" }];
  blueprint.pages[0].sectionInstances.push({
    type: "stats",
    layout: "row",
    blocks: [
      { kind: "stat", hint: null },
      { kind: "stat", hint: null },
    ],
    media: [],
    cta: null,
    background: "default",
    motion: "none",
    contentHints: null,
  });

  // customer_slot op een evidence_only-sectie is verboden
  const withCustomerSlot = makePlan(bundle, [
    ...validUnits(bundle),
    unit("home/4", "stat_label", "customer_slot", { instruction: "Vul het cijfer in dat je wilt tonen." }),
  ]);
  const r1 = validateContentPlanConsistency(withCustomerSlot, blueprint, bundle);
  assert.ok(r1.errors.some((e) => e.includes("kent geen customer_slot-units")), r1.errors.join(" | "));

  // generated zonder sourceOrigin is verboden op evidence_only
  const noOrigin = makePlan(bundle, [
    ...validUnits(bundle),
    unit("home/4", "stat_value", "generated", { text: "12", evidence: ["12"], sourceOrigin: null }),
  ]);
  const r2 = validateContentPlanConsistency(noOrigin, blueprint, bundle);
  assert.ok(r2.errors.some((e) => e.includes("vereist een sourceOrigin")), r2.errors.join(" | "));

  // Bron-gebonden fixed-units zijn correct
  const statSource = bundle.items.find((i) => i.key === "googleRating")!;
  const ok = makePlan(bundle, [
    ...validUnits(bundle),
    unit("home/4", "stat_label", "fixed", { text: statSource.text, sourceOrigin: "lead" }),
    unit("home/4", "stat_value", "fixed", { text: statSource.text, sourceOrigin: "lead" }),
  ]);
  const r3 = validateContentPlanConsistency(ok, blueprint, bundle);
  assert.deepEqual(r3.errors.filter((e) => e.includes("home/4")), []);
});

test("content-plan: v1/v2-compatibiliteit — bestaande plannen blijven exact geldig", () => {
  // 1. Een v1-designplan (zonder blueprint) valideert nog steeds door de
  //    bestaande schema's — de content-modules veranderen er niets aan.
  const v1 = mockPlan();
  v1.blueprint = null;
  assert.equal(designPlanSchema.safeParse(v1).success, true);

  // 2. De SourceBundle bouwt ook zonder blueprint (graceful v1-gedrag).
  const bundle = assembleContentSourceBundle({
    lead: {
      businessName: "Bakkerij De Gouden Korst",
      industry: "Bakkerij",
      address: null,
      city: "Utrecht",
      province: "Utrecht",
      phone: null,
      email: null,
      website: null,
      websiteStatus: "no_website",
      googleRating: null,
      reviewCount: null,
    },
    qualificationNotes: [],
    questionnaire: null,
    requirements: REQUIREMENTS,
    designPlan: v1,
  });
  assert.ok(bundle.items.length > 0);

  // 3. Een v2-plan mét blueprint blijft ook geldig (bestaande situatie).
  const v2 = mockPlan();
  if (!v2.blueprint) v2.blueprint = makeBlueprint();
  assert.equal(designPlanSchema.safeParse(v2).success, true);
});

test("content-plan: designPlanId + sourceFingerprint zijn verplichte koppeling", () => {
  const bundle = makeBundle();
  const units = validUnits(bundle);
  assert.ok(
    !contentPlanSchema.safeParse({
      version: 1,
      sourceFingerprint: bundle.fingerprint,
      pages: [{ key: "home", seo: null, units }],
      missingInformation: [],
    }).success,
    "designPlanId is verplicht"
  );
  assert.ok(
    !contentPlanSchema.safeParse({
      version: 1,
      designPlanId: "11111111-1111-1111-1111-111111111111",
      pages: [{ key: "home", seo: null, units }],
      missingInformation: [],
    }).success,
    "sourceFingerprint is verplicht"
  );
});
