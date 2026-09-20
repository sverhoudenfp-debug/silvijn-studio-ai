/**
 * Regressietests — C3e: ContentPlan-coverage QC-check (additief).
 *
 * Contract (Silvijn, 2026-09-20):
 * - customer_slot/merchant_slot in het ContentPlan → eerlijke WARNING
 *   in de content-categorie ("nog te leveren"), NOOIT critical/error.
 * - Bestaande flows zonder ContentPlan → alleen een info-issue
 *   (contentplan_absent); het categorieresultaat verandert niet.
 * - De check kan QC PASS niet blokkeren: computeOverallResult blijft
 *   "pass" zolang er alleen warnings zijn; bestaande gates onaangeroerd.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { runDeterministicChecks, type ContentPlanCoverageSummary } from "../lib/qc/checks";
import { computeOverallResult, computeScore } from "../lib/qc/rules";
import { WebsiteSpecificationSchema } from "../lib/ai/schemas";
import type { WebsiteSpecification, GeneratedWebsite } from "../lib/websites/types";
import type { Lead } from "../lib/types";
import type { Project } from "../lib/projects/types";

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

function makeWebsite(): GeneratedWebsite {
  return {
    id: "test-website",
    slug: "studio-voorbeeld",
    previewUrl: "/generated-websites/studio-voorbeeld",
    status: "ready_for_qc",
    generationStatus: "completed",
    buildStatus: "passed",
    specification: JSON.parse(JSON.stringify(BASE_SPEC)) as WebsiteSpecification,
    generatedContent: null,
  } as unknown as GeneratedWebsite;
}

function runChecks(contentPlanCoverage: ContentPlanCoverageSummary | null | undefined) {
  return runDeterministicChecks({
    website: makeWebsite(),
    lead: LEAD,
    project: PROJECT,
    contentPlanCoverage: contentPlanCoverage ?? null,
  });
}

function coverage(over: Partial<ContentPlanCoverageSummary> = {}): ContentPlanCoverageSummary {
  return {
    version: 1,
    generatedCount: 10,
    fixedCount: 4,
    customerSlotCount: 0,
    merchantSlotCount: 0,
    customerKinds: [],
    merchantKinds: [],
    ...over,
  };
}

test("zonder ContentPlan: info contentplan_absent, categorieresultaat verandert niet", () => {
  const result = runChecks(null);
  const contentIssues = result.issues.filter((i) => i.rule.startsWith("contentplan_"));
  assert.equal(contentIssues.length, 1);
  assert.equal(contentIssues[0].severity, "info");
  assert.equal(contentIssues[0].rule, "contentplan_absent");
  const contentCheck = result.checks.find((c) => c.category === "content")!;
  assert.ok(!["failed", "warning"].includes(contentCheck.result));
});

test("legacy-flow (veld weg gelaten) is volledig compatibel", () => {
  const result = runDeterministicChecks({ website: makeWebsite(), lead: LEAD, project: PROJECT });
  assert.ok(result.issues.some((i) => i.rule === "contentplan_absent" && i.severity === "info"));
});

test("customer_slot: warning met soorten, nooit critical/error", () => {
  const result = runChecks(coverage({ customerSlotCount: 3, customerKinds: ["quote", "team_name"] }));
  const warnings = result.issues.filter((i) => i.rule === "contentplan_customer_slots");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, "warning");
  assert.ok(warnings[0].message.includes("3"));
  assert.ok(warnings[0].message.includes("quote"));
  const hard = result.issues.filter((i) => i.rule.startsWith("contentplan_") && (i.severity === "critical" || i.severity === "error"));
  assert.equal(hard.length, 0, "coverage-check mag nooit critical/error toevoegen");
});

test("merchant_slot: warning contentplan_merchant_slots", () => {
  const result = runChecks(coverage({ merchantSlotCount: 5, merchantKinds: ["alt_text"] }));
  const warnings = result.issues.filter((i) => i.rule === "contentplan_merchant_slots");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, "warning");
});

test("coverage-warnings veranderen het overall resultaat nooit (additief-isolatie)", () => {
  const without = runChecks(null);
  const withCov = runChecks(coverage({ customerSlotCount: 2, merchantSlotCount: 2 }));
  // Isolatie: alleen de coverage-issues er (niet) bij → zelfde overall resultaat.
  const base = computeOverallResult(without.checks, without.issues);
  const withCoverageOnly = computeOverallResult(
    without.checks,
    [...without.issues, ...withCov.issues.filter((i) => i.rule.startsWith("contentplan_"))]
  );
  assert.equal(withCoverageOnly, base, "coverage-issues mogen het overall resultaat niet veranderen");
});

test("coverage-warnings alleen (geen andere issues) → computeOverallResult is pass", () => {
  const result = runChecks(coverage({ customerSlotCount: 2, merchantSlotCount: 2 }));
  const covIssues = result.issues.filter((i) => i.rule.startsWith("contentplan_"));
  const overall = computeOverallResult(result.checks.filter((c) => c.category === "content" && !c.issues.some((i) => !i.rule.startsWith("contentplan_"))), covIssues);
  assert.equal(overall, "pass", "uitsluitend coverage-warnings zijn nooit blokkerend");
});

test("warning kost max 3 punten per issue; info kost niets", () => {
  const without = runChecks(null);
  const withCov = runChecks(coverage({ customerSlotCount: 3, merchantSlotCount: 1 }));
  const delta = computeScore(without.checks, without.issues) - computeScore(withCov.checks, withCov.issues);
  assert.equal(delta, 6);
});

test("volledig gevuld plan: alleen contentplan_coverage info, geen warnings", () => {
  const result = runChecks(coverage({ version: 7 }));
  const cov = result.issues.filter((i) => i.rule === "contentplan_coverage");
  assert.equal(cov.length, 1);
  assert.equal(cov[0].severity, "info");
  assert.ok(cov[0].message.includes("v7"));
  assert.equal(result.issues.filter((i) => i.rule === "contentplan_customer_slots").length, 0);
  assert.equal(result.issues.filter((i) => i.rule === "contentplan_merchant_slots").length, 0);
});
