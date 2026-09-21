import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken (zelfde patroon als theme-zip-tests).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * Live-les Fase I.2 (18 september 2026): de websiteplanning-prompt noemde
 * alleen de top-level keys; claude-sonnet-5 verzint dan eigen veldnamen
 * (business.name i.p.v. businessName, primaryCta als object, het verplichte
 * content-blok ontbrak) en faalt de Zod-validatie — geconstateerd in de
 * EERSTE live generate_website-run ooit. Deze test borgt dat beide
 * planning-prompts een expliciet, volledig veldcontract bevatten.
 */
import { buildWebsitePlanningPrompt, buildDesignPlanPrompt } from "../lib/ai/service";

const websitePrompt = buildWebsitePlanningPrompt({
  businessName: "Testbedrijf",
  industry: "test",
  city: "Zwolle",
  province: "Overijssel",
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

const designPrompt = buildDesignPlanPrompt({
  businessName: "Testbedrijf",
  industry: "test",
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

test("websiteplanning-prompt bevat het volledige geneste veldcontract", () => {
  for (const field of [
    "businessName",
    "primaryColor",
    "backgroundStyle",
    "structure: { pages: array van { key: string, title: string|null }",
    "headline: string (VERPLICHT)",
    "ctaPrimaryText: string (VERPLICHT)",
    "primaryCta: string (VERPLICHT",
    "leadCapture: boolean",
    "metaDescription: string (VERPLICHT",
    "missingInformation",
    // Live-les (tweede live-run): sections zijn gecontroleerde keys, geen vrije tekst.
    "sections: array met uitsluitend deze exacte lowercase keys: header, hero, services, about, benefits, faq, cta, contact, footer",
  ]) {
    assert.ok(websitePrompt.includes(field), `prompt mist veldcontract: ${field}`);
  }
});

test("designplanning-prompt bevat het volledige geneste veldcontract", () => {
  for (const field of [
    "primaryGoal",
    "pageKey",
    "pageStructure",
    "usageGuidance",
    "leadCapture: boolean|null",
    "source: enum requirements|questionnaire|lead_notes",
    "basis: { sources",
    "missingInformation",
    "visualContract: VERPLICHT object",
    "modern_sans|geometric_sans|editorial_serif|classic_serif|humanist_sans|mono_technical",
    "warm_organic|cool_professional|premium_dark|fresh_light|earthy_natural|bold_contrast|monochrome",
    "compact|balanced|expressive|dramatic",
    "none|subtle|expressive",
  ]) {
    assert.ok(designPrompt.includes(field), `prompt mist veldcontract: ${field}`);
  }
});
