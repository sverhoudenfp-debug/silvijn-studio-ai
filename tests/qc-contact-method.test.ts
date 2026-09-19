/**
 * Regressietests — QC contactmethode-logica + AI-escalatiecontract.
 *
 * Aanleiding (live-incident 2026-09-19, fixture 40fe71cf website v2):
 * de deterministische check telde het aanwezige contactformulier
 * (conversion.leadCapture=true) niet als contactmethode, en de AI-QC
 * escaleerde no_contact_methods naar critical ("bezoekers hebben geen
 * manier om contact op te nemen") terwijl het formulier aanwezig was.
 * Daardoor scoorde de verbeterde website v2 lager dan v1.
 *
 * Fix (commits van 2026-09-19): (a) het formulier telt als geldige
 * contactmethode — telefoon/e-mail ontbreekt wordt dan maximaal een
 * warning; (b) het AI-QC-contract verbiedt de escalatie en de merge
 * capit AI-severity op "error" (critical is voorbehouden aan de
 * deterministische laag).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runDeterministicChecks } from "../lib/qc/checks";
import { buildWebsiteQCPrompt } from "../lib/ai/service";
import { WebsiteSpecificationSchema } from "../lib/ai/schemas";
import type { WebsiteSpecification } from "../lib/websites/types";
import type { GeneratedWebsite } from "../lib/websites/types";
import type { Lead } from "../lib/types";
import type { Project } from "../lib/projects/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

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
  branding: {
    primaryColor: null,
    secondaryColor: null,
    accentColor: null,
    backgroundStyle: null,
    typographyStyle: null,
    visualStyle: null,
  },
  structure: {
    pages: [{ key: "home", title: "Home" }],
    navigation: ["Home"],
    sections: ["hero", "about", "services", "contact", "footer"],
  },
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
  conversion: {
    primaryCta: "Neem contact op",
    secondaryCta: null,
    contactMethods: [],
    leadCapture: true,
  },
  media: {
    imageRequirements: [{ key: "hero", description: "Sfeerbeeld interieur", required: true }],
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
  notes: null,
} as unknown as Lead;

const PROJECT = {
  requirements: { ecommerce: false, copywriting: false },
} as unknown as Project;

function makeWebsite(conversion: { contactMethods?: string[]; leadCapture?: boolean }): GeneratedWebsite {
  const spec = JSON.parse(JSON.stringify(BASE_SPEC)) as WebsiteSpecification;
  if (conversion.contactMethods !== undefined) spec.conversion.contactMethods = conversion.contactMethods;
  if (conversion.leadCapture !== undefined) spec.conversion.leadCapture = conversion.leadCapture;
  return {
    id: "test-website",
    slug: "studio-voorbeeld",
    previewUrl: "/generated-websites/studio-voorbeeld",
    status: "ready_for_qc",
    generationStatus: "completed",
    buildStatus: "passed",
    specification: spec,
    generatedContent: null,
  } as unknown as GeneratedWebsite;
}

function runChecks(conversion: { contactMethods?: string[]; leadCapture?: boolean }) {
  return runDeterministicChecks({ website: makeWebsite(conversion), lead: LEAD, project: PROJECT });
}

// ---------------------------------------------------------------------
// (1) leadCapture=true → GEEN no_contact_methods error
// ---------------------------------------------------------------------

test("leadCapture=true: formulier telt als contactmethode — geen no_contact_methods error", () => {
  const result = runChecks({ contactMethods: [], leadCapture: true });
  const rules = result.issues.map((i) => i.rule);
  assert.ok(!rules.includes("no_contact_methods"), "no_contact_methods mag niet meer optreden zodra het formulier bestaat");
  const warning = result.issues.find((i) => i.rule === "no_contact_channels");
  assert.ok(warning, "ontbrekende telefoon/e-mail moet als no_contact_channels-warning zichtbaar blijven");
  assert.equal(warning?.severity, "warning");
  assert.equal(warning?.category, "conversion");
});

test("leadCapture=true + telefoon/e-mail aanwezig: helemaal geen contact-method issues", () => {
  const result = runChecks({ contactMethods: ["telefoon", "e-mail"], leadCapture: true });
  const rules = result.issues.map((i) => i.rule);
  assert.ok(!rules.includes("no_contact_methods"));
  assert.ok(!rules.includes("no_contact_channels"));
});

// ---------------------------------------------------------------------
// (2) telefoon/e-mail ontbreekt maar formulier bestaat → GEEN critical
//     contact-method error (max warning), conversie-categorie faalt niet
// ---------------------------------------------------------------------

test("telefoon/e-mail ontbreekt, formulier aanwezig: geen error of critical in conversie, categorie faalt niet", () => {
  const result = runChecks({ contactMethods: [], leadCapture: true });
  const conversionIssues = result.issues.filter((i) => i.category === "conversion");
  assert.ok(
    conversionIssues.every((i) => i.severity === "warning" || i.severity === "info"),
    `conversie-issues mogen geen error/critical bevatten: ${conversionIssues.map((i) => `${i.severity}/${i.rule}`).join(", ")}`
  );
  const conversionCheck = result.checks.find((c) => c.category === "conversion");
  assert.ok(conversionCheck, "conversie-categorie moet bestaan");
  assert.notEqual(conversionCheck?.result, "failed", "conversie-categorie mag niet failed zijn door ontbrekende telefoon/e-mail alléén");
});

// ---------------------------------------------------------------------
// (3) leadCapture=false + geen telefoon/e-mail → bestaande fout blijft
// ---------------------------------------------------------------------

test("leadCapture=false + geen contactMethods: no_contact_methods error EN no_lead_capture warning blijven bestaan", () => {
  const result = runChecks({ contactMethods: [], leadCapture: false });
  const error = result.issues.find((i) => i.rule === "no_contact_methods");
  assert.ok(error, "no_contact_methods error moet blijven bestaan zonder formulier én zonder kanalen");
  assert.equal(error?.severity, "error");
  const leadCaptureWarning = result.issues.find((i) => i.rule === "no_lead_capture");
  assert.ok(leadCaptureWarning, "no_lead_capture warning moet blijven bestaan");
  const conversionCheck = result.checks.find((c) => c.category === "conversion");
  assert.equal(conversionCheck?.result, "failed", "zonder enige contactmethode moet de conversie-categorie blijven falen");
});

// ---------------------------------------------------------------------
// (4) AI-contract voorkomt escalatie naar no_contact_methods wanneer
//     een formulier aanwezig is
// ---------------------------------------------------------------------

const qcPrompt = buildWebsiteQCPrompt({
  businessName: "Studio Voorbeeld",
  industry: "interieur",
  city: "Apeldoorn",
  leadStatus: "qualified",
  requirementsSummary: "type: business_website",
  specificationSummary: "leadCapture=true, contactMethods leeg",
  generatedSectionsSummary: "header/hero/about/services/contact/footer",
  deterministicResults: "conversion: warning (1 issues) ;; issues: conversion/warning: Telefoon/e-mail ontbreekt — het aanwezige contactformulier is op dit moment de enige contactmethode.",
});

test("AI-contract: formulier telt ALTIJD als contactmogelijkheid en wordt nooit als no_contact_methods-critical beoordeeld", () => {
  assert.match(qcPrompt, /telt ALTIJD als geldige contactmogelijkheid/);
  assert.match(qcPrompt, /NOOIT als "geen contactmethodes" \(no_contact_methods\) of een vergelijkbare CRITICAL conversion-fout/);
});

test("AI-contract: telefoon/e-mail maximaal warning; geen productieve verzendveronderstelling; geen severity-verzwaring", () => {
  assert.match(qcPrompt, /ontbrekende telefoon\/e-mail mag je afzonderlijk noemen, maar hooguit met severity "warning"/i);
  assert.match(qcPrompt, /Veronderstel NIET dat het contactformulier productief verzendt/);
  assert.match(qcPrompt, /alleen de AANWEZIGHEID is bewezen/);
  assert.match(qcPrompt, /Verzwaar of verzwak de severity van deterministische issues NOOIT/);
  assert.match(qcPrompt, /severity maximaal "error"/);
});

test("Merge-cap (bron-contract): AI-critical wordt nooit overgenomen — critical is voorbehouden aan de deterministische laag", () => {
  const serviceSource = readFileSync(path.join(root, "lib/qc/service.ts"), "utf8");
  assert.match(
    serviceSource,
    /severity: issue\.severity === "critical" \? "error" : issue\.severity/,
    "de merge moet AI-severity capitten op error (live-incident: AI escaleerde no_contact_methods naar critical)"
  );
});
