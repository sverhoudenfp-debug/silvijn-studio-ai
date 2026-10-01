import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_FIXTURE_NAME_PREFIX,
  filterProductionLeads,
  isTestLead,
  isTestLeadLinked,
  isTestLeadName,
  isTestLeadSource,
  resolveShowTestData,
  testLeadIdSet,
} from "../lib/leads/test-data";

/**
 * Testdata-scheiding (2026-10-01): de centrale regels voor wat een test-/fixture-
 * lead is en hoe productieoppervlakken ze wegfilteren. Puur module: geen
 * database, geen mocks nodig.
 */

const productionLead = { id: "11111111-1111-1111-1111-111111111111", businessName: "Diamond Painting", source: "google" };
const fixtureLead = { id: "22222222-2222-2222-2222-222222222222", businessName: "[TEST-FIXTURE] Studio Fictief (Project→ZIP flow)", source: "manual" };
const mockLead = { id: "33333333-3333-3333-3333-333333333333", businessName: "Brouwer Dakdekkers", source: "mock" };

test("naammarkering: alleen exacte [TEST-FIXTURE]-prefix geldt als testlead", () => {
  assert.equal(isTestLeadName(fixtureLead.businessName), true);
  assert.equal(isTestLeadName("Studio [TEST-FIXTURE] Fictief"), false, "prefix midden in de naam is geen markering");
  assert.equal(isTestLeadName("  " + TEST_FIXTURE_NAME_PREFIX + " met spaties"), true, "leidende witruimte mag geen bypass zijn");
  assert.equal(isTestLeadName(null), false);
  assert.equal(isTestLeadName(undefined), false);
  assert.equal(isTestLeadName(""), false);
});

test("bronnmarkering: source mock is altijd testdata", () => {
  assert.equal(isTestLeadSource("mock"), true);
  assert.equal(isTestLeadSource("google"), false);
  assert.equal(isTestLeadSource("manual"), false);
  assert.equal(isTestLeadSource("directory"), false);
  assert.equal(isTestLeadSource(null), false);
});

test("isTestLead combineert naam- en bronmarkering", () => {
  assert.equal(isTestLead(productionLead), false, "google-lead is productie");
  assert.equal(isTestLead(fixtureLead), true, "fixture via naam");
  assert.equal(isTestLead(mockLead), true, "mock-lead via bron");
  assert.equal(isTestLead({ businessName: "Echte Klant BV", source: "manual" }), false, "handmatige echte lead is productie");
});

test("filterProductionLeads houdt uitsluitend productieleads over", () => {
  const result = filterProductionLeads([productionLead, fixtureLead, mockLead]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, productionLead.id);
});

test("testLeadIdSet bevat alleen testlead-ids", () => {
  const ids = testLeadIdSet([productionLead, fixtureLead, mockLead]);
  assert.equal(ids.size, 2);
  assert.equal(ids.has(fixtureLead.id), true);
  assert.equal(ids.has(mockLead.id), true);
  assert.equal(ids.has(productionLead.id), false);
  assert.equal(testLeadIdSet([]).size, 0);
});

test("isTestLeadLinked: lege set blokkeert niets, gekoppelde records wel", () => {
  const ids = testLeadIdSet([fixtureLead]);
  assert.equal(isTestLeadLinked(ids, fixtureLead.id), true);
  assert.equal(isTestLeadLinked(ids, productionLead.id), false);
  assert.equal(isTestLeadLinked(ids, null), false);
  assert.equal(isTestLeadLinked(ids, undefined), false);
  assert.equal(isTestLeadLinked(new Set(), fixtureLead.id), false, "lege set = geen testdata, nooit alles verbergen");
});

test("resolveShowTestData: alleen ?test=1 toont testdata", () => {
  assert.equal(resolveShowTestData({ test: "1" }), true);
  assert.equal(resolveShowTestData({}), false);
  assert.equal(resolveShowTestData({ test: "true" }), false, "bewust strict: geen varianten");
  assert.equal(resolveShowTestData({ test: "0" }), false);
  assert.equal(resolveShowTestData({ test: ["1"] }), true);
  assert.equal(resolveShowTestData({ test: ["anders"] }), false);
});
