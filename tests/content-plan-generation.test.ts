import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { designPlanSchema } from "@/lib/websites/design-plan";
import { buildMockDesignPlan, buildMockContentPlan } from "@/lib/ai/mock-provider";
import { websiteBlueprintSchema, type WebsiteBlueprint } from "@/lib/websites/blueprint/blueprint";
import { assembleContentSourceBundle, type ContentSourceBundle, type ContentSourceInput } from "@/lib/websites/content/content-source";
import {
  finalizeRawContentPlan,
  rawContentPlanOutputSchema,
  ContentPlanFinalizeError,
  type RawContentPlanOutput,
} from "@/lib/websites/content/content-plan-finalizer";
import { validateContentPlanConsistency } from "@/lib/websites/content/content-plan";
import { contentSlotsForSection } from "@/lib/websites/content/content-slots";
import { buildContentPlanPrompt, CONTENT_GENERATION_SYSTEM } from "@/lib/websites/content/content-plan-prompt";
import {
  isContentStale,
  nextContentPlanVersion,
  requireBlueprint,
  ContentPlanError,
} from "@/lib/websites/content/content-plan-service";
import type { ContentPlanRecord } from "@/lib/websites/content/content-plan-repository";
import type { DesignPlanRecord } from "@/lib/websites/design-plan";
import type { ProjectRequirements } from "@/lib/projects/types";

// ---------------------------------------------------------------------------
// C3b — ContentPlan service/AI-generation regressietests
// ---------------------------------------------------------------------------

const REQUIREMENTS: ProjectRequirements = { numberOfPages: 3, copywriting: true };
const DESIGN_PLAN_ID = "11111111-1111-1111-1111-111111111111";

function makeBlueprint(opts: { withTrust?: boolean; withSecondServices?: boolean } = {}): WebsiteBlueprint {
  return websiteBlueprintSchema.parse({
    version: 2,
    pages: [
      {
        key: "home",
        title: "Home",
        purpose: "Voorstelpagina met primaire conversie",
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
          ...(opts.withSecondServices
            ? [
                {
                  type: "services" as const,
                  layout: "list" as const,
                  blocks: [
                    { kind: "service", hint: "Onderhoud" },
                    { kind: "service", hint: "SEO" },
                  ],
                  media: [],
                  cta: null,
                  background: "default" as const,
                  motion: "none" as const,
                  contentHints: null,
                },
              ]
            : []),
          ...(opts.withTrust
            ? [
                {
                  type: "usp_band" as const,
                  layout: "row" as const,
                  blocks: [
                    { kind: "usp", hint: "Persoonlijk meubeladvies aan huis" },
                    { kind: "usp", hint: "Eigen atelier in Utrecht" },
                  ],
                  media: [],
                  cta: null,
                  background: "default" as const,
                  motion: "none" as const,
                  contentHints: null,
                },
              ]
            : []),
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
    trustElements: opts.withTrust
      ? {
          usps: [{ label: "Persoonlijk meubeladvies aan huis", source: "questionnaire" }],
          stats: [{ label: "Jaar ervaring", value: "12", source: "questionnaire" }],
          badges: [],
        }
      : { usps: [], stats: [], badges: [] },
    conversionPlan: { primaryGoal: "Gratis adviesgesprek aanvragen", leadCapture: true, contactPreference: "form" },
    missingInformation: [],
  });
}

function makeBundle(opts: {
  copywriting?: boolean;
  questionnaire?: ContentSourceInput["questionnaire"];
  blueprint?: WebsiteBlueprint;
} = {}): ContentSourceBundle {
  const blueprint = opts.blueprint ?? makeBlueprint();
  const prompt = [
    "Plan het INTERNE Design Plan (JSON).",
    "Bedrijf: Bakkerij De Gouden Korst",
    "Branche: Bakkerij",
    "Plaats: Utrecht",
    "AANTAL PAGINA'S (bindend voor de paginastructuur): 3",
    "E-COMMERCE: nee",
  ].join("\n");
  const plan = designPlanSchema.parse(JSON.parse(buildMockDesignPlan(prompt)));
  plan.blueprint = blueprint;
  return assembleContentSourceBundle({
    lead: {
      businessName: "Bakkerij De Gouden Korst",
      industry: "Bakkerij",
      address: "Voorstraat 12",
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
    questionnaire: opts.questionnaire ?? null,
    requirements: { ...REQUIREMENTS, copywriting: opts.copywriting ?? true },
    designPlan: plan,
  });
}

function itemOf(bundle: ContentSourceBundle, origin: string, key: string) {
  const item = bundle.items.find((i) => i.origin === origin && i.key === key);
  assert.ok(item, `bundel-item ontbreekt: ${origin}:${key}`);
  return item;
}

type RawUnit = RawContentPlanOutput["pages"][number]["units"][number];

function rawUnit(path: string, kind: string, status: string, extra: Partial<RawUnit> = {}): RawUnit {
  return {
    path,
    kind: kind as RawUnit["kind"],
    status: status as RawUnit["status"],
    text: extra.text ?? null,
    evidence: extra.evidence ?? [],
    sourceOrigin: extra.sourceOrigin ?? null,
    instruction: extra.instruction ?? null,
  };
}

function rawPlan(pages: RawContentPlanOutput["pages"], missing: string[] = []): RawContentPlanOutput {
  return rawContentPlanOutputSchema.parse({ pages, missingInformation: missing });
}

/** Volledige, geldige AI-output voor het standaardfixture (copywriting=true). */
function validRaw(bundle: ContentSourceBundle): RawContentPlanOutput["pages"] {
  const phone = itemOf(bundle, "lead", "phone");
  const note = itemOf(bundle, "qualification", "note:0");
  const section1 = itemOf(bundle, "blueprint", "section:home/1");
  return [
    {
      key: "home",
      seo: { title: "Bakkerij De Gouden Korst — Utrecht", metaDescription: "Verse broodjes en taarten in Utrecht." },
      units: [
        rawUnit("home/0", "headline", "generated", { text: "Verse bakkerij in het hart van Utrecht", evidence: [itemOf(bundle, "lead", "businessName").text] }),
        rawUnit("home/0", "cta_label", "generated", { text: "Vraag een broodje aan", evidence: [phone.text] }),
        rawUnit("home/1", "item_title", "generated", { text: "Webdesign", evidence: [section1.text] }),
        rawUnit("home/1", "item_body", "generated", { text: "Zakelijke websites die renderen.", evidence: [note.text] }),
        rawUnit("home/2", "cta_label", "generated", { text: "Plan een gesprek", evidence: [phone.text] }),
        rawUnit("home/3", "heading", "generated", { text: "Kom langs", evidence: [note.text] }),
        rawUnit("home/3", "cta_label", "generated", { text: "Verstuur bericht", evidence: [phone.text] }),
        rawUnit("home/3", "microcopy", "generated", { text: "Wij reageren binnen één werkdag.", evidence: [note.text] }),
      ],
    },
  ];
}

/**
 * Generieke, geldige AI-output voor willekeurig blueprint: elke instantie dekt
 * al zijn verplichte slots — fact-locked als exacte bronovername (fixed),
 * commerciële copy als generated met byte-exacte evidence.
 */
function genericUnitsFor(bundle: ContentSourceBundle, blueprint: WebsiteBlueprint): RawContentPlanOutput["pages"] {
  const sources = [...bundle.items];
  let idx = 0;
  const nextText = () => sources[idx++ % sources.length].text;
  return blueprint.pages.map((page) => ({
    key: page.key,
    seo: null,
    units: page.sectionInstances.flatMap((instance, i) => {
      const path = `${page.key}/${i}`;
      return contentSlotsForSection(instance.type as never)
        .filter((slot) => slot.required)
        .map((slot) =>
          slot.factLocked
            ? rawUnit(path, slot.kind, "fixed", { text: nextText() })
            : rawUnit(path, slot.kind, "generated", { text: "Generieke commerciële copy.", evidence: [nextText()] })
        );
    }),
  }));
}

function finalize(raw: RawContentPlanOutput, bundle: ContentSourceBundle, opts: { copywriting?: boolean; blueprint?: WebsiteBlueprint } = {}) {
  return finalizeRawContentPlan({
    raw,
    blueprint: opts.blueprint ?? makeBlueprint(),
    bundle,
    copywriting: opts.copywriting ?? true,
    designPlanId: DESIGN_PLAN_ID,
  });
}

function checkC3aConsistency(result: ReturnType<typeof finalize>, bundle: ContentSourceBundle, blueprint: WebsiteBlueprint = makeBlueprint()) {
  const consistency = validateContentPlanConsistency(result.plan, blueprint, bundle);
  assert.deepEqual(consistency.errors, [], consistency.errors.join(" | "));
}

// ---------------------------------------------------------------------------
// 1. copywriting=true
// ---------------------------------------------------------------------------

test("C3b: copywriting=true — commerciële copy is generated mét evidence", () => {
  const bundle = makeBundle({ copywriting: true });
  const result = finalize(rawPlan(validRaw(bundle)), bundle, { copywriting: true });
  const units = result.plan.pages[0].units;
  const headline = units.find((u) => u.kind === "headline")!;
  assert.equal(headline.status, "generated");
  assert.equal(headline.evidence.length > 0, true);
  assert.equal(result.plan.pages[0].seo?.title, "Bakkerij De Gouden Korst — Utrecht");
  checkC3aConsistency(result, bundle);
});

// ---------------------------------------------------------------------------
// 2. copywriting=false
// ---------------------------------------------------------------------------

test("C3b: copywriting=false — commerciële copy wordt customer_slot met instructie", () => {
  const bundle = makeBundle({ copywriting: false });
  const result = finalize(rawPlan(validRaw(bundle)), bundle, { copywriting: false });
  const units = result.plan.pages[0].units;

  const headline = units.find((u) => u.kind === "headline")!;
  assert.equal(headline.status, "customer_slot");
  assert.ok(headline.instruction && headline.instruction.length >= 10);

  const body = units.find((u) => u.kind === "item_body")!;
  assert.equal(body.status, "customer_slot");

  // UI/microcopy en structurele CTA-labels blijven functioneel (generated met evidence).
  const microcopy = units.find((u) => u.kind === "microcopy")!;
  assert.equal(microcopy.status, "generated");
  const cta = units.find((u) => u.path === "home/2" && u.kind === "cta_label")!;
  assert.equal(cta.status, "generated");
  checkC3aConsistency(result, bundle);
});

test("C3b: copywriting=false — bekende feiten blijven fixed staan", () => {
  const bundle = makeBundle({ copywriting: false });
  const phone = itemOf(bundle, "lead", "phone");
  const baseUnits = validRaw(bundle)[0].units.filter((u) => u.kind !== "microcopy");
  const pages = [
    {
      key: "home",
      seo: null,
      units: [rawUnit("home/3", "microcopy", "fixed", { text: phone.text, sourceOrigin: "lead" }), ...baseUnits],
    },
  ];
  const result = finalize(rawPlan(pages), bundle, { copywriting: false });
  const fixed = result.plan.pages[0].units.find((u) => u.kind === "microcopy" && u.status === "fixed");
  assert.ok(fixed, "fact-locked fixed unit overleeft copywriting=false");
  assert.equal(fixed!.text, phone.text);
  checkC3aConsistency(result, bundle);
});

// ---------------------------------------------------------------------------
// 3. evidence ontbreekt
// ---------------------------------------------------------------------------

test("C3b: generated unit zonder evidence wordt eerlijk customer_slot", () => {
  const bundle = makeBundle();
  const pages = [
    {
      key: "home",
      seo: null,
      units: [
        rawUnit("home/0", "headline", "generated", { text: "Zomaar een kop zonder bron" }),
        ...validRaw(bundle)[0].units.filter((u) => u.kind !== "headline"),
      ],
    },
  ];
  const result = finalize(rawPlan(pages), bundle);
  const headline = result.plan.pages[0].units.find((u) => u.kind === "headline")!;
  assert.equal(headline.status, "customer_slot");
  assert.ok(headline.instruction);
  assert.ok(result.plan.missingInformation.some((m) => m.includes("geen evidence")), result.plan.missingInformation.join(" | "));
  checkC3aConsistency(result, bundle);
});

// ---------------------------------------------------------------------------
// 4. fact-locked content
// ---------------------------------------------------------------------------

test("C3b: fact-locked byte-exact uit bron wordt fixed (deterministisch)", () => {
  const bundle = makeBundle();
  const phone = itemOf(bundle, "lead", "phone");
  const baseUnits = validRaw(bundle)[0].units.filter((u) => u.kind !== "microcopy");
  const pages = [
    {
      key: "home",
      seo: null,
      units: [rawUnit("home/3", "microcopy", "fixed", { text: phone.text, sourceOrigin: "lead" }), ...baseUnits],
    },
  ];
  const result = finalize(rawPlan(pages), bundle);
  const fixed = result.plan.pages[0].units.find((u) => u.kind === "microcopy" && u.status === "fixed")!;
  assert.equal(fixed.text, phone.text);
  assert.equal(fixed.sourceOrigin, "lead");
  assert.deepEqual(fixed.evidence, []);
  checkC3aConsistency(result, bundle);
});

test("C3b: fact-locked reformulering wordt naar de exacte brontekst hersteld", () => {
  const bundle = makeBundle();
  const phone = itemOf(bundle, "lead", "phone");
  const pages = [
    {
      key: "home",
      seo: null,
      units: [
        rawUnit("home/1", "item_title", "generated", { text: "web-design!!!", evidence: [phone.text] }),
        ...validRaw(bundle)[0].units.filter((u) => !(u.path === "home/1" && u.kind === "item_title")),
      ],
    },
  ];
  const result = finalize(rawPlan(pages), bundle);
  const itemTitle = result.plan.pages[0].units.find((u) => u.kind === "item_title")!;
  assert.equal(itemTitle.text, phone.text, "reformulering is hersteld naar de verbatim brontekst");
  assert.ok(result.corrections.some((c) => c.includes("hersteld")), result.corrections.join(" | "));
  checkC3aConsistency(result, bundle);
});

// ---------------------------------------------------------------------------
// 5. fabricated claim injection
// ---------------------------------------------------------------------------

test("C3b: geinjecteerde verzonnen claim (fact-locked) laat het plan falen", () => {
  const bundle = makeBundle();
  const pages = [
    {
      key: "home",
      seo: null,
      units: [
        rawUnit("home/1", "item_title", "generated", {
          text: "Winner van 12 nationale prijzen",
          evidence: ["Winner van 12 nationale prijzen"],
        }),
        ...validRaw(bundle)[0].units.filter((u) => !(u.path === "home/1" && u.kind === "item_title")),
      ],
    },
  ];
  assert.throws(
    () => finalize(rawPlan(pages), bundle),
    (error: unknown) => {
      assert.ok(error instanceof ContentPlanFinalizeError);
      assert.ok(error.errors.some((e) => e.includes("fact-locked claim zonder geldige bron")), error.errors.join(" | "));
      return true;
    }
  );
});

test("C3b: AI mag géén secties/paden toevoegen — hallucinated path faalt hard", () => {
  const bundle = makeBundle();
  const pages = [
    {
      key: "home",
      seo: null,
      units: [
        ...validRaw(bundle)[0].units,
        rawUnit("home/99", "headline", "generated", { text: "Stiekem extra sectie", evidence: [bundle.items[0].text] }),
      ],
    },
  ];
  assert.throws(
    () => finalize(rawPlan(pages), bundle),
    (error: unknown) => {
      assert.ok(error instanceof ContentPlanFinalizeError);
      assert.ok(error.errors.some((e) => e.includes("onbestaand sectiepad")), error.errors.join(" | "));
      return true;
    }
  );
});

test("C3b: AI mag géén pagina's toevoegen", () => {
  const bundle = makeBundle();
  const pages = [...validRaw(bundle), { key: "injected-page", seo: null, units: [] }];
  assert.throws(
    () => finalize(rawPlan(pages), bundle),
    (error: unknown) => {
      assert.ok(error instanceof ContentPlanFinalizeError);
      assert.ok(error.errors.some((e) => e.includes("onbekende pagina")), error.errors.join(" | "));
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// 6. meerdere instanties van hetzelfde sectietype
// ---------------------------------------------------------------------------

test("C3b: meerdere instanties van hetzelfde sectietype blijven gescheiden paths", () => {
  const blueprint = makeBlueprint({ withSecondServices: true });
  const bundle = makeBundle({ blueprint });
  const pages = genericUnitsFor(bundle, blueprint);
  const result = finalize(rawPlan(pages), bundle, { blueprint });

  const titles = result.plan.pages[0].units.filter((u) => u.kind === "item_title");
  assert.equal(titles.length, 2, "beide services-instanties hebben hun eigen item_title");
  assert.deepEqual(titles.map((u) => u.path).sort(), ["home/1", "home/2"]);
  // fact-locked titels zijn verbatim uit een bron (fixed) of generated met
  // byte-exacte evidence — nooit verzonden zonder grondslag.
  assert.ok(
    titles.every(
      (u) =>
        (u.status === "fixed" && bundle.items.some((i) => i.text === u.text)) ||
        (u.status === "generated" && u.evidence.length > 0)
    ),
    "elke dienstitel is bron-gegrond"
  );
  checkC3aConsistency(result, bundle, blueprint);
});

// ---------------------------------------------------------------------------
// 7. questionnaire beide rondes
// ---------------------------------------------------------------------------

test("C3b: questionnaire-antwoorden uit beide rondes gronden de evidence", () => {
  const bundle = makeBundle({
    questionnaire: {
      questions: [{ id: "q-aanbod", label: "Wat biedt u aan?", type: "textarea", required: true }],
      followUpQuestions: [{ id: "fu-usp", label: "Wat maakt u uniek?", type: "textarea", required: true }],
      responses: [
        { round: 1, answers: { "q-aanbod": "Webdesign" } },
        { round: 2, answers: { "fu-usp": "Persoonlijk meubeladvies aan huis" } },
      ],
    },
  });
  const roundTwo = itemOf(bundle, "questionnaire", "fu-usp");
  assert.ok(roundTwo, "ronde-2-antwoord is in de bundel aangekomen");
  assert.ok(roundTwo.text.includes("Persoonlijk meubeladvies"));

  const pages = [
    {
      key: "home",
      seo: null,
      units: [
        rawUnit("home/0", "headline", "generated", { text: "Persoonlijk advies aan huis", evidence: [roundTwo.text] }),
        ...validRaw(bundle)[0].units.filter((u) => u.kind !== "headline"),
      ],
    },
  ];
  const result = finalize(rawPlan(pages), bundle);
  const headline = result.plan.pages[0].units.find((u) => u.kind === "headline")!;
  assert.equal(headline.status, "generated");
  assert.deepEqual(headline.evidence, [roundTwo.text]);
  checkC3aConsistency(result, bundle);
});

// ---------------------------------------------------------------------------
// 8. trustedClaims
// ---------------------------------------------------------------------------

test("C3b: fact-locked via trustedClaims (questionnaire) grondt ook via substring", () => {
  const bundle = makeBundle({
    questionnaire: {
      questions: [{ id: "q-aanbod", label: "Wat biedt u aan?", type: "textarea", required: true }],
      followUpQuestions: [],
      responses: [{ round: 1, answers: { "q-aanbod": "Webdesign en logo-vernieuwing" } }],
    },
  });
  const pages = [
    {
      key: "home",
      seo: null,
      units: [
        rawUnit("home/1", "item_title", "generated", {
          text: "Webdesign en logo-vernieuwing",
          evidence: [itemOf(bundle, "questionnaire", "q-aanbod").text],
        }),
        ...validRaw(bundle)[0].units.filter((u) => !(u.path === "home/1" && u.kind === "item_title")),
      ],
    },
  ];
  const result = finalize(rawPlan(pages), bundle);
  const itemTitle = result.plan.pages[0].units.find((u) => u.kind === "item_title")!;
  assert.equal(itemTitle.status, "generated");
  assert.ok(bundle.trustedClaims.includes(itemTitle.evidence[0]));
  checkC3aConsistency(result, bundle);
});

test("C3b: evidence_only coverage wordt deterministisch uit geregistreerde trust-data gevuld", () => {
  const blueprint = makeBlueprint({ withTrust: true });
  const bundle = makeBundle({ blueprint });
  // AI dekt de usp_band-instantie (home/2) NIET — de finalizer vult uit trustElements.
  const pages = genericUnitsFor(bundle, blueprint).map((page) => ({
    ...page,
    units: page.units.filter((u) => !u.path.startsWith("home/2")),
  }));
  const result = finalize(rawPlan(pages), bundle, { blueprint });

  const uspUnits = result.plan.pages[0].units.filter((u) => u.path.startsWith("home/2"));
  assert.equal(uspUnits.length > 0, true, "usp_band is coverage-gevuld");
  const label = uspUnits.find((u) => u.kind === "item_label")!;
  assert.equal(label.text, "Persoonlijk meubeladvies aan huis");
  assert.equal(label.status, "generated");
  assert.equal(label.evidence.length > 0, true);
  checkC3aConsistency(result, bundle, blueprint);
});

// ---------------------------------------------------------------------------
// 9. versioning / stale fingerprint
// ---------------------------------------------------------------------------

function contentPlanRecord(overrides: Partial<ContentPlanRecord> = {}): ContentPlanRecord {
  return {
    id: "cp-1",
    projectId: "p-1",
    leadId: "l-1",
    designPlanId: DESIGN_PLAN_ID,
    version: 1,
    status: "completed",
    mode: "mock",
    model: "model",
    sourceFingerprint: "abc",
    plan: null,
    missingInformation: [],
    validationErrors: [],
    generationNotes: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("C3b: stale-detectie — gelijke fingerprint is actueel, nieuwe is stale", () => {
  const completed = contentPlanRecord({ sourceFingerprint: "abc" });
  assert.equal(isContentStale(completed, "abc"), false, "zelfde fingerprint = actueel");
  assert.equal(isContentStale(completed, "def"), true, "andere fingerprint = her-generatie nodig");
  assert.equal(isContentStale(undefined, "abc"), true, "geen eerder plan = genereren");
  assert.equal(
    isContentStale(contentPlanRecord({ status: "failed", sourceFingerprint: "abc" }), "abc"),
    true,
    "failed plan = her-genereren"
  );
});

test("C3b: versienummering per design plan", () => {
  assert.equal(nextContentPlanVersion([]), 1);
  assert.equal(nextContentPlanVersion([1, 2, 4]), 5);
});

test("C3b: de fingerprint verandert zodra broninformatie verandert (re-generatie-trigger)", () => {
  const base = makeBundle();
  const changed = makeBundle({
    questionnaire: {
      questions: [{ id: "q-aanbod", label: "Wat biedt u aan?", type: "textarea", required: true }],
      followUpQuestions: [],
      responses: [{ round: 1, answers: { "q-aanbod": "Helemaal ander aanbod" } }],
    },
  });
  assert.notEqual(base.fingerprint, changed.fingerprint);
});

// ---------------------------------------------------------------------------
// 10. bestaande v1/v2 compatibility
// ---------------------------------------------------------------------------

test("C3b: v1-designplan zonder blueprint wordt geweigerd (heldere reden)", () => {
  const prompt = [
    "Plan het INTERNE Design Plan (JSON).",
    "Bedrijf: Bakkerij De Gouden Korst",
    "Branche: Bakkerij",
    "Plaats: Utrecht",
    "AANTAL PAGINA'S (bindend voor de paginastructuur): 3",
    "E-COMMERCE: nee",
  ].join("\n");
  const plan = designPlanSchema.parse(JSON.parse(buildMockDesignPlan(prompt)));
  plan.blueprint = null;
  const record = {
    id: "dp-1",
    projectId: "p-1",
    leadId: "l-1",
    version: 1,
    status: "completed",
    plan,
    missingInformation: [],
    validationErrors: [],
    model: "model",
    mode: "mock",
    generationNotes: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } satisfies DesignPlanRecord;
  assert.throws(() => requireBlueprint(record), ContentPlanError);
});

test("C3b: v2-designplan mét blueprint blijft exact geldig onder de bestaande schema's", () => {
  const plan = designPlanSchema.parse(JSON.parse(buildMockDesignPlan("Bedrijf: X\nBranche: Y\nPlaats: Z")));
  plan.blueprint = makeBlueprint();
  assert.equal(designPlanSchema.safeParse(plan).success, true);
  const blueprint = requireBlueprint({
    id: "dp-2",
    projectId: "p-1",
    leadId: "l-1",
    version: 2,
    status: "completed",
    plan,
    missingInformation: [],
    validationErrors: [],
    model: "model",
    mode: "mock",
    generationNotes: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } satisfies DesignPlanRecord);
  assert.equal(blueprint.version, 2);
});

// ---------------------------------------------------------------------------
// Prompt- en mock-contract
// ---------------------------------------------------------------------------

test("C3b: prompt bevat het bindende pad-contract, bronnen en copywriting-vlag", () => {
  const blueprint = makeBlueprint({ withTrust: true });
  const bundle = makeBundle({ blueprint, copywriting: false });
  const prompt = buildContentPlanPrompt({
    businessName: "Bakkerij De Gouden Korst",
    copywriting: false,
    bundle,
    blueprint,
  });
  assert.ok(prompt.includes("COPYWRITING: NEE"), "copywriting-vlag staat in de prompt");
  assert.ok(prompt.includes("BRON [lead:businessName] Bakkerij De Gouden Korst"), "bronnen zijn machine-leesbaar aanwezig");
  assert.ok(prompt.includes("SECTIE home/0 hero"), "sectiepaden zijn bindend aanwezig");
  assert.ok(prompt.includes("SECTIE home/2 usp_band"), "trust-secties staan in het contract");
  assert.ok(prompt.includes("fact-locked: item_title"), "fact-locked markering staat in het contract");
  assert.ok(prompt.includes("Output: uitsluitend een JSON-object"), "JSON-contract staat in de prompt");
});

test("C3b: mock-provider vult coverage-compleet en schema-geldig binnen het pad-contract", () => {
  const blueprint = makeBlueprint({ withTrust: true });
  const bundle = makeBundle({ blueprint });
  const prompt = buildContentPlanPrompt({
    businessName: "Bakkerij De Gouden Korst",
    copywriting: true,
    bundle,
    blueprint,
  });
  const raw = rawContentPlanOutputSchema.parse(JSON.parse(buildMockContentPlan(prompt)));
  const result = finalizeRawContentPlan({ raw, blueprint, bundle, copywriting: true, designPlanId: DESIGN_PLAN_ID });
  checkC3aConsistency(result, bundle, blueprint);
  // Elke sectie-instantie heeft al zijn verplichte slots gedekt.
  for (const page of blueprint.pages) {
    for (let i = 0; i < page.sectionInstances.length; i++) {
      const units = result.plan.pages[0].units.filter((u) => u.path === `${page.key}/${i}`);
      assert.ok(units.length > 0, `sectie ${page.key}/${i} is gedekt`);
    }
  }
});

test("C3b: CTA-label coverage valt terug op het echte conversiedoel", () => {
  const bundle = makeBundle();
  const pages = [
    {
      key: "home",
      seo: null,
      units: validRaw(bundle)[0].units.filter((u) => !(u.path === "home/2" && u.kind === "cta_label")),
    },
  ];
  const result = finalize(rawPlan(pages), bundle);
  const cta = result.plan.pages[0].units.find((u) => u.path === "home/2" && u.kind === "cta_label")!;
  assert.equal(cta.status, "fixed");
  assert.equal(cta.text, "Gratis adviesgesprek aanvragen");
  assert.equal(cta.sourceOrigin, "blueprint");
  checkC3aConsistency(result, bundle);
});


// ------------------------------------------------------------------
// LIVE-LES 2026-09-20 (fixture E2E, content_plans v1-v3): zonder expliciete
// reasoning-cap besteedde sonnet-5 de VOLLEDIGE max_tokens (zowel 10000 als
// 20000) aan adaptive thinking — max_tokens bereikt vóór enige JSON, op
// elke retry. Deze source-contract-tests bewaken de effort-cap op de
// contentcall en de provider-afspraken (output_config.effort, géén
// temperature samen met effort).
// ------------------------------------------------------------------

test("budget-guardian: contentcall heeft een expliciete reasoning-cap (effort low) en géén temperature", () => {
  const serviceSource = readFileSync(new URL("../lib/ai/service.ts", import.meta.url), "utf-8");
  const start = serviceSource.indexOf("async generateContentPlan");
  const end = serviceSource.indexOf("rawContentPlanOutputSchema", start);
  assert.ok(start !== -1 && end > start, "generateContentPlan moet in service.ts staan");
  const block = serviceSource.slice(start, end);
  assert.match(block, /maxTokens: 20000/, "budget blijft 20000 (onder de SDK-grens 21333)");
  assert.match(block, /thinkingEffort: "low"/, "reasoning-cap effort low: zonder cap eet sonnet-5 het volledige budget aan adaptive thinking (live-incident v1-v3)");
  assert.doesNotMatch(block, /temperature:/, "géén temperature in de contentcall (deprecated zodra effort gezet is; de service laat hem weg)");
});

test("budget-guardian: thinkingEffort passeert naar de provider en onderdrukt temperature", () => {
  const serviceSource = readFileSync(new URL("../lib/ai/service.ts", import.meta.url), "utf-8");
  const start = serviceSource.indexOf("const providerResult = await this.provider.generateText");
  const block = serviceSource.slice(start, serviceSource.indexOf("});", start));
  assert.match(block, /thinkingEffort: call.thinkingEffort/, "thinkingEffort passeert 1-op-1 naar de provider");
  assert.match(
    block,
    /call.thinkingEffort !== undefined \? undefined : \(call.temperature \?\? 0\.4\)/,
    "bij een reasoning-cap wordt géén temperature verstuurd; andere calls houden hun bestaande 0.4-default"
  );
});

test("budget-guardian: provider zet output_config.effort bij een reasoning-cap", () => {
  const anthropicSource = readFileSync(new URL("../lib/ai/anthropic.ts", import.meta.url), "utf-8");
  const start = anthropicSource.indexOf("request.thinkingEffort !== undefined");
  assert.ok(start !== -1, "anthropic.ts moet thinkingEffort afhandelen");
  const block = anthropicSource.slice(start, start + 400);
  assert.match(block, /output_config/, "reasoning-cap loopt via output_config.effort (API-voorschrift: thinking.type enabled + budget_tokens wordt afgewezen voor dit model)");
  assert.match(block, /effort: request\.thinkingEffort/, "effort-waarde passeert onveranderd");
});


// ------------------------------------------------------------------
// LIVE-LES 2026-09-20 (fixture E2E, content_plans v4): de AI volgde de
// "geen bron -> customer_slot"-regel óók op een evidence_only-sectie
// (usp_band home/2, kind item_hint). Eerlijke reparatie: phantom-slot
// verwijderen met correctielog i.p.v. hard faal; verplichte echte data
// vult de trust-fill aan. De prompt krijgt de expliciete uitzondering.
// ------------------------------------------------------------------

test("C3b: customer_slot op evidence_only-sectie wordt eerlijk verwijderd i.p.v. hard faal", () => {
  const blueprint = makeBlueprint({ withTrust: true });
  const bundle = makeBundle({ blueprint });
  // AI dekt usp_band grotendeels NIET zelf, maar zet WEL een phantom-klantslot.
  const pages = genericUnitsFor(bundle, blueprint).map((page) => ({
    ...page,
    units: page.units.filter((u) => !u.path.startsWith("home/2")),
  }));
  pages[0].units.push(rawUnit("home/2", "item_hint", "customer_slot", { instruction: "Lever zelf een korte USP-toelichting aan." }));
  const result = finalize(rawPlan(pages), bundle, { blueprint });

  const phantom = result.plan.pages[0].units.find((u) => u.path === "home/2" && u.kind === "item_hint" && u.status === "customer_slot");
  assert.equal(phantom, undefined, "phantom-klantslot staat niet meer in het plan");
  assert.ok(
    result.corrections.some((c) => c.includes("customer_slot op evidence_only-sectie") && c.includes("home/2")),
    "de verwijdering staat als correctie gelogd"
  );
  // Verplichte echte data is alsnog deterministisch trust-gevuld.
  const label = result.plan.pages[0].units.find((u) => u.path === "home/2" && u.kind === "item_label");
  assert.equal(label?.status, "generated");
  checkC3aConsistency(result, bundle, blueprint);
});

test("C3b: merchant_slot op evidence_only-sectie wordt eerlijk verwijderd i.p.v. hard faal", () => {
  const blueprint = makeBlueprint({ withTrust: true });
  const bundle = makeBundle({ blueprint });
  const pages = genericUnitsFor(bundle, blueprint).map((page) => ({
    ...page,
    units: page.units.filter((u) => !u.path.startsWith("home/2")),
  }));
  pages[0].units.push(rawUnit("home/2", "item_hint", "merchant_slot", {}));
  const result = finalize(rawPlan(pages), bundle, { blueprint });

  const phantom = result.plan.pages[0].units.find((u) => u.path === "home/2" && u.kind === "item_hint" && u.status === "merchant_slot");
  assert.equal(phantom, undefined, "phantom-merchantslot staat niet meer in het plan");
  // item_hint is geen beeldslot: de niet-beeldslot-guard haalt hem eerder weg
  // dan de evidence_only-guard — beide verwijderingen zijn eerlijk gelogd.
  assert.ok(
    result.corrections.some((c) => c.includes("merchant_slot") && c.includes("home/2") && c.includes("verwijderd")),
    "de verwijdering staat als correctie gelogd"
  );
  checkC3aConsistency(result, bundle, blueprint);
});

test("C3b: systeemprompt verbiedt customer/merchant_slot expliciet op evidence_only-secties", () => {
  const system = CONTENT_GENERATION_SYSTEM;
  assert.match(system, /UITZONDERING evidence_only-secties[\s\S]*VERBODEN/, "de uitzondering op de geen-bron-regel staat expliciet in het contract");
  assert.match(system, /laat de unit weg en vermeld het in missingInformation/, "het eerlijke alternatief staat erbij");
});


// ------------------------------------------------------------------
// LIVE-LES 2026-09-20 (fixture E2E, STAP-2-run): de AI zendt soms
// evidence: null i.p.v. [] — het raw-schema verwierp toen het HELE plan
// hard (21 units invalid). Nullish -> [] is veilig: de finalizer dwingt
// de echte evidence-regels (generated vereist evidence; slots krijgen [])
// daarna alsnog af.
// ------------------------------------------------------------------

test("C3b: raw evidence: null wordt genormaliseerd naar [] en faalt niet hard", () => {
  const bundle = makeBundle({});
  const pages = validRaw(bundle);
  // Simuleer de live-AI-afwijking: null i.p.v. lege array.
  const withNulls = pages.map((page) => ({
    ...page,
    units: page.units.map((u) => ({ ...u, evidence: null as unknown as string[] })),
  }));
  const parsed = rawContentPlanOutputSchema.safeParse(rawPlan(withNulls));
  assert.equal(parsed.success, true, "null-evidence genormaliseerd naar [] i.p.v. hard schema-faal");
  if (parsed.success) {
    assert.ok(
      parsed.data.pages.every((p) => p.units.every((u) => Array.isArray(u.evidence))),
      "elke unit heeft nu een echte array"
    );
  }
});

test("C3b: generated units zonder evidence vallen daarna nog steeds door de finalizer", () => {
  const bundle = makeBundle({});
  const pages = validRaw(bundle).map((page) => ({
    ...page,
    units: page.units.map((u) =>
      u.status === "generated" ? { ...u, evidence: null as unknown as string[] } : u
    ),
  }));
  // Null-normalisatie mag géén fabricatiedeur openen: zonder echte evidence
  // faalt de finalizer (of repareert eerlijk) — nooit een evidence-loze
  // generated unit in het eindplan.
  const result = finalize(rawPlan(pages), bundle);
  const bare = result.plan.pages.flatMap((p) => p.units).find((u) => u.status === "generated" && u.evidence.length === 0);
  assert.equal(bare, undefined, "geen generated unit zonder evidence in het eindplan");
});
