import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DiscoveryInputError, validateDiscoveryCommand, DiscoveryOrchestrator } from "../lib/discovery/orchestrator";
import { scorePriority } from "../lib/discovery/run-types";
import { MockDiscoveryRunRepository, type DiscoveryRunRepository } from "../lib/repositories/discovery-run-repository";
import { getLeadRepository } from "../lib/repositories/lead-repository";

/**
 * Fase D: Discovery-orchestratie. Veilige testdata uitsluitend — de mock
 * provider levert fictieve testbedrijven; er is geen Supabase, mail of AI
 * aangesloten tijdens deze tests.
 */

const owner = "10000000-0000-4000-8000-0000000000d1";

// VEILIGHEID: deze tests draaien uitsluitend in de veilige mock-omgeving.
// Supabase-variabelen worden actief gewist (zelfde patroon als
// automation-runtime.test.ts), zodat geen enkele test productiedata raakt.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const migration = readFileSync("supabase/migrations/0017_discovery_runs.sql", "utf8");

test("command validation requires at least industry, city, province or query", () => {
  assert.throws(
    () => validateDiscoveryCommand({ ownerUserId: owner, country: "NL", source: "mock", limit: 20 }),
    DiscoveryInputError
  );
  const byIndustry = validateDiscoveryCommand({ ownerUserId: owner, country: "NL", industry: "Restaurants", source: "mock", limit: 20 });
  assert.equal(byIndustry.industry, "Restaurants");
  assert.equal(byIndustry.city, null);
  const byCity = validateDiscoveryCommand({ ownerUserId: owner, country: "NL", city: "Eindhoven", source: "mock", limit: 20 });
  assert.equal(byCity.city, "Eindhoven");
  assert.match(byCity.command, /Start lead discovery voor Eindhoven/);
});

test("command validation normalizes country, caps the limit and builds a readable command", () => {
  const validated = validateDiscoveryCommand({
    ownerUserId: owner,
    country: " nl ",
    industry: "Restaurants",
    city: "Eindhoven",
    source: "mock",
    limit: 500,
  });
  assert.equal(validated.country, "NL");
  assert.equal(validated.effectiveLimit, 50); // MAX_DISCOVERY_RESULTS default
  assert.equal(validated.requestedLimit, 200); // afgetopt naar de database-check (1-200)
  assert.match(validated.command, /Restaurants in Eindhoven/);
  assert.match(validated.command, /limiet: 50/);
  assert.throws(
    () => validateDiscoveryCommand({ ownerUserId: owner, country: "NLD", industry: "Restaurants", source: "mock", limit: 20 }),
    DiscoveryInputError
  );
});

test("score priority bands are stable and documented", () => {
  assert.equal(scorePriority(90), "hoog");
  assert.equal(scorePriority(70), "hoog");
  assert.equal(scorePriority(69), "middel");
  assert.equal(scorePriority(40), "middel");
  assert.equal(scorePriority(39), "laag");
  assert.equal(scorePriority(0), "laag");
});

test("orchestrator runs a safe mock discovery end-to-end and records the command", async () => {
  const runs: DiscoveryRunRepository = new MockDiscoveryRunRepository();
  const leadRepository = getLeadRepository();
  assert.equal(leadRepository.source, "mock", "deze tests vereisen de veilige mock-omgeving");

  const before = (await leadRepository.list()).length;
  const orchestrator = new DiscoveryOrchestrator(runs);
  const result = await orchestrator.runCommand({
    ownerUserId: owner,
    country: "NL",
    industry: "Dakwerken",
    source: "mock",
    limit: 20,
  });

  assert.equal(result.status, "completed");
  assert.ok(result.runId);
  assert.ok(result.discovery);
  assert.equal(result.discovery.errors.length, 0);
  const after = await leadRepository.list();
  assert.equal(after.length - before, result.discovery.createdLeads);
  assert.ok(result.discovery.createdLeads >= 1, "Dakwerken levert minimaal één nieuwe lead");
  assert.ok(result.discovery.duplicatesSkipped >= 1, "bekende Jansen-duplicaten worden overgeslagen");

  // Elke aangemaakte lead heeft een score/prioriteit-samenvatting met de
  // bestaande rule-based score (0-100).
  for (const entry of result.createdLeadSummaries) {
    const lead = after.find((l) => l.id === entry.leadId);
    assert.ok(lead);
    assert.equal(entry.score, lead.leadScore);
    assert.ok(entry.score >= 0 && entry.score <= 100);
    assert.ok(["hoog", "middel", "laag"].includes(entry.priority));
  }

  // Het command-record is vastgelegd met tellingen.
  const [run] = await runs.list(1);
  assert.equal(run.status, "completed");
  assert.equal(run.command, result.command);
  assert.equal(run.createdLeads, result.discovery.createdLeads);
  assert.equal(run.duplicatesSkipped, result.discovery.duplicatesSkipped);
  assert.equal(run.createdLeadIds.length, result.createdLeadSummaries.length);
  assert.ok(run.completedAt);
});

test("a second identical command safely skips the leads created by the first run", async () => {
  const runs: DiscoveryRunRepository = new MockDiscoveryRunRepository();
  const input = {
    ownerUserId: owner,
    country: "NL",
    industry: "Loodgieters",
    source: "mock" as const,
    limit: 20,
  };
  const orchestrator = new DiscoveryOrchestrator(runs);

  const first = await orchestrator.runCommand(input);
  assert.equal(first.status, "completed");
  const firstCreated = first.discovery?.createdLeads ?? 0;
  assert.ok(firstCreated > 0, "mock provider levert kandidaten");

  const second = await orchestrator.runCommand(input);
  assert.equal(second.status, "completed");
  assert.equal(second.discovery?.createdLeads ?? -1, 0, "bestaande leads worden veilig overgeslagen");
  assert.ok((second.discovery?.duplicatesSkipped ?? 0) >= firstCreated, "eerdere leads tellen als duplicaat");
  const duplicateReasons = Object.values(second.createdLeadSummaries);
  assert.equal(duplicateReasons.length, 0);

  // Beide expliciete opdrachten staan als aparte runs in de geschiedenis.
  const history = await runs.list(10);
  assert.equal(history.length, 2);
  assert.equal(history[0].status, "completed");
  assert.equal(history[1].status, "completed");
});

test("a provider without configuration fails the run visibly instead of inventing data", async () => {
  const runs: DiscoveryRunRepository = new MockDiscoveryRunRepository();
  const orchestrator = new DiscoveryOrchestrator(runs);
  const result = await orchestrator.runCommand({
    ownerUserId: owner,
    country: "NL",
    industry: "Restaurants",
    city: "Eindhoven",
    source: "google",
    limit: 20,
  });

  assert.equal(result.status, "failed");
  assert.ok(result.discovery, "discover vangt de providerfout veilig af in het resultaat");
  assert.equal(result.discovery.totalFound, 0);
  assert.ok(result.errors.some((error) => error.includes("MISSING CONFIGURATION")));
  const [run] = await runs.list(1);
  assert.equal(run.status, "failed");
  assert.deepEqual(run.createdLeadIds, []);
  assert.ok(run.errors.some((error) => error.includes("MISSING CONFIGURATION")));
  // Er is geen enkele lead verzonnen of aangemaakt door de mislukte run.
  assert.deepEqual(run.createdLeadIds, []);
});

test("the orchestrator never touches outreach: discovery result contains only lead-side statuses", async () => {
  const runs: DiscoveryRunRepository = new MockDiscoveryRunRepository();
  const orchestrator = new DiscoveryOrchestrator(runs);
  const result = await orchestrator.runCommand({
    ownerUserId: owner,
    country: "NL",
    city: "Venlo",
    source: "mock",
    limit: 20,
  });
  assert.equal(result.status, "completed");
  assert.ok(result.createdLeadSummaries.length >= 1, "Venlo levert een nieuwe lead");
  const leadRepository = getLeadRepository();
  const created = await leadRepository.list();
  for (const lead of created) {
    if (result.createdLeadSummaries.some((entry) => entry.leadId === lead.id)) {
      assert.equal(lead.outreachStatus, "not_contacted");
      assert.equal(lead.leadStatus, "new");
    }
  }
});

test("migrations and RLS follow the studio security pattern (owner read, service-role write only)", () => {
  assert.match(migration, /create table if not exists public\.discovery_runs/);
  assert.match(migration, /alter table public\.discovery_runs enable row level security/);
  assert.match(migration, /create policy discovery_runs_owner_read[\s\S]*?using \(public\.is_studio_owner\(\)\)/);
  assert.match(migration, /revoke insert, update, delete on public\.discovery_runs from authenticated, anon/);
  assert.match(migration, /check \(source in \('mock','google','directory'\)\)/);
  assert.match(migration, /check \(status in \('running','completed','failed'\)\)/);
  // Command-record vereist altijd een owner: geen anonieme of AI-gegenereerde opdracht.
  assert.match(migration, /owner_user_id uuid not null references auth\.users\(id\)/);
});

test("existing lead pipeline is reused: orchestrator composes, does not duplicate the engine", () => {
  const orchestratorSource = readFileSync("lib/discovery/orchestrator.ts", "utf8");
  assert.match(orchestratorSource, /LeadDiscoveryService/);
  assert.match(orchestratorSource, /getLeadRepository\(\)/);
  assert.doesNotMatch(orchestratorSource, /from\("leads"\)/);
  assert.doesNotMatch(orchestratorSource, /outreach_drafts|sendOutreach|gmail/i);
});
