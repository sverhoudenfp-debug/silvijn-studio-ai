import test from "node:test";
import assert from "node:assert/strict";
import { buildDemoThemeInputs, generateDemoPageForLead, DemoGenerationError, DEMO_PLACEHOLDER_PREFIX } from "../lib/demos/demo-generation";
import { scanTextForFabricationPatterns } from "../lib/websites/safety-check";
import type { Lead } from "../lib/types";

delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const lead: Lead = {
  id: "lead-demo-1", businessName: "Schildersbedrijf De Kwast", industry: "schilder", address: null, postalCode: null,
  city: "Eindhoven", province: "Noord-Brabant", country: "NL", phone: "+31401234567", email: null, website: null,
  websiteStatus: "no_website", googleRating: 4.6, reviewCount: 12, leadScore: 49, leadStatus: "new", outreachStatus: "not_contacted",
  demoStatus: "not_created", source: "google", notes: [], aiAnalysis: null, createdAt: "2026-09-22T00:00:00Z", updatedAt: "2026-09-22T00:00:00Z",
};

test("demo inputs use only lead facts and mark everything else as placeholder", () => {
  const inputs = buildDemoThemeInputs(lead);
  assert.equal(inputs.specification.structure.pages.length, 1, "exactly one page");
  assert.equal(inputs.designPlan.pageStructure.length, 1);
  assert.ok(inputs.specification.content.headline.includes("Schildersbedrijf De Kwast"));
  assert.ok(inputs.specification.content.headline.includes("Eindhoven"));
  for (const s of inputs.specification.content.services) assert.ok(s.description?.startsWith(DEMO_PLACEHOLDER_PREFIX));
  assert.ok(inputs.specification.content.about?.startsWith(DEMO_PLACEHOLDER_PREFIX));
  assert.deepEqual(inputs.specification.content.testimonials, []);
  assert.deepEqual(inputs.specification.content.benefits, []);
  assert.deepEqual(inputs.specification.content.faq, []);
  // rating/reviews are never turned into copy
  const text = JSON.stringify(inputs.specification) + JSON.stringify(inputs.designPlan);
  assert.ok(!/4[.,]6|12 reviews/.test(text));
  assert.equal(scanTextForFabricationPatterns(text, inputs.trustedClaims).length, 0, "no fabrication patterns");
  assert.ok(inputs.missingInformation.some((m) => /E-mailadres onbekend/.test(m)));
  assert.deepEqual(inputs.contact, { phone: "+31401234567", email: null, address: null, city: "Eindhoven", province: "Noord-Brabant" });
});

test("generates a self-contained one-page demo document with banner and inert forms", async () => {
  const page = await generateDemoPageForLead(lead);
  assert.equal(page.slug, "schildersbedrijf-de-kwast");
  assert.match(page.sha256, /^[a-f0-9]{64}$/);
  assert.ok(page.html.includes("Voorbeeldontwerp voor Schildersbedrijf De Kwast"));
  assert.ok(page.html.includes("+31401234567"), "known phone shown");
  assert.ok(!/<form(?![^>]*data-preview-inert)/.test(page.html));
  assert.ok(!/https?:\/\/(?!schema\.org|www\.w3\.org)/.test(page.html.replace(/data:[^"']+/g, "")), "no external resource URLs");
  assert.ok(page.sectionTypes.includes("hero") && page.sectionTypes.includes("contact"));
  const again = await generateDemoPageForLead(lead);
  assert.equal(again.sha256, page.sha256, "deterministic");
});

test("refuses leads without usable facts", () => {
  assert.throws(() => buildDemoThemeInputs({ ...lead, city: " " }), (e: unknown) => e instanceof DemoGenerationError && e.code === "LEAD_CITY_MISSING");
  assert.throws(() => buildDemoThemeInputs({ ...lead, businessName: "X" }), (e: unknown) => e instanceof DemoGenerationError && e.code === "LEAD_NAME_MISSING");
});
