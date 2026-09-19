import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Memory-mode: nooit productie raken (zelfde patroon als de andere suites).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import {
  applyDesignPlanToSpecification,
  designPlanPlansSocialLinks,
  designPlanRequiresContactForm,
  normalizeDesignPlanKey,
  summarizeDesignPlanForGeneration,
} from "../lib/websites/design-plan-generation";
import { buildWebsitePlanningPrompt } from "../lib/ai/service";
import { NextJsWebsiteGenerator } from "../lib/websites/generator";
import type { WebsiteSpecification } from "../lib/websites/types";
import type { DesignPlan } from "../lib/websites/design-plan";

const root = process.cwd();
const generationServiceSource = readFileSync(path.join(root, "lib/websites/service.ts"), "utf8");

/**
 * REGRESSIETESTS (productiebug 2026-09-19, fixture #2-website v1):
 * "de gegenereerde website bevat geen contact_form" hoewel het Design Plan
 * (Fase I.1) contact-form expliciet plant.
 *
 * Exacte oorzaak: WebsiteGenerationService las het Design Plan NOOIT —
 * het plan had géén enkele consument in de contentgeneratie (alleen de
 * theme-ZIP-builder gebruikte het voor kleuren/typografie/navigatie). De AI
 * zette conversion.leadCapture=false omdat de fixture-requirements er niet
 * om vragen; de deterministische generator kopieerde dat; het React-preview
 * rendert het formulier alleen bij leadCapture=true.
 *
 * Fix-guardians in deze suite:
 * a. matching: plan-keys (contact-form / contact_formulier / feature-keys /
 *    ctaStrategy.leadCapture) herkennen een gepland contactformulier;
 * b. merge: applyDesignPlanToSpecification zet leadCapture DETERMINISTISCH
 *    aan wanneer het plan dat vereist — de AI kan het plan missen;
 * c. social links: géén veld in de specificatie en vrijwel nooit echte
 *    URL's → eerlijk naar missingInformation, nooit verzonnen links;
 * d. AI-input: buildWebsitePlanningPrompt neemt de plan-samenvatting op met
 *    het expliciete contactformulier-gebod in het JSON-contract;
 * e. service-wiring: WebsiteGenerationService laadt het laatste completed
 *    plan, geeft de samenvatting door en past de merge toe;
 * f. generator-note: bij leadCapture=false claimt de note nooit meer een
 *    formulier dat er niet is.
 */

function makePlan(overrides: Partial<DesignPlan> = {}): DesignPlan {
  const plan: DesignPlan = {
    goals: { primaryGoal: "Nieuwe klanten", secondaryGoals: [], conversionGoal: null },
    audience: { primaryAudience: "Particulieren", secondaryAudiences: [], toneOfVoice: "Zakelijk" },
    navigation: { items: [{ label: "Home", pageKey: "home" }], structure: "Primair" },
    pageStructure: [{ key: "home", title: "Home", purpose: "Binnenkomst", sections: ["hero", "diensten"] }],
    visualHierarchy: { strategy: null, aboveTheFold: [] },
    branding: { styleDirection: null, mood: [], existingBrandAssets: null, preferredColors: [], dislikedColors: [], restrictions: [] },
    typography: { pairing: null, scale: null, weights: [], rationale: null },
    colors: { primary: "#8a6d3b", secondary: null, accent: null, neutrals: [], usageGuidance: null },
    spacing: { scale: null, density: null },
    components: [{ key: "hero_cta", purpose: "Conversie", notes: null }],
    ctaStrategy: { primary: null, secondary: null, placement: [], leadCapture: null },
    imagery: { style: null, requirements: [], placeholderStrategy: null },
    responsive: { mobile: null, tablet: null, desktop: null, breakpoints: [] },
    animation: { strategy: null, allowed: [], restrictions: [] },
    functionality: { features: [], integrations: [] },
    accessibility: { contrast: null, focusAndKeyboard: null, semantics: null, formsAndLabels: null, guidelines: [] },
    seoPerformance: { titleStrategy: null, metaStrategy: null, localSeo: null, performanceBudget: null, imageOptimization: null },
    basis: { sources: ["lead"] },
    missingInformation: [],
    ...overrides,
  };
  return plan;
}

function makeSpecification(leadCapture: boolean): WebsiteSpecification {
  return {
    template: "business_standard",
    business: {
      businessName: "Studio Fictief",
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
    conversion: { primaryCta: "[INFORMATIE ONBEKEND]", secondaryCta: null, contactMethods: [], leadCapture },
    media: { imageRequirements: [], imageDescriptions: [], imagePlaceholders: [] },
    seo: { title: "Studio Fictief", metaDescription: "Interieur met karakter in Amsterdam.", keywords: [], localArea: "Amsterdam" },
    missingInformation: [],
  };
}

// ------------------------------------------------------------------
// a. Matching
// ------------------------------------------------------------------

test("normalisatie: keys zonder scheidingstekens/casing, lowercase", () => {
  assert.equal(normalizeDesignPlanKey("  Contact-Form "), "contactform");
  assert.equal(normalizeDesignPlanKey("contact_formulier"), "contactformulier");
  assert.equal(normalizeDesignPlanKey("Social Media Links"), "socialmedialinks");
});

test("designPlanRequiresContactForm: component-, feature- en CTA-bronnen herkennen het contactformulier", () => {
  assert.equal(designPlanRequiresContactForm(makePlan({ components: [{ key: "contact-form", purpose: "Aanvragen ontvangen", notes: null }] })), true);
  assert.equal(designPlanRequiresContactForm(makePlan({ components: [{ key: "contact_formulier", purpose: "Aanvragen ontvangen", notes: null }] })), true);
  assert.equal(
    designPlanRequiresContactForm(
      makePlan({ functionality: { features: [{ key: "contact_form", description: "Klanten kunnen een aanvraag doen", source: "questionnaire" }], integrations: [] } })
    ),
    true,
  );
  assert.equal(designPlanRequiresContactForm(makePlan({ ctaStrategy: { primary: null, secondary: null, placement: [], leadCapture: true } })), true);
  // Geen plan-contactformulier → false (AI-waarde blijft leidend)
  assert.equal(designPlanRequiresContactForm(makePlan()), false);
  assert.equal(
    designPlanRequiresContactForm(makePlan({ components: [{ key: "hero_cta", purpose: "Conversie", notes: null }] })),
    false,
  );
});

test("designPlanPlansSocialLinks: herkent social-media componenten/features, geen vals positief", () => {
  assert.equal(designPlanPlansSocialLinks(makePlan({ components: [{ key: "social_media_links", purpose: "Instagram", notes: null }] })), true);
  assert.equal(
    designPlanPlansSocialLinks(
      makePlan({ functionality: { features: [{ key: "socialmedia-knoppen", description: "Instagram", source: "requirements" }], integrations: [] } })
    ),
    true,
  );
  assert.equal(designPlanPlansSocialLinks(makePlan()), false);
});

// ------------------------------------------------------------------
// b. Merge: contactformulier → leadCapture (DE kernwaarborg)
// ------------------------------------------------------------------

test("kernwaarborg: plan plant contactformulier + AI zette leadCapture=false → merge zet true", () => {
  const plan = makePlan({ components: [{ key: "contact-form", purpose: "Klanten kunnen een aanvraag doen", notes: null }] });
  const spec = makeSpecification(false);
  const merged = applyDesignPlanToSpecification(spec, plan);
  assert.equal(merged.specification.conversion.leadCapture, true, "leadCapture MOET true zijn als het plan een contactformulier vereist");
  assert.equal(merged.appliedNotes.length, 1);
  assert.match(merged.appliedNotes[0], /contactformulier/);
});

test("merge verandert niets als de AI leadCapture al true zette (alleen verzwaren, nooit afzwakken)", () => {
  const plan = makePlan({ components: [{ key: "contact-form", purpose: "Aanvragen", notes: null }] });
  const merged = applyDesignPlanToSpecification(makeSpecification(true), plan);
  assert.equal(merged.specification.conversion.leadCapture, true);
  assert.equal(merged.appliedNotes.length, 0, "geen dubbele melding als er niets te doen viel");
});

test("zonder plan blijft de specificatie exact ongewijzigd", () => {
  const spec = makeSpecification(false);
  for (const plan of [null, undefined] as const) {
    const merged = applyDesignPlanToSpecification(spec, plan);
    assert.equal(merged.specification, spec);
    assert.deepEqual(merged.appliedNotes, []);
    assert.deepEqual(merged.unsupportedNotes, []);
  }
});

// ------------------------------------------------------------------
// c. Social links: eerlijk melden, nooit verzinnen
// ------------------------------------------------------------------

test("social links gepland zonder echte URL's → missingInformation-vermelding, geen verzonnen data", () => {
  const plan = makePlan({ components: [{ key: "social_media_links", purpose: "Social media", notes: null }] });
  const spec = makeSpecification(false);
  const merged = applyDesignPlanToSpecification(spec, plan);
  assert.equal(merged.unsupportedNotes.length, 1);
  assert.equal(spec.missingInformation.length, 1);
  assert.match(spec.missingInformation[0], /socialmedia/i);
  // leadCapture blijft ongewijzigd: social heeft niets met leadCapture te maken
  assert.equal(spec.conversion.leadCapture, false);
});

test("social-media-vermelding wordt niet gedupliceerd als de AI al een noteerde", () => {
  const plan = makePlan({ components: [{ key: "social_media_links", purpose: "Social media", notes: null }] });
  const spec = makeSpecification(false);
  spec.missingInformation.push("Socialmedia-URL's zijn onbekend");
  const merged = applyDesignPlanToSpecification(spec, plan);
  assert.equal(spec.missingInformation.length, 1, "precies één vermelding");
  assert.equal(merged.unsupportedNotes.length, 0, "unsupportedNote alleen bij een NIEUWE vermelding");
});

test("missingInformation-limiet (12) wordt gerespecteerd", () => {
  const plan = makePlan({ components: [{ key: "social_media_links", purpose: "Social media", notes: null }] });
  const spec = makeSpecification(false);
  spec.missingInformation = Array.from({ length: 12 }, (_, i) => `ontbrekend ${i + 1}`);
  const merged = applyDesignPlanToSpecification(spec, plan);
  assert.equal(spec.missingInformation.length, 12, "limiet wordt nooit overschreden");
  assert.equal(merged.unsupportedNotes.length, 1, "de plan-waarheid blijft wel in de notes zichtbaar");
});

// ------------------------------------------------------------------
// d. AI-input: plan-samenvatting + JSON-contract
// ------------------------------------------------------------------

test("summarizeDesignPlanForGeneration: feitelijke samenvatting van componenten, features en leadCapture", () => {
  const plan = makePlan({
    components: [
      { key: "contact-form", purpose: "Aanvragen ontvangen", notes: null },
      { key: "social_media_links", purpose: "Social media", notes: null },
    ],
    functionality: {
      features: [{ key: "contact_form", description: "Klanten kunnen een aanvraag doen", source: "questionnaire" }],
      integrations: [],
    },
    ctaStrategy: { primary: null, secondary: null, placement: [], leadCapture: true },
  });
  const summary = summarizeDesignPlanForGeneration(plan);
  assert.match(summary, /contact-form \(Aanvragen ontvangen\)/);
  assert.match(summary, /social_media_links/);
  assert.match(summary, /contact_form: Klanten kunnen een aanvraag doen \[bron: questionnaire\]/);
  assert.match(summary, /leadCapture: true \(lead-capture vereist\)/);
});

test("buildWebsitePlanningPrompt: met plan-samenvatting komt de INTERN DESIGN PLAN-sectie mét gebod in de prompt", () => {
  const prompt = buildWebsitePlanningPrompt({
    businessName: "Studio Fictief",
    industry: "interieur",
    city: "Amsterdam",
    province: null,
    address: null,
    phone: null,
    email: null,
    website: null,
    leadNotes: [],
    requirementsSummary: "type: business_website",
    existingWebsite: false,
    googleRating: null,
    reviewCount: null,
    suggestedTemplate: "business_standard",
    designPlanSummary: "Geplande componenten: contact-form (Aanvragen ontvangen)\nGeplande functionaliteit: geen expliciet gepland\nCTA-strategie leadCapture: niet expliciet",
  });
  assert.match(prompt, /INTERN DESIGN PLAN/);
  assert.match(prompt, /contact-form \(Aanvragen ontvangen\)/);
  assert.match(prompt, /contactformulier → conversion.leadCapture true/);
  assert.match(prompt, /leadCapture MOET true zijn wanneer het INTERNE DESIGN PLAN expliciet een contactformulier plant/);
});

test("buildWebsitePlanningPrompt: zonder plan géén Design Plan-sectie (bestaand gedrag)", () => {
  const prompt = buildWebsitePlanningPrompt({
    businessName: "Studio Fictief",
    industry: "interieur",
    city: "Amsterdam",
    province: null,
    address: null,
    phone: null,
    email: null,
    website: null,
    leadNotes: [],
    requirementsSummary: "type: business_website",
    existingWebsite: false,
    googleRating: null,
    reviewCount: null,
    suggestedTemplate: "business_standard",
    designPlanSummary: null,
  });
  assert.doesNotMatch(prompt, /INTERN DESIGN PLAN/);
});

// ------------------------------------------------------------------
// e. Service-wiring (source-contract: websites/service.ts)
// ------------------------------------------------------------------

test("wiring: WebsiteGenerationService laadt het laatste completed plan, geeft de samenvatting door én past de merge toe", () => {
  assert.match(generationServiceSource, /getDesignPlanRepository\(\)\.listByProject\(projectId\)/, "plan wordt per project gelezen");
  assert.match(generationServiceSource, /record\.status === "completed" && record\.plan !== null/, "alleen afgeronde plannen met inhoud");
  assert.match(generationServiceSource, /designPlanSummary,/, "samenvatting gaat de AI-input in");
  assert.match(generationServiceSource, /applyDesignPlanToSpecification\(specification, designPlan\)/, "merge wordt NÁ de AI-call toegepast");
  assert.match(generationServiceSource, /planMerge\.appliedNotes, \.\.\.planMerge\.unsupportedNotes/, "merge-notities landen in de generation notes");
});

// ------------------------------------------------------------------
// f. Generator-note: geen form claimen bij leadCapture=false
// ------------------------------------------------------------------

const generator = new NextJsWebsiteGenerator();
const noContact: { phone: null; email: null; address: null; city: string; province: null } = {
  phone: null,
  email: null,
  address: null,
  city: "Amsterdam",
  province: null,
};

test("generator-note bij leadCapture=false claimt géén contactformulier (productiebug 2026-09-19)", () => {
  const result = generator.generate(makeSpecification(false), noContact);
  const note = result.notes.find((n) => n.includes("contactsectie")) ?? "";
  assert.match(note, /géén contactformulier/, "de note moet eerlijk zijn over het ontbrekende formulier");
});

test("generator-note bij leadCapture=true behoudt de bestaande formulier-melding", () => {
  const result = generator.generate(makeSpecification(true), noContact);
  const note = result.notes.find((n) => n.includes("contactsectie")) ?? "";
  assert.match(note, /alleen het contactformulier/);
});
