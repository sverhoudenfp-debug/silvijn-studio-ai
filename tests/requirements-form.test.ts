import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { fromFormState, toFormState } from "../lib/projects/requirements-form";
import type { ProjectRequirements } from "../lib/projects/types";

const root = process.cwd();
const migration0020 = readFileSync(
  path.join(root, "supabase/migrations/0020_design_plan_requirements_completeness.sql"),
  "utf8"
);
const migration0010 = readFileSync(
  path.join(root, "supabase/migrations/0010_studio_security_finance.sql"),
  "utf8"
);

// ---------------------------------------------------------------------------
// Regressietests voor het live-incident van 2026-09-19 (project d1f66ce0):
// het requirements-formulier verloor responsive en schreef lege optionele
// velden als null bij, waardoor één gewone opslag de requirements JSONB
// wijzigde, requirements_complete vervalde (0020) en de goedgekeurde
// scope-snapshot mismatchte (0010 productie-poort).
// ---------------------------------------------------------------------------

/** Requirements zoals de zip-flow-fixture en echte projecten ze hebben:
 *  geen van de optionele formulier-velden bestaat als sleutel. */
const FIXTURE_REQUIREMENTS: ProjectRequirements = {
  websiteType: "business_website",
  numberOfPages: 3,
  designLevel: "standard",
  ecommerce: false,
  seo: false,
  copywriting: false,
  responsive: true,
};

/** Volledig requirements-object met velden die géén formulier-UI hebben. */
const REQUIREMENTS_WITH_INVISIBLE_FIELDS: ProjectRequirements = {
  ...FIXTURE_REQUIREMENTS,
  integrations: ["boekhoudsysteem"],
  photography: false,
  existingWebsite: true,
  existingBranding: null,
  contentAvailable: false,
  specialRequirements: "Vaste telefonische contactpersoon",
};

test("regressie: responsive: true blijft behouden na een formulier-save (lezen → bewerken → opslaan)", () => {
  const form = toFormState(REQUIREMENTS_WITH_INVISIBLE_FIELDS);
  assert.equal(form.responsive, "true", "responsive moet leesbaar in het formulier staan");
  const saved = fromFormState(form, REQUIREMENTS_WITH_INVISIBLE_FIELDS);
  assert.equal(saved.responsive, true, "responsive: true moet na de save exact behouden blijven");
});

test("regressie: velden zonder formulier-UI verdwijnen niet bij een save", () => {
  const form = toFormState(REQUIREMENTS_WITH_INVISIBLE_FIELDS);
  const saved = fromFormState(form, REQUIREMENTS_WITH_INVISIBLE_FIELDS);
  assert.deepEqual(saved.integrations, ["boekhoudsysteem"]);
  assert.equal(saved.photography, false);
  assert.equal(saved.existingWebsite, true);
  assert.equal(saved.existingBranding, null);
  assert.equal(saved.contentAvailable, false);
  assert.equal(saved.specialRequirements, "Vaste telefonische contactpersoon");
  assert.deepEqual(
    Object.keys(saved).sort(),
    Object.keys(REQUIREMENTS_WITH_INVISIBLE_FIELDS).sort(),
    "de sleutelset mag niet krimpen of groeien"
  );
});

test("regressie: lege optionele velden veroorzaken geen onbedoelde scopewijziging (geen null-sleutels bijgeschreven)", () => {
  // Fixture-vorm: hosting/maintenance/cms/deadline/customFunctionality bestaan NIET.
  const form = toFormState(FIXTURE_REQUIREMENTS);
  assert.equal(form.hosting, "unknown");
  assert.equal(form.deadline, "");
  const saved = fromFormState(form, FIXTURE_REQUIREMENTS);
  for (const key of ["hosting", "maintenance", "cms", "deadline", "customFunctionality"]) {
    assert.equal(key in saved, false, `${key} mag niet als null worden toegevoegd als het nog niet bestond`);
  }
  assert.deepEqual(saved, FIXTURE_REQUIREMENTS, "een save zonder wijziging moet de requirements exact behouden");
});

test("regressie: een save zonder inhoudelijke wijziging produceert byte-identieke requirements (JSONB-gelijkheid)", () => {
  // De 0020-guard vergelijkt `new.requirements is distinct from old.requirements`;
  // de 0010-poort vergelijkt `scope_snapshot = requirements`. Beide zijn JSONB-
  // gelijkheid, dus een no-change-save mag het object in geen enkel opzicht wijzigen.
  for (const current of [FIXTURE_REQUIREMENTS, REQUIREMENTS_WITH_INVISIBLE_FIELDS]) {
    const saved = fromFormState(toFormState(current), current);
    assert.deepEqual(saved, current);
  }
});

test("regressie: een échte requirementswijziging wijzigt de JSONB nog steeds (dus 0020-reset en snapshot-mismatch blijven werken)", () => {
  // 1. Wijziging via het formulier (pagina's 3 → 5) produceert een ander object:
  //    de DB-guard ziet dit als requirementswijziging en reset requirements_complete.
  const form = toFormState(FIXTURE_REQUIREMENTS);
  form.numberOfPages = "5";
  const changed = fromFormState(form, FIXTURE_REQUIREMENTS);
  assert.notDeepEqual(changed, FIXTURE_REQUIREMENTS, "een echte wijziging moet de requirements objectwijziging geven");
  assert.equal(changed.numberOfPages, 5);

  // 2. Expliciet "onbekend" maken van een bestaand veld is een echte wijziging
  //    (true → null volgens het contract), geen onbedoelde null-bijwerking:
  const formUnknown = toFormState({ ...FIXTURE_REQUIREMENTS, ecommerce: true });
  formUnknown.ecommerce = "unknown";
  const cleared = fromFormState(formUnknown, { ...FIXTURE_REQUIREMENTS, ecommerce: true });
  assert.equal(cleared.ecommerce, null);

  // 3. De reset-guard zelf is onveranderd in de migratie: gewijzigde requirements
  //    → requirements_complete := false.
  assert.match(
    migration0020,
    /new\.requirements is distinct from old\.requirements[\s\S]*?new\.requirements_complete := false/i,
    "de 0020-completeness-reset moet intact blijven"
  );
});

test("regressie: een save zonder wijziging laat de scope-snapshot van de prijsgoedkeuring geldig (gate-conditie onveranderd)", () => {
  // De productie-poort eist a.scope_snapshot = p.requirements (0010). Simulatie:
  // de goedgekeurde snapshot is exact de requirements ten tijde van de goedkeuring.
  const scopeSnapshot = { ...FIXTURE_REQUIREMENTS };
  const unchanged = fromFormState(toFormState(FIXTURE_REQUIREMENTS), FIXTURE_REQUIREMENTS);
  assert.deepEqual(unchanged, scopeSnapshot, "no-change-save: snapshot blijft exact gelijk");

  // Na een echte wijziging mismatcht de snapshot (gate weigert terecht):
  const form = toFormState(FIXTURE_REQUIREMENTS);
  form.copywriting = "true";
  const changed = fromFormState(form, FIXTURE_REQUIREMENTS);
  assert.notDeepEqual(changed, scopeSnapshot, "echte wijziging: snapshot-match vervalt (poort blijft dicht)");

  // De gate-conditie zelf is onveranderd in de migratie:
  assert.match(
    migration0010,
    /a\.scope_snapshot\s*=\s*p\.requirements/,
    "de 0010 productie-poort moet de scope-snapshot-vergelijking intact houden"
  );
});
