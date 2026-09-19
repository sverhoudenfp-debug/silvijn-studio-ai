import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Memory-mode: nooit productie raken (zelfde patroon als de andere suites).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import { enforceTrustedBusinessName } from "../lib/websites/business-name";
import { buildWebsitePlanningPrompt } from "../lib/ai/service";
import { NextJsWebsiteGenerator } from "../lib/websites/generator";
import type { WebsiteSpecification } from "../lib/websites/types";

const root = process.cwd();
const generationServiceSource = readFileSync(path.join(root, "lib/websites/service.ts"), "utf8");

/**
 * REGRESSIETESTS (productiebevinding 2026-09-19, A/B v3/v4 op de
 * zip-flow-fixture): de live websiteplanning-AI normaliseerde de exacte
 * bedrijfsnaam "[TEST-FIXTURE] Studio Fictief (Project→ZIP flow)"
 * systematisch naar "Studio Fictief" (v3 én v4 identiek gereproduceerd).
 * De QC-regel business_name wees dat terecht af als critical.
 *
 * Fix: deterministische post-AI-guard enforceTrustedBusinessName — de
 * lead-/project-bronwaarde is de enige autoriteit en wordt bij elke
 * mismatch verbatim hersteld; de AI kan de naam nooit overschrijven.
 *
 * Guardians in deze suite:
 * a. exacte naam blijft behouden (no-op bij match);
 * b. [TEST-FIXTURE]-naam blijft volledig behouden (ook bij AI-strippen);
 * c. de AI kan geen verkorte/gewijzigde variant laten staan;
 * d. normale bedrijfsnamen (incl. apostrofs, hoofdletters, BV) blijven
 *    exact werken;
 * e. de gegenereerde content (generator) gebruikt de herstelde naam;
 * f. service-wiring: generateWebsite past de guard toe ná de AI-planning;
 * g. prompt-contract: de planning-prompt gebiedt de exacte naam.
 */

const FIXTURE_NAME = "[TEST-FIXTURE] Studio Fictief (Project\u2192ZIP flow)";

function makeSpecification(businessName: string | null): WebsiteSpecification {
  return {
    template: "business_standard",
    business: {
      businessName: businessName ?? "",
      industry: "interieur",
      city: "Amsterdam",
      province: "Noord-Holland",
      description: null,
      targetAudience: null,
    },
    branding: { primaryColor: null, secondaryColor: null, accentColor: null, backgroundStyle: null, typographyStyle: null, visualStyle: null },
    structure: { pages: [{ key: "home", title: "Home" }], navigation: ["Home"], sections: ["header", "hero", "services", "cta", "contact", "footer"] },
    content: {
      headline: "Interieur met karakter",
      subheadline: null,
      valueProposition: null,
      services: [{ title: "Woningstyling", description: null }],
      about: null,
      benefits: [],
      faq: [],
      testimonials: [],
      contactIntro: null,
      ctaPrimaryText: "Neem contact op",
      ctaSecondaryText: null,
    },
    conversion: { primaryCta: "[INFORMATIE ONBEKEND]", secondaryCta: null, contactMethods: [], leadCapture: true },
    media: { imageRequirements: [], imageDescriptions: [], imagePlaceholders: [] },
    seo: { title: "Test", metaDescription: null, keywords: [], localArea: "Amsterdam" },
    missingInformation: [],
  } as unknown as WebsiteSpecification;
}

// a. Exacte bedrijfsnaam blijft behouden (no-op bij exacte match)
test("a. exacte bedrijfsnaam blijft exact behouden — geen correctie bij match", () => {
  const spec = makeSpecification(FIXTURE_NAME);
  const result = enforceTrustedBusinessName(spec, FIXTURE_NAME);
  assert.equal(result.corrected, false);
  assert.equal(result.specification.business.businessName, FIXTURE_NAME);
  assert.equal(result.trustedValue, FIXTURE_NAME);
  assert.equal(result.aiValue, FIXTURE_NAME);
});

// b. [TEST-FIXTURE]-naam blijft volledig behouden, ook als de AI stripped
test("b. [TEST-FIXTURE]-naam blijft volledig behouden wanneer de AI die stript", () => {
  const spec = makeSpecification("Studio Fictief"); // exact de live v3/v4-AI-uitkomst
  const result = enforceTrustedBusinessName(spec, FIXTURE_NAME);
  assert.equal(result.corrected, true);
  assert.equal(result.specification.business.businessName, FIXTURE_NAME);
  assert.equal(result.aiValue, "Studio Fictief");
  assert.ok(result.specification.business.businessName.includes("[TEST-FIXTURE]"));
  assert.ok(result.specification.business.businessName.includes("(Project\u2192ZIP flow)"));
});

// c. De AI kan geen verkorte of gewijzigde variant laten staan
test("c. AI kan geen verkorte variant overschrijven — bronwaarde wint altijd", () => {
  for (const aiValue of [
    "Studio Fictief",                          // gestripte fixture-naam (live aangetroffen)
    "Studio",                                  // ingekort
    "[TEST-FIXTURE] Studio Fictief",          // gedeeltelijk
    "studio fictief",                          // genormaliseerde hoofdletters
    "Fictitious Studio",                       // vertaald
    "[TEST-FIXTURE] Studio Fictief (Project -> ZIP flow)", // herinterpunctie
  ]) {
    const spec = makeSpecification(aiValue);
    const result = enforceTrustedBusinessName(spec, FIXTURE_NAME);
    assert.equal(result.corrected, true, `AI-waarde "${aiValue}" moet worden gecorrigeerd`);
    assert.equal(result.specification.business.businessName, FIXTURE_NAME);
  }
});

// c2. Zelfs een compleet andere bedrijfsnaam kan de bronwaarde niet vervangen
test("c2. een compleet afwijkende AI-naam wordt deterministisch vervangen", () => {
  const spec = makeSpecification("Interieur Bureau Amsterdam BV");
  const result = enforceTrustedBusinessName(spec, FIXTURE_NAME);
  assert.equal(result.corrected, true);
  assert.equal(result.specification.business.businessName, FIXTURE_NAME);
});

// d. Normale bestaande bedrijfsnamen blijven exact werken
test("d. normale bedrijfsnamen (apostrofs, hoofdletters, BV) blijven exact werken", () => {
  const normalNames = [
    "Bakkerij 't Kruimeltje BV",
    "Schildersbedrijf Van den Berg & Zonen",
    "Kapsalon Marleen",
    "Bouwbedrijf  De Vries   constructies", // meerdere spaties zijn deel van de bronwaarde
  ];
  for (const trusted of normalNames) {
    const exactSpec = makeSpecification(trusted);
    const exactResult = enforceTrustedBusinessName(exactSpec, trusted);
    assert.equal(exactResult.corrected, false, `exacte match bij "${trusted}" moet no-op zijn`);
    assert.equal(exactResult.specification.business.businessName, trusted);

    const aiChanged = makeSpecification(trusted.toUpperCase());
    const changedResult = enforceTrustedBusinessName(aiChanged, trusted);
    assert.equal(changedResult.corrected, true);
    assert.equal(changedResult.specification.business.businessName, trusted);
  }
});

// e. De generator gebruikt de herstelde naam in de gegenereerde content
test("e. gegenereerde content bevat de exacte bron-naam na herstel", () => {
  const spec = makeSpecification("Studio Fictief");
  enforceTrustedBusinessName(spec, FIXTURE_NAME);
  const generated = new NextJsWebsiteGenerator().generate(spec, {
    phone: null,
    email: null,
    address: null,
    city: "Amsterdam",
    province: "Noord-Holland",
  });
  const rendered = JSON.stringify(generated.content.sections);
  assert.ok(
    rendered.includes(FIXTURE_NAME),
    "de exacte fixture-naam moet in de gegenereerde secties (header/footer) voorkomen"
  );
  assert.ok(!rendered.includes('"Studio Fictief"'), "de gestripte AI-variant mag nergens meer voorkomen");
});

// f. Service-wiring: generateWebsite past de guard toe ná de AI-planning
test("f. WebsiteGenerationService past de bedrijfsnaam-guard toe op de AI-planning", () => {
  assert.ok(
    generationServiceSource.includes("enforceTrustedBusinessName(specification, lead.businessName)"),
    "generateWebsite moet enforceTrustedBusinessName aanroepen met de lead-bronwaarde"
  );
  const guardIdx = generationServiceSource.indexOf("enforceTrustedBusinessName(specification, lead.businessName)");
  const planningIdx = generationServiceSource.indexOf("generateWebsiteSpecification(");
  const mergeIdx = generationServiceSource.indexOf("applyDesignPlanToSpecification(specification, designPlan)");
  assert.ok(planningIdx !== -1 && guardIdx > planningIdx, "de guard staat ná de AI-planning-call");
  assert.ok(mergeIdx !== -1 && guardIdx < mergeIdx, "de guard staat vóór de design-plan-merge");
});

// g. Prompt-contract: de planning-prompt gebiedt de exacte bedrijfsnaam
test("g. buildWebsitePlanningPrompt bevat een expliciet exact-naam-contract", () => {
  const prompt = buildWebsitePlanningPrompt({
    businessName: FIXTURE_NAME,
    industry: "interieur",
    city: "Amsterdam",
    province: "Noord-Holland",
    address: null,
    phone: null,
    email: null,
    website: null,
    googleRating: null,
    reviewCount: null,
    leadNotes: [],
    requirementsSummary: "Website type: business_website",
    existingWebsite: false,
    suggestedTemplate: "business_standard",
  });
  assert.ok(prompt.includes(FIXTURE_NAME), "de volledige fixture-naam staat in de prompt");
  assert.ok(
    prompt.includes("BEDRIJFSNAAM-CONTRACT"),
    "de prompt bevat het bedrijfsnaam-contract"
  );
  assert.ok(
    prompt.includes("spec.business.businessName moet EXACT"),
    "het contract verwijst expliciet naar het JSON-veld spec.business.businessName"
  );
});

// h. Defensief: een lege bronwaarde kan niets afdwingen (no-op)
test("h. lege bronwaarde is een no-op — bestaande build-validatie blijft de vangnet", () => {
  const spec = makeSpecification("Studio Fictief");
  const result = enforceTrustedBusinessName(spec, "");
  assert.equal(result.corrected, false);
  assert.equal(result.specification.business.businessName, "Studio Fictief");
});
