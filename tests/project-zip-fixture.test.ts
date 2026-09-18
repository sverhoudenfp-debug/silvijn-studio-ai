import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Memory-mode: nooit productie raken (zelfde patroon als de andere suites).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import {
  ZIP_FLOW_FIXTURE_MARKER,
  ZIP_FLOW_FIXTURE_NOTE_TOKEN,
  ZIP_FLOW_FIXTURE_BUSINESS_NAME,
  ZIP_FLOW_FIXTURE_REQUIREMENTS,
  isZipFlowFixtureLead,
  ProjectZipFlowFixtureService,
  ZipFlowFixtureError,
} from "../lib/testing/project-zip-fixture";
import { evaluateRequirementsCompleteness } from "../lib/projects/completeness";
import { canCreateProjectForLead } from "../lib/leads/lifecycle";
import { isLeadTransitionAllowed } from "../lib/leads/lifecycle";
import { getLeadRepository } from "../lib/repositories/lead-repository";
import { getProjectRepository } from "../lib/projects/repository";
import { getInboundMessageRepository } from "../lib/sales/repository";
import type { Lead } from "../lib/types";

const root = process.cwd();
const migration = readFileSync(
  path.join(root, "supabase/migrations/0022_zip_flow_test_fixture.sql"),
  "utf8"
);
const actionSource = readFileSync(
  path.join(root, "app/actions/project-zip-fixture.ts"),
  "utf8"
);

// ---------------------------------------------------------------------------
// 1. Fixture-requirements doorlopen alle zes blokkerende checks
// ---------------------------------------------------------------------------

test("fixture-requirements zijn compleet volgens de zes blokkerende checks", () => {
  const evaluation = evaluateRequirementsCompleteness(ZIP_FLOW_FIXTURE_REQUIREMENTS, []);
  assert.equal(evaluation.complete, true, `blockingMissing: ${evaluation.blockingMissing.join(", ")}`);
  for (const check of evaluation.checks.filter((c) => c.blocking)) {
    assert.equal(check.passed, true, `${check.key}: ${check.detail}`);
  }
});

// ---------------------------------------------------------------------------
// 2. Markering: dubbel en ondubbelzinnig
// ---------------------------------------------------------------------------

test("isZipFlowFixtureLead vereist BEIDE markeringen (prefix + note-token)", () => {
  assert.equal(
    isZipFlowFixtureLead({
      businessName: ZIP_FLOW_FIXTURE_BUSINESS_NAME,
      notes: [ZIP_FLOW_FIXTURE_NOTE_TOKEN, "uitleg"],
    }),
    true
  );
  // Alleen prefix, geen token: géén fixture (defence in depth).
  assert.equal(isZipFlowFixtureLead({ businessName: "[TEST-FIXTURE] Iets", notes: [] }), false);
  // Alleen token in notes: géén fixture.
  assert.equal(
    isZipFlowFixtureLead({ businessName: "Bakkerij Echte Klant", notes: [ZIP_FLOW_FIXTURE_NOTE_TOKEN] }),
    false
  );
  // Echte leads zijn nooit fixtures.
  assert.equal(isZipFlowFixtureLead({ businessName: "Bakkerij De Gouden Korst", notes: [] }), false);
});

test("de SQL-migratie herverifieert exact dezelfde dubbele markering", () => {
  assert.ok(migration.includes("[TEST-FIXTURE]%"), "SQL checkt de naam-prefix");
  assert.ok(migration.includes("'TESTFIXTURE-ZIP-FLOW'"), "SQL checkt het note-token");
  assert.ok(migration.includes("NOT_A_TEST_FIXTURE"), "SQL weigert niet-gemarkeerde leads");
  assert.ok(migration.includes("HUMAN_AUTHORIZATION_REQUIRED"), "SQL is owner-only");
  assert.ok(
    /revoke all on function public\.remove_zip_flow_test_fixture\(uuid\) from public, anon, service_role/.test(migration),
    "service_role en anon hebben geen execute-recht"
  );
});

// ---------------------------------------------------------------------------
// 3. De fixture routeert door de wettige, bestaande paden (static scan)
// ---------------------------------------------------------------------------

test("de fixture-action gebruikt uitsluitend wettige paden en maakt nooit een reactie", () => {
  // Wettige new→qualified transition via de bestaande owner-RPC.
  assert.match(actionSource, /transitionLead\(\{[\s\S]*?expected: "new"[\s\S]*?next: "qualified"/);
  // requirements_complete uitsluitend via de bestaande owner-RPC.
  assert.match(actionSource, /humanRpc\("set_project_requirements_complete"/);
  // Opruimen uitsluitend via de gemarkeerde SQL-functie.
  assert.match(actionSource, /humanRpc\("remove_zip_flow_test_fixture"/);
  // NOOIT een (fake) prospect-reactie of outreach.
  assert.doesNotMatch(actionSource, /record_prospect_reply|confirmProspectReply|outreachDraft|sendOutreach/i);
});

test("new→qualified is wettig zonder reactie-bewijs (guard wordt niet gerond)", () => {
  // De transition-graf staat new→qualified toe en qualified opent het projectpad.
  assert.equal(isLeadTransitionAllowed("new", "qualified"), true);
  assert.equal(canCreateProjectForLead("qualified"), true);
  // De fixture targett NOOIT de reactie-bewijs-statussen (SQL-guard 0012):
  for (const forbidden of ["interested", "demo_interested", "website_interested", "qualifying", "price_accepted"]) {
    assert.doesNotMatch(actionSource, new RegExp(`next: "${forbidden}"`), `fixture mag nooit naar ${forbidden} transitioneren`);
  }
});

// ---------------------------------------------------------------------------
// 4. Fixture-lifecycle in memory-mode
// ---------------------------------------------------------------------------

test("fixture: lead is duidelijk gemarkeerd, fictief, start als new; tweede fixture geweigerd", async () => {
  const service = new ProjectZipFlowFixtureService();
  const lead = await service.createFixtureLead();

  assert.ok(isZipFlowFixtureLead(lead), "lead moet als fixture herkenbaar zijn");
  assert.equal(lead.leadStatus, "new", "fixture-lead start via de normale repository als new");
  assert.equal(lead.source, "manual");
  assert.ok(lead.businessName.startsWith(ZIP_FLOW_FIXTURE_MARKER));
  assert.ok(lead.businessName.includes("Fictief"), "naam maakt expliciet fictief");
  assert.equal(lead.email, null, "geen e-mailadres: niets klant-zichtbaars");
  assert.equal(lead.phone, null, "geen telefoonnummer: niets klant-zichtbaars");
  assert.equal(lead.website, null);

  // Geen tweede fixture zolang er één actief is.
  await assert.rejects(
    () => service.createFixtureLead(),
    (error: unknown) => error instanceof ZipFlowFixtureError
  );

  // Wettige transition new→qualified (zoals de action via de owner-RPC doet).
  await getLeadRepository().updateStatuses(lead.id, { leadStatus: "qualified" });

  // De fixture heeft nooit een prospect-reactie nodig.
  await service.assertNoProspectReply(lead.id);
  assert.equal((await getInboundMessageRepository().listByLead(lead.id)).length, 0);

  // Project via de repository (de action gebruikt ProjectService rond
  // dezelfde repositories): fixture-requirements op het project.
  const projectRepo = getProjectRepository();
  const project = await projectRepo.create({
    leadId: lead.id,
    name: `${ZIP_FLOW_FIXTURE_MARKER} Studio Fictief`,
    projectType: null,
    description: "Fictieve fixture (intern)",
    requirements: ZIP_FLOW_FIXTURE_REQUIREMENTS,
    currency: "EUR",
    timeline: null,
    notes: "",
  });
  assert.equal((await projectRepo.getByLeadId(lead.id))?.id, project.id);

  // Listing: alleen de gemarkeerde fixture, met projectkoppeling.
  const fixtures = await service.listFixtures();
  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0].leadId, lead.id);
  assert.equal(fixtures[0].projectId, project.id);
  assert.equal(
    fixtures[0].requirementsComplete,
    false,
    "requirementsComplete wordt pas door de owner-RPC gezet (niet door de fixture zelf)"
  );
});

// ---------------------------------------------------------------------------
// 5. Echte leads worden nooit als fixture gezien of geraakt
// ---------------------------------------------------------------------------

test("fixture raakt bestaande (niet-gemarkeerde) leads niet", async () => {
  const repo = getLeadRepository();
  const before = await repo.list();
  const nonFixtureBefore = before.filter((l: Lead) => !isZipFlowFixtureLead(l));

  const service = new ProjectZipFlowFixtureService();
  const fixturesBefore = await service.listFixtures();

  // Bij een actieve fixture: nieuwe fixture geweigerd, bestaande leads onaangeroerd.
  if (fixturesBefore.length > 0) {
    await assert.rejects(
      () => service.createFixtureLead(),
      (error: unknown) => error instanceof ZipFlowFixtureError
    );
  }

  const after = await repo.list();
  const nonFixtureAfter = after.filter((l: Lead) => !isZipFlowFixtureLead(l));
  assert.deepEqual(
    nonFixtureAfter.map((l: Lead) => l.id).sort(),
    nonFixtureBefore.map((l: Lead) => l.id).sort(),
    "niet-gemarkeerde leads moeten exact onaangeroerd blijven"
  );
  // Geen enkele niet-gemarkeerde lead wordt ooit als fixture herkend.
  for (const lead of nonFixtureAfter) {
    assert.equal(isZipFlowFixtureLead(lead), false);
  }
});
