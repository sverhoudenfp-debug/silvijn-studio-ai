import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { evaluateRequirementsCompleteness } from "../lib/projects/completeness";
import {
  designPlanSchema,
  validateDesignPlanConsistency,
  type DesignPlan,
} from "../lib/websites/design-plan";
import { MockAIProvider } from "../lib/ai/mock-provider";
import { nextDesignPlanVersion } from "../lib/websites/design-plan-service";
import type { ProjectRequirements } from "../lib/projects/types";

const root = process.cwd();
const migration = readFileSync(
  path.join(root, "supabase/migrations/0020_design_plan_requirements_completeness.sql"),
  "utf8"
);

// ---------------------------------------------------------------------------
// Requirements-completeness: deterministische beslissing
// ---------------------------------------------------------------------------

const COMPLETE_REQUIREMENTS: ProjectRequirements = {
  websiteType: "business_website",
  numberOfPages: 3,
  designLevel: "standard",
  ecommerce: false,
  copywriting: true,
};

test("completeness: lege requirements zijn nooit compleet — alle zes checks blokkeren", () => {
  const evaluation = evaluateRequirementsCompleteness({}, []);
  assert.equal(evaluation.complete, false);
  assert.deepEqual(evaluation.blockingMissing, [
    "website_type",
    "page_count",
    "design_level",
    "ecommerce_known",
    "copywriting_known",
  ]);
});

test("completeness: volledige requirements zonder open questionnaire zijn compleet", () => {
  const evaluation = evaluateRequirementsCompleteness(COMPLETE_REQUIREMENTS, []);
  assert.equal(evaluation.complete, true);
  assert.equal(evaluation.blockingMissing.length, 0);
});

test("completeness: onbekend is niet volledig — gedeeltelijke requirements blokkeren productie", () => {
  const evaluation = evaluateRequirementsCompleteness(
    { ...COMPLETE_REQUIREMENTS, numberOfPages: null, ecommerce: null },
    []
  );
  assert.equal(evaluation.complete, false);
  assert.deepEqual(evaluation.blockingMissing, ["page_count", "ecommerce_known"]);
});

test("completeness: fractionele of niet-gehele paginaantallen worden geweigerd", () => {
  const fractional = evaluateRequirementsCompleteness({ ...COMPLETE_REQUIREMENTS, numberOfPages: 2.5 }, []);
  const zero = evaluateRequirementsCompleteness({ ...COMPLETE_REQUIREMENTS, numberOfPages: 0 }, []);
  assert.equal(fractional.complete, false);
  assert.equal(zero.complete, false);
  assert.ok(fractional.blockingMissing.includes("page_count"));
  assert.ok(zero.blockingMissing.includes("page_count"));
});

test("completeness: een actieve questionnaire die niet afgerond is, blokkeert", () => {
  // open (geen antwoorden)
  const open = evaluateRequirementsCompleteness(COMPLETE_REQUIREMENTS, [
    { status: "active", completionStatus: null },
  ]);
  // wacht op follow-up (ronde 2)
  const followUp = evaluateRequirementsCompleteness(COMPLETE_REQUIREMENTS, [
    { status: "active", completionStatus: "QUESTIONNAIRE_FOLLOW_UP" },
  ]);
  // aandachtspunt (onvoldoende na ronde 2, nog actief)
  const attention = evaluateRequirementsCompleteness(COMPLETE_REQUIREMENTS, [
    { status: "active", completionStatus: "QUESTIONNAIRE_ATTENTION" },
  ]);
  for (const evaluation of [open, followUp, attention]) {
    assert.equal(evaluation.complete, false, JSON.stringify(evaluation.blockingMissing));
    assert.ok(evaluation.blockingMissing.includes("questionnaire_completion"));
  }
});

test("completeness: voltooide of gesloten questionnaires blokkeren niet", () => {
  const complete = evaluateRequirementsCompleteness(COMPLETE_REQUIREMENTS, [
    { status: "active", completionStatus: "QUESTIONNAIRE_COMPLETE" },
  ]);
  const closed = evaluateRequirementsCompleteness(COMPLETE_REQUIREMENTS, [
    { status: "closed", completionStatus: "QUESTIONNAIRE_ATTENTION" },
    { status: "closed", completionStatus: "QUESTIONNAIRE_COMPLETE" },
  ]);
  const draft = evaluateRequirementsCompleteness(COMPLETE_REQUIREMENTS, [
    { status: "draft", completionStatus: null },
  ]);
  assert.equal(complete.complete, true);
  assert.equal(closed.complete, true);
  assert.equal(draft.complete, true);
});

test("completeness: aandachtspunten (deadline, huisstijl, content) zijn niet-blokkerend maar worden getoond", () => {
  const evaluation = evaluateRequirementsCompleteness(COMPLETE_REQUIREMENTS, []);
  assert.equal(evaluation.attention.length, 3);
  assert.ok(evaluation.attention.some((a) => a.includes("Deadline")));
  assert.ok(evaluation.attention.some((a) => a.includes("Huisstijl")));
  assert.ok(evaluation.attention.some((a) => a.includes("content")));
  const withAll = evaluateRequirementsCompleteness(
    { ...COMPLETE_REQUIREMENTS, deadline: "oktober", existingBranding: true, contentAvailable: true },
    []
  );
  assert.equal(withAll.attention.length, 0);
});

// ---------------------------------------------------------------------------
// Design Plan: Zod-validatie + deterministische consistentie + no-fabrication
// ---------------------------------------------------------------------------

/** Publieke mock-provider-interface — geen private helpers. */
async function buildValidPlan(pages = 3): Promise<DesignPlan> {
  const provider = new MockAIProvider();
  const result = await provider.generateText({
    task: "design_planning",
    model: "mock",
    system: "",
    prompt: designPlanPrompt(pages),
    maxTokens: 4000,
  });
  const parsed = designPlanSchema.safeParse(JSON.parse(result.text));
  assert.ok(parsed.success, parsed.error?.issues.slice(0, 3).map((i) => i.message).join("; "));
  return parsed.data;
}

function designPlanPrompt(pages: number): string {
  return [
    "Plan het INTERNE Design Plan (JSON) voor de website van het volgende bedrijf.",
    "",
    "ECHTE BESCHIKBARE INFORMATIE (uitsluitend hieruit putten):",
    "Bedrijf: Bakkerij De Gouden Korst (TESTDATA)",
    "Branche: Bakkerij",
    "Plaats: Utrecht",
    "Huidige website: geen",
    "",
    "PROJECT REQUIREMENTS (samenvatting):",
    "type: business_website; pagina's: " + pages + "; design: standard; e-commerce: nee",
    "",
    "AANTAL PAGINA'S (bindend voor de paginastructuur): " + pages,
    "E-COMMERCE: nee",
    "TEMPLATESUGGESTIE (deterministisch): local_service",
    "",
    "QUESTIONNAIRE-ANTWOORDEN: geen (volledigheid ontbreekt mogelijk — vermeld relevante gaps in missingInformation).",
    "",
  ].join("\n");
}

test("design plan: mock-AI levert een schema-geldig plan dat exact het requirement-paginaaantal plant", async () => {
  const plan = await buildValidPlan(3);
  assert.equal(plan.pageStructure.length, 3);
  assert.ok(plan.pageStructure[0].sections.length >= 1);
  assert.ok(plan.navigation.items.length >= 1);
  assert.ok(plan.basis.sources.length >= 1);
  assert.ok(plan.missingInformation.length >= 1); // questionnaire-gaps expliciet
});

test("design plan: scope/prijsintegriteit — een afwijkend paginaaantal faalt deterministisch", async () => {
  const plan = await buildValidPlan(3);
  const ok = validateDesignPlanConsistency(plan, { ...COMPLETE_REQUIREMENTS, numberOfPages: 3 });
  assert.equal(ok.passed, true);
  const mismatch = validateDesignPlanConsistency(plan, { ...COMPLETE_REQUIREMENTS, numberOfPages: 5 });
  assert.equal(mismatch.passed, false);
  assert.ok(mismatch.errors.some((e) => e.includes("5")));
  // één pagina is een geldige scope: het plan zelf met 1 pagina moet slagen
  const single = validateDesignPlanConsistency(await buildValidPlan(1), { ...COMPLETE_REQUIREMENTS, numberOfPages: 1 });
  assert.equal(single.passed, true);
});

test("design plan: navigatie mag niet naar onbekende pagina's wijzen", async () => {
  const plan = await buildValidPlan(3);
  const broken = { ...plan, navigation: { ...plan.navigation, items: [{ label: "Bogus", pageKey: "does-not-exist" }] } };
  const result = validateDesignPlanConsistency(broken, { ...COMPLETE_REQUIREMENTS, numberOfPages: 3 });
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes("Navigatie-item")));
});

test("design plan: no-fabrication — prijzen, garanties en certificaten in het plan worden verworpen", async () => {
  const plan = await buildValidPlan(3);
  const withPrice: DesignPlan = {
    ...plan,
    goals: { ...plan.goals, primaryGoal: "De website bevat de scherpe prijs van €895 en 10 jaar garantie." },
  };
  const result = validateDesignPlanConsistency(withPrice, { ...COMPLETE_REQUIREMENTS, numberOfPages: 3 });
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.toLowerCase().includes("fabricatie")));

  const withCert = JSON.parse(JSON.stringify(plan)) as DesignPlan;
  withCert.branding.styleDirection = "ISO-gecertificeerde stijl";
  const certResult = validateDesignPlanConsistency(withCert, { ...COMPLETE_REQUIREMENTS, numberOfPages: 3 });
  assert.equal(certResult.passed, false);
});

test("design plan: onbekende kleuren zijn null — geen verzonnen hex-waarden", async () => {
  const plan = await buildValidPlan(3);
  assert.equal(plan.colors.primary, null);
  assert.equal(plan.colors.accent, null);
  assert.equal(plan.audience.primaryAudience, null);
});

test("design plan: kleurwaarden moeten geldige hex zijn", async () => {
  const plan = JSON.parse(JSON.stringify(await buildValidPlan(3))) as Record<string, unknown>;
  const colors = plan.colors as Record<string, unknown>;
  colors.primary = "rood";
  const invalid = designPlanSchema.safeParse(plan);
  assert.equal(invalid.success, false);
});

test("design plan: versienummering is deterministisch en begint bij 1", () => {
  assert.equal(nextDesignPlanVersion([]), 1);
  assert.equal(nextDesignPlanVersion([1]), 2);
  assert.equal(nextDesignPlanVersion([1, 2, 7]), 8);
});

// ---------------------------------------------------------------------------
// Migratie 0020: database-garanties (structurele invarianten)
// ---------------------------------------------------------------------------

test("migratie 0020: requirements_complete is alléén zetbaar via de owner-RPC", () => {
  assert.match(migration, /create function public\.set_project_requirements_complete\(p_project uuid\)/);
  assert.match(migration, /revoke all on function public\.set_project_requirements_complete\(uuid\) from public, anon, service_role/);
  assert.match(migration, /grant execute on function public\.set_project_requirements_complete\(uuid\) to authenticated;/);
  // De RPC vereist de ingelogde eigenaar en weigert onvoldoende informatie
  assert.match(migration, /INSUFFICIENT_REQUIREMENTS/);
  assert.match(migration, /HUMAN_AUTHORIZATION_REQUIRED/);
});

test("migratie 0020: een directe update requirements_complete false->true wordt geblokkeerd door de trigger", () => {
  assert.match(migration, /REQUIREMENTS_VERIFICATION_REQUIRED/);
  assert.match(migration, /guard_requirements_complete_transition/);
  assert.match(migration, /create trigger enforce_requirements_complete_guards\s*\n?\s*before update on public\.projects/);
  // Requirements-wijziging vervalt compleetheid automatisch
  assert.match(migration, /new\.requirements is distinct from old\.requirements/);
  assert.match(migration, /new\.requirements_complete := false/);
});

test("migratie 0020: design_plans volgt het privilegepatroon van questionnaires (RLS, anon niets)", () => {
  assert.match(migration, /create table public\.design_plans/);
  assert.match(migration, /alter table public\.design_plans enable row level security;/);
  assert.match(migration, /revoke all on public\.design_plans from anon;/);
  assert.match(migration, /grant select on public\.design_plans to authenticated;/);
  assert.match(migration, /revoke insert, update, delete on public\.design_plans from authenticated;/);
  // versie-uniek per project + migratie geregistreerd
  assert.match(migration, /constraint design_plans_project_version_key unique \(project_id, version\)/);
  assert.match(migration, /studio_schema_migrations\(version\) values \('0020_design_plan_requirements_completeness'\)/);
});

test("migratie 0020: de zes blokkerende checks bestaan in SQL en spiegelen de app-laag 1-op-1", () => {
  for (const key of [
    "website_type",
    "page_count",
    "design_level",
    "ecommerce_known",
    "copywriting_known",
    "questionnaire_completion",
  ]) {
    assert.match(migration, new RegExp(`'${key}'`), `SQL-check ${key} ontbreekt`);
  }
  // production gate (0010) blijft onaangeroerd: geen herdefinitie van de gate
  assert.doesNotMatch(migration, /create or replace function public\.project_production_gate/);
  assert.doesNotMatch(migration, /alter table public\.projects drop/);
});

test("design plan service: geen startTransition en geen klantzichtbare publicatiepaden", () => {
  const section = readFileSync(path.join(root, "components/projects/design-plan-section.tsx"), "utf8");
  assert.doesNotMatch(section, /startTransition/);
  assert.match(section, /intern/i);
  const service = readFileSync(path.join(root, "lib/websites/design-plan-service.ts"), "utf8");
  assert.doesNotMatch(service, /publish|deliver|deploy|sendMail|resend|stripe/i);
  // Geen enkele Fase I.1-laag koppelt code-matig naar de generator/Shopify-modules (I.2):
  // geen imports, alleen eventuele verklarende comments.
  const planImports = readFileSync(path.join(root, "lib/websites/design-plan.ts"), "utf8")
    .split("\n").filter((line) => line.startsWith("import")).join("\n");
  assert.doesNotMatch(planImports, /generator|shopify|build-service/i);
  const serviceImports = service.split("\n").filter((line) => line.startsWith("import")).join("\n");
  assert.doesNotMatch(serviceImports, /generator|shopify|build-service/i);
});
