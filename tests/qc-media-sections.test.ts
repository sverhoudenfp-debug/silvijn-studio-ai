import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import { runDeterministicChecks } from "../lib/qc/checks";
import { WebsiteSpecificationSchema } from "../lib/ai/schemas";
import type { GeneratedWebsite, GeneratedWebsiteContent, WebsiteSpecification } from "../lib/websites/types";
import type { Lead } from "../lib/types";
import type { Project } from "../lib/projects/types";

// ---------------------------------------------------------------------------
// R1 — QC-verrijking (additief): beeldsloten en testimonials krijgen expliciete,
// eerlijke notities in het QC-rapport. Bewezen wordt:
// - de media_placeholders-info verschijnt (hero/about/services[/gallery]);
// - een actieve testimonials-sectie levert een business_accuracy-info die de
//   echte-data-regel benoemt;
// - testimonials in de specificatie ZONDER geemitte sectie levert een warning
//   (consistentie-aandacht);
// - de nieuwe sectietypes gallery/testimonials de structurele check niet
//   breken (structural_check blijft info);
// - zonder R1-secties verandert er niets aan het eerdere beeld.
// ---------------------------------------------------------------------------

const BASE_SPEC: WebsiteSpecification = WebsiteSpecificationSchema.parse({
  template: "business_standard",
  business: {
    businessName: "Studio Voorbeeld",
    industry: "interieur",
    city: "Apeldoorn",
    province: "Gelderland",
    description: null,
    targetAudience: "Particuliere opdrachtgevers in Apeldoorn",
  },
  branding: { primaryColor: null, secondaryColor: null, accentColor: null, backgroundStyle: null, typographyStyle: null, visualStyle: null },
  structure: { pages: [{ key: "home", title: "Home" }], navigation: ["Home"], sections: ["hero", "about", "services", "contact", "footer"] },
  content: {
    headline: "Interieuradvies in Apeldoorn",
    subheadline: "Van idee tot uitvoering",
    valueProposition: "Persoonlijk en concreet",
    services: [{ title: "Advies", description: "Concrete interieuradvies-trajecten." }],
    about: "Studio Voorbeeld is een fictieve teststudio.",
    benefits: ["Persoonlijk contact"],
    faq: [],
    testimonials: [],
    contactIntro: "Neem contact op via het formulier.",
    ctaPrimaryText: "Neem contact op",
    ctaSecondaryText: null,
  },
  conversion: { primaryCta: "Neem contact op", secondaryCta: null, contactMethods: [], leadCapture: true },
  media: {
    imageRequirements: [
      { key: "hero", description: "Sfeerbeeld interieur", required: true },
      { key: "portfolio", description: "Projectimpressies", required: true },
    ],
    imageDescriptions: ["Sfeerbeeld interieur"],
    imagePlaceholders: ["placeholder-hero"],
  },
  seo: {
    title: "Studio Voorbeeld — Apeldoorn",
    metaDescription: "Interieuradvies in Apeldoorn en omstreken.",
    keywords: ["interieur apeldoorn"],
    localArea: "Apeldoorn",
  },
  missingInformation: [],
});

const LEAD = {
  businessName: "Studio Voorbeeld",
  industry: "interieur",
  city: "Apeldoorn",
  phone: null,
  email: null,
  googleRating: null,
  reviewCount: null,
  // Echte, in de notities gedocumenteerde uitspraken — testimonials zonder
  // bron in de notities zijn gefabriceerd en worden door de safety-check
  // geblokkeerd; de fixture houdt zich dus aan diezelfde regel.
  notes: [
    "Zeer betrouwbaar en snel.",
    "Prima resultaat geleverd.",
    "Zeer tevreden met het resultaat.",
    "Top service.",
    "Top.",
  ],
} as unknown as Lead;

const PROJECT = {
  requirements: { ecommerce: false, copywriting: false },
} as unknown as Project;

function contentWith(sections: { type: string; data: Record<string, unknown> }[]): GeneratedWebsiteContent {
  return {
    template: "business_standard",
    branding: BASE_SPEC.branding,
    sections: sections as GeneratedWebsiteContent["sections"],
    seo: BASE_SPEC.seo,
    missingInformation: [],
  };
}

function makeWebsite(content: GeneratedWebsiteContent | null, testimonials: string[] = []): GeneratedWebsite {
  const spec = JSON.parse(JSON.stringify(BASE_SPEC)) as WebsiteSpecification;
  spec.content.testimonials = testimonials;
  return {
    id: "test-website",
    slug: "studio-voorbeeld",
    status: "ready_for_qc",
    generationStatus: "completed",
    buildStatus: "passed",
    specification: spec,
    generatedContent: content,
  } as unknown as GeneratedWebsite;
}

const BASE_SECTIONS = [
  { type: "header", data: { businessName: "Studio Voorbeeld", navigation: ["Home"] } },
  { type: "hero", data: { headline: "Interieuradvies in Apeldoorn", ctaText: "Neem contact op" } },
  { type: "services", data: { services: [{ title: "Advies", description: null }] } },
  { type: "about", data: { about: "Studio Voorbeeld is een fictieve teststudio." } },
  { type: "cta", data: { text: "Neem contact op" } },
  { type: "contact", data: { phone: null, email: null } },
  { type: "footer", data: { businessName: "Studio Voorbeeld", city: "Apeldoorn" } },
];

function runWith(sections: { type: string; data: Record<string, unknown> }[], testimonials: string[] = []) {
  return runDeterministicChecks({ website: makeWebsite(contentWith(sections), testimonials), lead: LEAD, project: PROJECT });
}

// ---------------------------------------------------------------------
// (1) media_placeholders-info verschijnt altijd (eerlijk over placeholders)
// ---------------------------------------------------------------------

test("QC: media_placeholders-info meldt de abstracte placeholders zonder stock-fabricatie", () => {
  const result = runWith(BASE_SECTIONS);
  const issue = result.issues.find((i) => i.rule === "media_placeholders");
  assert.ok(issue, "media_placeholders-info aanwezig");
  assert.equal(issue!.category, "design");
  assert.equal(issue!.severity, "info");
  assert.ok(issue!.message.includes("geen stock-foto's"));
});

// ---------------------------------------------------------------------
// (2) gallery-sectie noemt gallery expliciet in de media-info
// ---------------------------------------------------------------------

test("QC: actieve gallery-sectie wordt in de media_placeholders-info benoemd", () => {
  const withGallery = [...BASE_SECTIONS.slice(0, 3), { type: "gallery", data: { captions: [null, null, null, null] } }, ...BASE_SECTIONS.slice(3)];
  const result = runWith(withGallery);
  const issue = result.issues.find((i) => i.rule === "media_placeholders");
  assert.ok(issue);
  assert.ok(issue!.message.includes("/gallery"), "gallery staat in de genoemde sloten");
});

// ---------------------------------------------------------------------
// (3) testimonials: echte sectie → info; data zonder sectie → warning
// ---------------------------------------------------------------------

test("QC: actieve testimonials-sectie levert echte-data-info (business_accuracy)", () => {
  const withTestimonials = [...BASE_SECTIONS.slice(0, 3), { type: "testimonials", data: { quotes: ["Top service."] } }, ...BASE_SECTIONS.slice(3)];
  const result = runWith(withTestimonials, ["Top service."]);
  const info = result.issues.find((i) => i.rule === "testimonials_real_data_only");
  assert.ok(info, "testimonials_real_data_only aanwezig");
  assert.equal(info!.category, "business_accuracy");
  assert.equal(info!.severity, "info");
  assert.ok(info!.message.includes("nooit verzonnen"));

  const warning = result.issues.find((i) => i.rule === "testimonials_missing_section");
  assert.equal(warning, undefined, "geen missing-warning wanneer de sectie wél geemit is");
});

test("QC: testimonials-data zonder geemitte sectie levert een consistente warning", () => {
  const result = runWith(BASE_SECTIONS, ["Zeer tevreden met het resultaat."]);
  const warning = result.issues.find((i) => i.rule === "testimonials_missing_section");
  assert.ok(warning, "warning aanwezig");
  assert.equal(warning!.category, "design");
  assert.equal(warning!.severity, "warning");
});

test("QC: zonder testimonials-data én zonder sectie géén testimonials-issues", () => {
  const result = runWith(BASE_SECTIONS);
  assert.equal(result.issues.find((i) => i.rule === "testimonials_real_data_only"), undefined);
  assert.equal(result.issues.find((i) => i.rule === "testimonials_missing_section"), undefined);
});

// ---------------------------------------------------------------------
// (4) structurele check breekt niet op de nieuwe sectietypes
// ---------------------------------------------------------------------

test("QC: gallery + testimonials breken de structurele responsive-check niet", () => {
  const sections = [
    ...BASE_SECTIONS.slice(0, 3),
    { type: "gallery", data: { captions: [] } },
    { type: "testimonials", data: { quotes: ["Top."] } },
    ...BASE_SECTIONS.slice(3),
  ];
  const result = runWith(sections, ["Top."]);
  const structural = result.issues.find((i) => i.rule.includes("structural"));
  assert.ok(structural, "structural_check aanwezig");
  assert.equal(structural!.severity, "info", "de nieuwe sectietypes zijn structureel geldig");
  assert.ok(result.issues.every((i) => i.severity !== "critical"), "geen criticals door de R1-secties");
});
