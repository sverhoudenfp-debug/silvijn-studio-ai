import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateConversionStructure,
  validateBlueprintConsistency,
  websiteBlueprintSchema,
  type WebsiteBlueprint,
  type BlueprintSectionInstance,
} from "@/lib/websites/blueprint/blueprint";
import { designPlanSchema } from "@/lib/websites/design-plan";
import { buildMockDesignPlan } from "../lib/ai/mock-provider";
import { buildDesignPlanPrompt } from "@/lib/ai/service";
import type { ProjectRequirements } from "@/lib/projects/types";

// ---------------------------------------------------------------------------
// Fase A3 — deterministische conversieketen-check (attention/interest/trust/action)
// ---------------------------------------------------------------------------

const requirements = (pages: number | null): ProjectRequirements => ({ numberOfPages: pages });

const DISCLOSURE = "Geen echte USP's, cijfers of reviews aangeleverd — trust-secties niet gepland.";

/** Sectie-instantie volgens registry-contract (Zod-geldige layouts/blokken). */
function inst(
  type: string,
  layout: string,
  blocks: Array<{ kind: string; hint: string | null }> = [],
  cta: BlueprintSectionInstance["cta"] = null
): Record<string, unknown> {
  return {
    type,
    layout,
    blocks,
    media: [],
    cta,
    background: "default",
    motion: "none",
    contentHints: null,
  };
}

/** Homepage die opent met hero (attention) + gegeven restsecties. */
function homePage(...instances: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    key: "home",
    title: "Home",
    purpose: "Kernpagina met aanbod en conversie.",
    seo: null,
    sectionInstances: [
      inst("hero", "split", [], { label: "Neem contact op", target: "form", prominence: "primary" }),
      ...instances,
    ],
  };
}

function blueprint(
  pages: Array<Record<string, unknown>>,
  options: {
    trust?: { usps?: number; stats?: number; badges?: number };
    missing?: string[];
  } = {}
): WebsiteBlueprint {
  return websiteBlueprintSchema.parse({
    version: 2,
    pages,
    trustElements: {
      usps: Array.from({ length: options.trust?.usps ?? 0 }, (_, i) => ({
        label: `USP ${i + 1}`,
        source: "requirements",
      })),
      stats: Array.from({ length: options.trust?.stats ?? 0 }, (_, i) => ({
        label: `Statistiek ${i + 1}`,
        value: `${i + 1}00`,
        source: "requirements",
      })),
      badges: Array.from({ length: options.trust?.badges ?? 0 }, (_, i) => ({
        label: `Badge ${i + 1}`,
        source: "requirements",
      })),
    },
    conversionPlan: { primaryGoal: null, leadCapture: null, contactPreference: null },
    missingInformation: options.missing ?? [DISCLOSURE],
  });
}

const HERO_ONLY = [homePage()];

// ---------------------------------------------------------------------------
// 1. Volledige conversieketen
// ---------------------------------------------------------------------------

test("conversieketen: volledige chain (attention + interest + trust-sectie + action) slaagt", () => {
  const bp = blueprint([
    homePage(
      inst("services", "grid", [
        { kind: "service", hint: "Dienst A" },
        { kind: "service", hint: "Dienst B" },
      ]),
      inst("usp_band", "row", [
        { kind: "usp", hint: "USP 1" },
        { kind: "usp", hint: "USP 2" },
      ]),
      inst("cta", "band", [], { label: "Vraag een offerte aan", target: "form", prominence: "primary" }),
      inst("contact", "split")
    ),
  ], { trust: { usps: 2 } });

  const result = validateConversionStructure(bp);
  assert.equal(result.passed, true, result.errors.join(" | "));
  assert.deepEqual(result.chain, {
    attention: true,
    interest: true,
    trust: { satisfied: true, waived: false },
    action: true,
  });
  // En geïntegreerd: de volledige consistency slaagt ook.
  const consistency = validateBlueprintConsistency(bp, requirements(1));
  assert.equal(consistency.passed, true, consistency.errors.join(" | "));
});

// ---------------------------------------------------------------------------
// 2. Trust ontbreekt maar wordt eerlijk gemarkeerd
// ---------------------------------------------------------------------------

test("conversieketen: trust mag ontbreken mits eerlijk geregistreerd in missingInformation", () => {
  const bp = blueprint([
    homePage(
      inst("services", "grid", [
        { kind: "service", hint: "Dienst A" },
        { kind: "service", hint: "Dienst B" },
      ]),
      inst("contact", "split")
    ),
  ]);
  // Fixture heeft standaard de DISCLOSURE-regel in missingInformation.
  const result = validateConversionStructure(bp);
  assert.equal(result.passed, true, result.errors.join(" | "));
  assert.deepEqual(result.chain.trust, { satisfied: true, waived: true });
});

test("conversieketen: trust-ontbreken ZONDER eerlijke registratie faalt (geen stille waiver)", () => {
  const bp = blueprint(
    [
      homePage(
        inst("services", "grid", [
          { kind: "service", hint: "Dienst A" },
          { kind: "service", hint: "Dienst B" },
        ]),
        inst("contact", "split")
      ),
    ],
    { missing: [] }
  );
  const result = validateConversionStructure(bp);
  assert.equal(result.passed, false);
  assert.equal(result.chain.trust.satisfied, false);
  assert.ok(
    result.errors.some((e) => e.includes("geen expliciete registratie van ontbrekend betrouwbaar bewijs")),
    result.errors.join(" | ")
  );
});

// ---------------------------------------------------------------------------
// 3. Geen action
// ---------------------------------------------------------------------------

test("conversieketen: geen action-sectie faalt", () => {
  const bp = blueprint([
    homePage(
      inst("services", "grid", [
        { kind: "service", hint: "Dienst A" },
        { kind: "service", hint: "Dienst B" },
      ]),
      inst("about", "story")
    ),
  ]);
  const result = validateConversionStructure(bp);
  assert.equal(result.passed, false);
  assert.equal(result.chain.action, false);
  assert.ok(result.errors.some((e) => e.startsWith("Conversieketen: geen action-sectie")), result.errors.join(" | "));
});

// ---------------------------------------------------------------------------
// 4. Geen attention
// ---------------------------------------------------------------------------

test("conversieketen: homepage zonder hero-aanvang faalt op attention", () => {
  const bp = blueprint([
    {
      key: "home",
      title: "Home",
      purpose: "Kernpagina zonder positionering.",
      seo: null,
      sectionInstances: [
        inst("services", "grid", [
          { kind: "service", hint: "Dienst A" },
          { kind: "service", hint: "Dienst B" },
        ]),
        inst("cta", "band", [], { label: "Neem contact op", target: "form", prominence: "primary" }),
      ],
    },
  ]);
  const result = validateConversionStructure(bp);
  assert.equal(result.passed, false);
  assert.equal(result.chain.attention, false);
  assert.ok(result.errors.some((e) => e.includes("attention-positie ontbreekt")), result.errors.join(" | "));
});

test("conversieketen: blueprint zonder homepage faalt op attention", () => {
  const bp = blueprint([
    {
      key: "over-ons",
      title: "Over ons",
      purpose: "Informatieve pagina.",
      seo: null,
      sectionInstances: [
        inst("hero", "split", [], { label: "Neem contact op", target: "form", prominence: "primary" }),
        inst("about", "story"),
        inst("contact", "split"),
      ],
    },
  ]);
  const result = validateConversionStructure(bp);
  assert.equal(result.passed, false);
  assert.equal(result.chain.attention, false);
  assert.ok(result.errors.some((e) => e.includes("geen homepage")), result.errors.join(" | "));
});

// ---------------------------------------------------------------------------
// 5. Blueprint met services/process/CTA
// ---------------------------------------------------------------------------

test("conversieketen: blueprint met services/process/CTA (geen trust-sectie, wel disclosure) slaagt", () => {
  const bp = blueprint([
    homePage(
      inst("services", "grid", [
        { kind: "service", hint: "Dienst A" },
        { kind: "service", hint: "Dienst B" },
      ]),
      inst("process", "steps", [
        { kind: "step", hint: "Stap 1" },
        { kind: "step", hint: "Stap 2" },
      ]),
      inst("cta", "band", [], { label: "Plan een gesprek", target: "form", prominence: "primary" })
    ),
  ]);
  const result = validateConversionStructure(bp);
  assert.equal(result.passed, true, result.errors.join(" | "));
  assert.equal(result.chain.interest, true);
  assert.equal(result.chain.action, true);
  assert.deepEqual(result.chain.trust, { satisfied: true, waived: true });
  const consistency = validateBlueprintConsistency(bp, requirements(1));
  assert.equal(consistency.passed, true, consistency.errors.join(" | "));
});

// ---------------------------------------------------------------------------
// 6. Anti-fabricatie
// ---------------------------------------------------------------------------

test("conversieketen: usp_band zonder geregistreerde USP's faalt de integriteit (check 7 + keten samen)", () => {
  const bp = blueprint(
    [
      homePage(
        inst("services", "grid", [
          { kind: "service", hint: "Dienst A" },
          { kind: "service", hint: "Dienst B" },
        ]),
        inst("usp_band", "row", [
          { kind: "usp", hint: "USP 1" },
          { kind: "usp", hint: "USP 2" },
        ]),
        inst("contact", "split")
      ),
    ],
    { trust: { usps: 0 } } // sectie gepland, maar géén geregistreerde echte data
  );
  // De keten zelf is structureel compleet (trust-sectie aanwezig)...
  const chain = validateConversionStructure(bp);
  assert.equal(chain.chain.trust.satisfied, true);
  // ...maar de integrale consistency weigert: check 7 (anti-fabricatie) faalt.
  const consistency = validateBlueprintConsistency(bp, requirements(1));
  assert.equal(consistency.passed, false);
  assert.ok(
    consistency.errors.some((e) => e.includes("evidence_only") && e.includes("trustElements")),
    consistency.errors.join(" | ")
  );
});

test("conversieketen: geregistreerde echte trust-data zonder trust-sectie faalt (geen stille negering)", () => {
  const bp = blueprint([
    homePage(
      inst("services", "grid", [
        { kind: "service", hint: "Dienst A" },
        { kind: "service", hint: "Dienst B" },
      ]),
      inst("contact", "split")
    ),
  ], { trust: { usps: 2 } });
  const result = validateConversionStructure(bp);
  assert.equal(result.passed, false);
  assert.ok(
    result.errors.some((e) => e.includes("trustElements bevatten geregistreerde echte data")),
    result.errors.join(" | ")
  );
});

// ---------------------------------------------------------------------------
// 7. Bestaande v1/v2-compatibiliteit
// ---------------------------------------------------------------------------

test("compatibiliteit: v1 Design Plan zonder blueprint blijft geldig en onaangetast", () => {
  const prompt = buildDesignPlanPrompt({
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
    numberOfPages: 1,
    ecommerce: false,
    suggestedTemplate: "business_standard",
    questionnaireSummary: [],
    hasCompletedQuestionnaire: false,
  });
  const plan = JSON.parse(buildMockDesignPlan(prompt)) as Record<string, unknown>;
  delete plan.blueprint; // v1-plannen hebben geen blueprint
  const parsed = designPlanSchema.safeParse(plan);
  assert.ok(parsed.success, JSON.stringify(parsed.success ? "" : parsed.error.issues.slice(0, 3)));
});

test("compatibiliteit: hero-only blueprint faalt eerlijk op interest én action", () => {
  const bp = blueprint(HERO_ONLY);
  const result = validateConversionStructure(bp);
  assert.equal(result.passed, false);
  assert.equal(result.chain.attention, true);
  assert.equal(result.chain.interest, false);
  // Een CTA-configuratie óp een hero is geen action-sectie: de keten vereist
  // een structurele conversieplek (cta/contact/booking/newsletter).
  assert.equal(result.chain.action, false);
  assert.deepEqual(result.chain.trust, { satisfied: true, waived: true });
});

test("integratie: validateBlueprintConsistency neemt de conversieketen-fouten over", () => {
  const bp = blueprint([homePage()], { missing: [] }); // geen interest, geen action-vloer, geen disclosure
  const consistency = validateBlueprintConsistency(bp, requirements(1));
  assert.equal(consistency.passed, false);
  assert.ok(consistency.errors.some((e) => e.startsWith("Conversieketen:")), consistency.errors.join(" | "));
  // De compositie-vloer meldt de homepage-conversie apart (bestaande check blijft bestaan).
  assert.ok(
    consistency.errors.some((e) => e.includes("bevat geen conversiesectie")),
    consistency.errors.join(" | ")
  );
});

test("conversieketen: volgorde-vrij — identieke keten met andere sectievolgorde slaagt ook", () => {
  const bp = blueprint([
    {
      key: "home",
      title: "Home",
      purpose: "Kernpagina met andere volgorde.",
      seo: null,
      sectionInstances: [
        inst("hero", "minimal", [], { label: "Plan een gesprek", target: "form", prominence: "primary" }),
        inst("contact", "full"),
        inst("cta", "closing", [], { label: "Bekijk het aanbod", target: "home", prominence: "secondary" }),
      ],
    },
    {
      key: "diensten",
      title: "Diensten",
      purpose: "Aanbodpagina.",
      seo: null,
      sectionInstances: [
        inst("services", "grid", [
          { kind: "service", hint: "Dienst A" },
          { kind: "service", hint: "Dienst B" },
        ]),
        inst("cta", "band", [], { label: "Neem contact op", target: "home", prominence: "primary" }),
      ],
    },
  ]);
  const result = validateConversionStructure(bp);
  assert.equal(result.passed, true, result.errors.join(" | "));
  // Interest hoeft niet op de homepage: de keten geldt websitebreed.
  assert.equal(result.chain.interest, true);
  const consistency = validateBlueprintConsistency(bp, requirements(2));
  assert.equal(consistency.passed, true, consistency.errors.join(" | "));
});
