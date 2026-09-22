import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-based guard (executors.ts trekt Next/React-modules mee; bestaande
// automation-tests gebruiken hetzelfde patroon).
const src = readFileSync(new URL("../lib/automation/executors.ts", import.meta.url), "utf8");

test("G6: automation discover_leads step never starts discovery and is explicitly blocked", () => {
  const fn = src.slice(src.indexOf("export async function executeDiscoverLeads"), src.indexOf("/** SCORE_LEAD"));
  assert.match(fn, /outcome:\s*"blocked"/);
  assert.match(fn, /owner-opdracht op \/lead-discovery/);
  assert.doesNotMatch(src, /source:\s*"mock"/, "automation must not fall back to the mock discovery source");
  assert.doesNotMatch(src, /LeadDiscoveryService/, "automation no longer imports the discovery service");
  assert.doesNotMatch(fn, /createdLeadIds/, "discover step creates no leads");
});
