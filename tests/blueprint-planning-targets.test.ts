import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BLUEPRINT_SECTION_REGISTRY,
  BLUEPRINT_SECTION_TYPES,
  BLUEPRINT_PLANNING_TIERS,
  assertBlueprintRegistryInvariants,
  buildBlueprintSectionContract,
  getBlueprintPlanningTarget,
  blueprintSectionTypesByTier,
} from "@/lib/websites/blueprint/section-registry";
import {
  BLUEPRINT_ARCHETYPES,
  BLUEPRINT_ARCHETYPE_REGISTRY,
  selectBlueprintArchetype,
  buildArchetypeGuidance,
} from "@/lib/websites/blueprint/archetypes";
import { validateBlueprintConsistency, websiteBlueprintSchema, type WebsiteBlueprint } from "@/lib/websites/blueprint/blueprint";
import { designPlanSchema } from "@/lib/websites/design-plan";
import { buildMockDesignPlan } from "../lib/ai/mock-provider";
import { buildDesignPlanPrompt, DESIGN_PLANNING_SYSTEM } from "@/lib/ai/service";
import type { ProjectRequirements } from "@/lib/projects/types";

const requirements = (pages: number | null): ProjectRequirements => ({ numberOfPages: pages });

const mockPrompt = (pages: number): string =>
  buildDesignPlanPrompt({
    businessName: "Testbedrijf B.V.",
    industry: "Schilderbedrijf",
    city: "Apeldoorn",
    province: null,
    existingWebsite: false,
    googleRating: null,
    reviewCount: null,
    specialRequirements: null,
    leadNotes: [],
    requirementsSummary: "Website type: business_website",
    numberOfPages: pages,
    ecommerce: false,
    suggestedTemplate: "business_standard",
    questionnaireSummary: [],
    hasCompletedQuestionnaire: false,
  });

/** Minimaal geldig blueprint (homepage met hero/services/contact — géén trust-gebonden secties). */
function minimalBlueprint(): Record<string, unknown> {
  return {
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
    ],
    trustElements: { usps: [], stats: [], badges: [] },
    conversionPlan: { primaryGoal: null, leadCapture: null, contactPreference: null },
    missingInformation: [],
  };
}

// ---------------------------------------------------------------------------
// 1. Planning targets in de SECTION-REGISTRY
// ---------------------------------------------------------------------------

test("planning targets: elk sectietype heeft een deterministisch planningTarget", () => {
  assert.doesNotThrow(() => assertBlueprintRegistryInvariants());
  for (const type of BLUEPRINT_SECTION_TYPES) {
    const pt = getBlueprintPlanningTarget(type);
    assert.ok(BLUEPRINT_PLANNING_TIERS.includes(pt.tier), `${type}: onbekende tier "${pt.tier}"`);
    assert.ok(pt.minimalTrustedInput.length > 10, `${type}: minimale input moet beschreven zijn`);
    if (pt.plannableWithEmptySlots) {
      assert.ok(pt.emptySlotShape, `${type}: emptySlotShape verplicht bij leeg-slot-planbaar`);
    } else {
      assert.equal(pt.emptySlotShape, null, `${type}: géén emptySlotShape bij niet-planbaar`);
    }
  }
});

test("planning targets: tier-toewijzing per sectietype is zoals ontworpen", () => {
  const expected: Record<string, string> = {
    hero: "core",
    services: "core",
    cta: "core",
    contact: "core",
    about: "recommended",
    process: "recommended",
    benefits: "recommended",
    gallery: "optional",
    faq: "optional",
    newsletter: "optional",
    booking: "optional",
    rich_text: "optional",
    usp_band: "evidence_only",
    stats: "evidence_only",
    testimonials: "evidence_only",
    team: "evidence_only",
    rates: "evidence_only",
    projects: "evidence_only",
  };
  for (const [type, tier] of Object.entries(expected)) {
    assert.equal(
      getBlueprintPlanningTarget(type as (typeof BLUEPRINT_SECTION_TYPES)[number]).tier,
      tier,
      `${type}: tier "${tier}" verwacht`
    );
  }
  assert.deepEqual(new Set(blueprintSectionTypesByTier("evidence_only")), new Set(["usp_band", "stats", "testimonials", "team", "rates", "projects"]));
});

test("planning targets: evidence_only is nóóit leeg-slot-planbaar (anti-fabricatie)", () => {
  for (const type of blueprintSectionTypesByTier("evidence_only")) {
    assert.equal(
      getBlueprintPlanningTarget(type).plannableWithEmptySlots,
      false,
      `${type}: evidence_only mag nooit met lege slots gepland worden`
    );
  }
  // Kernsecties mogen als ontwerpstructuur met lege slots bestaan.
  for (const type of ["hero", "services", "about", "process", "gallery", "benefits", "faq", "booking", "cta", "contact"]) {
    assert.equal(
      getBlueprintPlanningTarget(type as (typeof BLUEPRINT_SECTION_TYPES)[number]).plannableWithEmptySlots,
      true,
      `${type}: kern/aanbevolen sectie moet leeg-slot-planbaar zijn`
    );
  }
});

test("planning targets: het AI-contract vermeldt tier, leeg-slot-beleid en minimale input", () => {
  const contract = buildBlueprintSectionContract();
  for (const type of BLUEPRINT_SECTION_TYPES) {
    const def = BLUEPRINT_SECTION_REGISTRY[type];
    assert.ok(contract.includes(`- ${type} (${def.label}) [${def.planningTarget.tier}`), `${type} mist tier in contract`);
    assert.ok(
      contract.includes(def.planningTarget.minimalTrustedInput),
      `${type}: minimale input niet in contract`
    );
  }
  assert.ok(contract.includes("ALLEEN met echte data (evidence_only)"));
  assert.ok(contract.includes("mag met lege slots als de input ontbreekt"));
  assert.ok(contract.includes("NIET plannen als de input ontbreekt"));
});

test("planning targets: registry-invariants wijzen inconsistency af", () => {
  // Simuleer een corrupte registry-entry en bewijs dat de invariants-assertie faalt.
  const original = BLUEPRINT_SECTION_REGISTRY.stats.planningTarget;
  try {
    (BLUEPRINT_SECTION_REGISTRY.stats as { planningTarget: unknown }).planningTarget = {
      ...original,
      plannableWithEmptySlots: true,
    };
    assert.throws(() => assertBlueprintRegistryInvariants(), /evidence_only-sectie/);
  } finally {
    BLUEPRINT_SECTION_REGISTRY.stats.planningTarget = original;
    assert.doesNotThrow(() => assertBlueprintRegistryInvariants());
  }
});

// ---------------------------------------------------------------------------
// 2. Branche-archetypen
// ---------------------------------------------------------------------------

test("archetypen: deterministische selectie op branche-keywords", () => {
  assert.equal(selectBlueprintArchetype("Loodgieter- en installatiebedrijf").key, "service_provider");
  assert.equal(selectBlueprintArchetype("Interieurarchitect studio").key, "creative_studio");
  assert.equal(selectBlueprintArchetype("Fysiotherapiepraktijk").key, "practice_appointment");
  assert.equal(selectBlueprintArchetype("Ambachtelijke bakkerij").key, "retail_product");
  // Hoofdlettergevoeligheid en witruimte mogen niet uitmaken.
  assert.equal(selectBlueprintArchetype("  SALON VOOR NAGELS ").key, "practice_appointment");
});

test("archetypen: onbekende of lege branche valt terug op dienstverlener", () => {
  assert.equal(selectBlueprintArchetype("Onbekende futurologische branche xyzzy").key, "service_provider");
  assert.equal(selectBlueprintArchetype("").key, "service_provider");
});

test("archetypen: elke definitie is registry-conform en bevat alleen compositierichting", () => {
  for (const key of BLUEPRINT_ARCHETYPES) {
    const def = BLUEPRINT_ARCHETYPE_REGISTRY[key];
    assert.equal(def.key, key);
    assert.ok(def.homepageFlow.length >= 5, `${key}: compositierichting moet inhoudelijk zijn`);
    for (const type of def.homepageFlow) {
      assert.ok(
        (BLUEPRINT_SECTION_TYPES as readonly string[]).includes(type),
        `${key}: homepageFlow bevat niet-registry sectietype "${type}"`
      );
    }
    for (const type of def.strengths) {
      assert.ok(
        (BLUEPRINT_SECTION_TYPES as readonly string[]).includes(type),
        `${key}: strengths bevat niet-registry sectietype "${type}"`
      );
    }
    // De flow begint met hero (compositie-vloer) en bevat een conversiesectie.
    assert.equal(def.homepageFlow[0], "hero");
    assert.ok(
      def.homepageFlow.includes("contact") || def.homepageFlow.includes("booking") || def.homepageFlow.includes("cta"),
      `${key}: compositierichting moet een conversiesectie bevatten`
    );
    assert.ok(["form", "call", "booking"].includes(def.conversionPreference));
  }
});

test("archetypen: guidance is expliciet richting en herhaalt de anti-fabricatieregels", () => {
  const guidance = buildArchetypeGuidance(BLUEPRINT_ARCHETYPE_REGISTRY.service_provider);
  assert.ok(guidance.some((l) => l.startsWith("BRANCHE-ARCHETYPE (deterministisch bepaald)")));
  assert.ok(guidance.some((l) => l.includes("RICHTING, geen verplichting")));
  assert.ok(guidance.some((l) => l.includes("geen verzonnen bedrijfsfeiten")));
  assert.ok(guidance.some((l) => l.includes("Evidence_only-secties") && l.includes("ALTIJD echte data")));
  assert.ok(guidance.some((l) => l.includes("plannableWithEmptySlots=true")));
});

test("archetypen: designplanning-prompt bevat de archetype-richting en de planning-target-regels", () => {
  const prompt = buildDesignPlanPrompt({
    businessName: "Testbedrijf",
    industry: "Fysiotherapiepraktijk",
    city: "Zwolle",
    province: null,
    existingWebsite: false,
    googleRating: null,
    reviewCount: null,
    specialRequirements: null,
    leadNotes: [],
    requirementsSummary: "Website type: business_website",
    numberOfPages: 3,
    ecommerce: false,
    suggestedTemplate: "business_standard",
    questionnaireSummary: [],
    hasCompletedQuestionnaire: false,
  });
  assert.ok(prompt.includes("BRANCHE-ARCHETYPE (deterministisch bepaald): practice_appointment — Praktijk/afspraak"));
  assert.ok(prompt.includes("RICHTING, geen verplichting"));
  assert.ok(prompt.includes("plannableWithEmptySlots=true"));
  assert.ok(prompt.includes("evidence_only"));
  // De planning-target-regels staan in het SYSTEM-prompt van de designplanning-agent.
  assert.ok(DESIGN_PLANNING_SYSTEM.includes("POSITIEVE COMPOSITIEDOELEN"));
  assert.ok(DESIGN_PLANNING_SYSTEM.includes("DETERMINISTISCH afgedwongen"));
  // De kwarts-winkel: dezelfde branche levert elke keer hetzelfde archetype op.
  const second = buildDesignPlanPrompt({
    businessName: "Testbedrijf",
    industry: "Fysiotherapiepraktijk",
    city: "Zwolle",
    province: null,
    existingWebsite: false,
    googleRating: null,
    reviewCount: null,
    specialRequirements: null,
    leadNotes: [],
    requirementsSummary: "Website type: business_website",
    numberOfPages: 3,
    ecommerce: false,
    suggestedTemplate: "business_standard",
    questionnaireSummary: [],
    hasCompletedQuestionnaire: false,
  });
  assert.equal(prompt, second);
});

// ---------------------------------------------------------------------------
// 3. Anti-fabricatie (consistency + targets samen)
// ---------------------------------------------------------------------------

test("anti-fabricatie: usp_band zonder geregistreerde echte USP's faalt de consistency", () => {
  const bp = minimalBlueprint() as WebsiteBlueprint & Record<string, unknown>;
  bp.pages[0].sectionInstances.splice(1, 0, {
    type: "usp_band",
    layout: "row",
    blocks: [
      { kind: "usp", hint: "USP A" },
      { kind: "usp", hint: "USP B" },
    ],
    media: [],
    cta: null,
    background: "default",
    motion: "none",
    contentHints: null,
  });
  const parsed = websiteBlueprintSchema.parse(bp);
  const result = validateBlueprintConsistency(parsed, requirements(1));
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes("trustElements.usps is leeg")), result.errors.join("; "));
});

test("anti-fabricatie: stats zonder geregistreerde echte cijfers faalt de consistency", () => {
  const bp = minimalBlueprint() as WebsiteBlueprint & Record<string, unknown>;
  bp.pages[0].sectionInstances.splice(1, 0, {
    type: "stats",
    layout: "row",
    blocks: [
      { kind: "stat", hint: "Stat A" },
      { kind: "stat", hint: "Stat B" },
    ],
    media: [],
    cta: null,
    background: "default",
    motion: "none",
    contentHints: null,
  });
  const parsed = websiteBlueprintSchema.parse(bp);
  const result = validateBlueprintConsistency(parsed, requirements(1));
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes("trustElements.stats is leeg")), result.errors.join("; "));
});

test("anti-fabricatie: usp_band mét geregistreerde echte USP's slaagt", () => {
  const bp = minimalBlueprint() as WebsiteBlueprint & Record<string, unknown>;
  bp.pages[0].sectionInstances.splice(1, 0, {
    type: "usp_band",
    layout: "row",
    blocks: [
      { kind: "usp", hint: "USP A" },
      { kind: "usp", hint: "USP B" },
    ],
    media: [],
    cta: null,
    background: "default",
    motion: "none",
    contentHints: null,
  });
  bp.trustElements = {
    usps: [
      { label: "24/7 bereikbaar", source: "requirements" },
      { label: "Gratis offerte", source: "lead_notes" },
    ],
    stats: [],
    badges: [],
  };
  const parsed = websiteBlueprintSchema.parse(bp);
  const result = validateBlueprintConsistency(parsed, requirements(1));
  assert.equal(result.passed, true, result.errors.join("; "));
});

test("anti-fabricatie: lege-slot-planbare kernsecties veroorzaken géén consistency-fout", () => {
  // services met hint=null: expliciet lege, merchant-editable slots — toegestaan
  // als ontwerpstructuur, mits de ontbrekende informatie geregistreerd is.
  const bp = minimalBlueprint() as WebsiteBlueprint & Record<string, unknown>;
  bp.pages[0].sectionInstances[1].blocks = [
    { kind: "service", hint: null },
    { kind: "service", hint: null },
  ];
  bp.missingInformation = ["Echte dienstnamen ontbreken — dienstslots zijn merchant-editable gelaten."];
  const parsed = websiteBlueprintSchema.parse(bp);
  const result = validateBlueprintConsistency(parsed, requirements(1));
  assert.equal(result.passed, true, result.errors.join("; "));
});

// ---------------------------------------------------------------------------
// 4. Bestaande v1/v2-compatibiliteit
// ---------------------------------------------------------------------------

test("compatibiliteit: v1 Design Plan zonder blueprint blijft geldig", () => {
  const plan = JSON.parse(buildMockDesignPlan(mockPrompt(1)));
  delete (plan as Record<string, unknown>).blueprint;
  const parsed = designPlanSchema.safeParse(plan);
  assert.ok(parsed.success, JSON.stringify(parsed.success ? "" : parsed.error.issues.slice(0, 3)));
});

test("compatibiliteit: v2 blueprint zonder planningTarget-veld op de instanties blijft geldig", () => {
  // planningTarget is een registry-begrip, géén schema-veld: bestaande
  // blueprint-records (v8/v9/v10) hebben het niet en moeten ongewijzigd blijven.
  const parsed = websiteBlueprintSchema.parse(minimalBlueprint());
  const result = validateBlueprintConsistency(parsed, requirements(1));
  assert.equal(result.passed, true, result.errors.join("; "));
});

test("compatibiliteit: mock-designplan met blueprint slaagt de bestaande consistency", () => {
  const plan = designPlanSchema.parse(JSON.parse(buildMockDesignPlan(mockPrompt(3))));
  assert.ok(plan.blueprint, "mock moet een blueprint leveren");
  const parsed = websiteBlueprintSchema.parse(plan.blueprint);
  const result = validateBlueprintConsistency(parsed, requirements(3));
  assert.equal(result.passed, true, result.errors.join("; "));
});

// ---------------------------------------------------------------------------
// 5. Bestaande blueprint-consistency blijft leidend
// ---------------------------------------------------------------------------

test("consistency: compositie-vloer geldt onverminderd (hero eerst, conversie op homepage)", () => {
  const bp = minimalBlueprint() as WebsiteBlueprint & Record<string, unknown>;
  bp.pages[0].sectionInstances.shift(); // hero weg
  const parsed = websiteBlueprintSchema.parse(bp);
  const result = validateBlueprintConsistency(parsed, requirements(1));
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes("moet met een hero-sectie beginnen")), result.errors.join("; "));
});
