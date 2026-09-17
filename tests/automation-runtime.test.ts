import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Automation Runtime — productie-drain op de bestaande engine.
 *
 * Unit-tests (hier) draaien volledig in memory-mode (mock-repositories):
 * de runtime hergebruikt de bestaande orchestrator/queue/guards. Live
 * database-atomariteit (SKIP LOCKED, stale-reclaim, rechten) staat in
 * scripts/test-automation-runtime.sql tegen de productiedatabase.
 *
 * HARDE GRENSen die deze tests bewaken:
 *   - human gates pauzeren de run; het queue-item wordt NIIT herkans;
 *   - permanente fouten worden nooit automatisch herkansd;
 *   - inactieve automations worden niet gerund, alleen gemarkeerd;
 *   - send_outreach blijft altijd waiting_for_human (capability matrix);
 *   - autonomieniveau 0 blokkeert alle uitvoer.
 */

const ENV_BACKUP: Record<string, string | undefined> = {};

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in ENV_BACKUP)) ENV_BACKUP[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test.after(() => {
  for (const [key, value] of Object.entries(ENV_BACKUP)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/**
 * next/navigation / next/headers zijn Next-serverprimitives die buiten een
 * Next-runtime niet bestaan (de echte orchestrator-keten importeert via de
 * services auth/server). Voor de unit-tests worden deze modules gestubd;
 * binnen deze testpaden worden ze nooit aangeroepen (score_lead is
 * deterministisch, human-gate/send_outreach worden vóór dispatch geblokkeerd).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as typeof import("node:module") & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = Module._load.bind(Module);
Module._load = function intercepted(request: string, parent: unknown, isMain: boolean) {
  if (request === "next/navigation" || request === "next/headers" || request === "server-only") {
    return {
      redirect: () => {
        throw new Error("redirect in testcontext aangeroepen — niet ondersteund");
      },
      cookies: async () => {
        throw new Error("cookies in testcontext aangeroepen — niet ondersteund");
      },
    };
  }
  return originalLoad(request, parent, isMain);
};

// Memory-mode afdwingen vóór enige repository-import (anders valt de app
// terug op de geconfigureerde Supabase-instantie uit de omgeving).
setEnv({
  NEXT_PUBLIC_SUPABASE_URL: undefined,
  SUPABASE_SECRET_KEY: undefined,
  AUTOMATION_AUTONOMY_LEVEL: "1",
});

const CONFIG = {
  enabled: true,
  maxItemsPerDrain: 10,
  timeBudgetMs: 60_000,
  maxQueueAttempts: 3,
  staleAfterMs: 30_000,
};

interface Modules {
  runtime: typeof import("../lib/automation/runtime");
  queue: typeof import("../lib/automation/queue");
  repos: typeof import("../lib/automation/repositories");
  orchestrator: typeof import("../lib/automation/orchestrator");
  types: typeof import("../lib/automation/types");
}

let mods: Modules;

test.before(async () => {
  // Na env-setup: modules lazily laden (singletons binden aan memory-mode).
  const runtime = await import("../lib/automation/runtime");
  const queue = await import("../lib/automation/queue");
  const repos = await import("../lib/automation/repositories");
  const orchestrator = await import("../lib/automation/orchestrator");
  const types = await import("../lib/automation/types");
  mods = { runtime, queue, repos, orchestrator, types };
});

async function registerAutomation(
  id: string,
  steps: import("../lib/automation/types").AutomationStepDefinition[] = [],
  active = true
) {
  await mods.repos.getAutomationRepository().upsertIfAbsent({
    id,
    name: `Test ${id}`,
    description: "runtime test automation",
    type: "lead_pipeline",
    status: active ? "active" : "paused",
    enabled: active,
    trigger: "manual",
    steps,
    currentStep: null,
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    lastRunAt: null,
    nextRunAt: null,
  });
}

function stepOf(
  type: import("../lib/automation/types").AutomationStepType,
  gate?: string
): import("../lib/automation/types").AutomationStepDefinition {
  return {
    id: `step-${type}`,
    type,
    name: `Step ${type}`,
    description: "test",
    requiredAutonomy: 1,
    timeoutMs: 10_000,
    maxRetries: 0,
    ...(gate ? { gate: gate as never, waitForHuman: true } : {}),
  } as import("../lib/automation/types").AutomationStepDefinition;
}

/** Stub-runner: de runtime-dependency die de echte orchestrator ook vervult. */
type AutomationRunner = import("../lib/automation/runtime").AutomationRunner;
class StubRunner implements AutomationRunner {
  calls: { automationId: string; entityId: string | null }[] = [];
  behavior: "ok" | "paused" | Error = "ok";
  async runAutomation(automationId: string, entityId: string | null): Promise<import("../lib/automation/types").AutomationRun> {
    this.calls.push({ automationId, entityId });
    if (this.behavior instanceof Error) throw this.behavior;
    const run = {
      id: `stub-run-${this.calls.length}`,
      status: this.behavior === "paused" ? "paused" : "completed",
      error: null,
    } as unknown as import("../lib/automation/types").AutomationRun;
    return run;
  }
}

async function makeRuntime(runner: import("../lib/automation/runtime").AutomationRunner) {
  return new mods.runtime.AutomationRuntime(runner, new mods.queue.AutomationQueue());
}

async function enqueue(automationId: string, entityId: string | null) {
  return new mods.queue.AutomationQueue().enqueue({
    automationId,
    entityId,
    entityType: entityId ? "lead" : "none",
    triggerEvent: "manual",
  });
}

async function assertQueueEmpty() {
  const items = await new mods.queue.AutomationQueue().list(200);
  const open = items.filter((i) => i.status === "queued" || i.status === "processing");
  assert.equal(open.length, 0, `queue moet leeg zijn na drain, open: ${JSON.stringify(open)}`);
}

// ---------------------------------------------------------------------------
// 1. Kill-switch + configuratie
// ---------------------------------------------------------------------------
test("runtime-kill-switch: AUTOMATION_RUNTIME_ENABLED=false draait niets", async () => {
  const runner = new StubRunner();
  const runtime = await makeRuntime(runner);
  const item = await enqueue("test-disabled", null);
  const result = await runtime.drain({ ...CONFIG, enabled: false });
  assert.equal(result.disabled, true);
  assert.equal(result.claimed, 0);
  assert.equal(runner.calls.length, 0);
  // Kill-switch laat de queue onaangeroerd:
  const stored = await new mods.queue.AutomationQueue().list(10);
  assert.equal(stored.find((i) => i.id === item.id)?.status, "queued");
  // Opruimen voor volgende tests:
  await runtime.drain(CONFIG);
  await assertQueueEmpty();
});

// ---------------------------------------------------------------------------
// 2. Happy path via de ECHTE orchestrator (guards/capability matrix actief)
// ---------------------------------------------------------------------------
test("drain verwerkt een queued item via de echte orchestrator tot voltooiing", async () => {
  await registerAutomation("test-score", [stepOf("score_lead")]);
  const { getLeadRepository } = await import("../lib/repositories/lead-repository");
  const lead = (await getLeadRepository().list())[0];
  assert.ok(lead, "memory-mode seedt leads");

  const runtime = await makeRuntime(new mods.orchestrator.AutomationOrchestrator());
  await enqueue("test-score", lead.id);
  const result = await runtime.drain(CONFIG);

  assert.equal(result.claimed, 1);
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.retried, 0);
  const outcome = result.items[0];
  assert.equal(outcome.outcome, "completed");
  assert.equal(outcome.runStatus, "completed");
  assert.ok(outcome.runId);
  await assertQueueEmpty();
});

// ---------------------------------------------------------------------------
// 3. Human gate → run paused → item AFGEROND, nooit herkans
// ---------------------------------------------------------------------------
test("human gate pauzeert de run; het queue-item wordt afgerond zonder retry", async () => {
  await registerAutomation("test-gate", [stepOf("wait_for_human", "website_approval")]);
  const runtime = await makeRuntime(new mods.orchestrator.AutomationOrchestrator());
  await enqueue("test-gate", "ld-does-not-matter");
  const result = await runtime.drain(CONFIG);

  assert.equal(result.completed, 1);
  assert.equal(result.retried, 0);
  const outcome = result.items[0];
  assert.equal(outcome.runStatus, "paused");
  assert.match(outcome.detail, /human gate/i);
  await assertQueueEmpty();
});

// ---------------------------------------------------------------------------
// 4. send_outreach blijft ALTIJD waiting_for_human (capability matrix)
// ---------------------------------------------------------------------------
test("send_outreach kan door de runtime nooit worden uitgevoerd", async () => {
  await registerAutomation("test-outreach", [stepOf("send_outreach")]);
  const runtime = await makeRuntime(new mods.orchestrator.AutomationOrchestrator());
  await enqueue("test-outreach", "ld-1");
  const result = await runtime.drain(CONFIG);

  const outcome = result.items[0];
  assert.equal(outcome.outcome, "completed");
  assert.equal(outcome.runStatus, "paused");
  // De run start niet en voert niets uit; alleen de wacht-staat blijft:
  const run = await mods.repos.getAutomationRunRepository().getById(outcome.runId!);
  assert.equal(run?.waitingReason ?? run?.error, run?.waitingReason);
  assert.match(run?.waitingReason ?? "", /menselijke actie/i);
  await assertQueueEmpty();
});

// ---------------------------------------------------------------------------
// 5. Transiente fout → herkansing met pogingen+1
// ---------------------------------------------------------------------------
test("tijdelijke fout gaat terug naar de queue met pogingen+1", async () => {
  await registerAutomation("test-transient");
  const runner = new StubRunner();
  runner.behavior = new Error("network connection timeout tijdens provider-call");
  const runtime = await makeRuntime(runner);
  await enqueue("test-transient", null);
  const result = await runtime.drain(CONFIG);

  assert.equal(result.retried, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.items[0].attempts, 1);
  const queuedItem = (await new mods.queue.AutomationQueue().list(10)).find(
    (i) => i.automationId === "test-transient" && i.status === "queued"
  );
  assert.ok(queuedItem, "item moet terug in de queue staan");
  assert.match(queuedItem!.error!, /timeout/i);

  // Volgende drain slaagt → item voltooid:
  runner.behavior = "ok";
  const second = await runtime.drain(CONFIG);
  assert.equal(second.completed, 1);
  await assertQueueEmpty();
});

// ---------------------------------------------------------------------------
// 6. Permanente fout → definitief faal, GEEN automatische herkansing
// ---------------------------------------------------------------------------
test("permanente fout (guard/menselijke gate) faalt definitief zonder retry", async () => {
  await registerAutomation("test-permanent");
  const runner = new StubRunner();
  runner.behavior = new Error("guard: menselijke goedkeuring vereist — unauthorized");
  const runtime = await makeRuntime(runner);
  await enqueue("test-permanent", null);
  const result = await runtime.drain(CONFIG);

  assert.equal(result.failed, 1);
  assert.equal(result.retried, 0);
  const failedItem = (await new mods.queue.AutomationQueue().list(10)).find((i) => i.automationId === "test-permanent");
  assert.equal(failedItem?.status, "failed");
  assert.match(failedItem?.error ?? "", /guard/i);
});

// ---------------------------------------------------------------------------
// 7. Max pogingen → definitief faal
// ---------------------------------------------------------------------------
test("na max pogingen faalt een transiente fout definitief", async () => {
  await registerAutomation("test-maxattempts");
  const runner = new StubRunner();
  runner.behavior = new Error("network connection timeout");
  const runtime = await makeRuntime(runner);
  await enqueue("test-maxattempts", null);

  const drain1 = await runtime.drain(CONFIG);
  assert.equal(drain1.retried, 1);
  const drain2 = await runtime.drain(CONFIG);
  assert.equal(drain2.retried, 1);
  const drain3 = await runtime.drain(CONFIG);
  // Derde poging (attempts 3 = max) → definitief faal:
  assert.equal(drain3.failed, 1);
  assert.equal(drain3.retried, 0);
  assert.match(drain3.items[0].detail, /max pogingen/i);
  await assertQueueEmpty();
});

// ---------------------------------------------------------------------------
// 8. Inactieve automation → item faalt, run wordt NIET gestart
// ---------------------------------------------------------------------------
test("inactieve/gepauzeerde automation wordt niet gerund — item faalt expliciet", async () => {
  await registerAutomation("test-inactive", [stepOf("score_lead")], false);
  const runner = new StubRunner();
  const runtime = await makeRuntime(runner);
  await enqueue("test-inactive", null);
  const result = await runtime.drain(CONFIG);

  assert.equal(result.failed, 1);
  assert.equal(runner.calls.length, 0, "er mag geen run zijn gestart");
  assert.match(result.items[0].detail, /niet actief/i);
  await assertQueueEmpty();
});

// ---------------------------------------------------------------------------
// 9. Stale 'processing' wordt teruggewonnen met pogingen+1
// ---------------------------------------------------------------------------
test("vastgelopen processing-item wordt teruggewonnen (crash-herstel)", async () => {
  const runner = new StubRunner();
  runner.behavior = new Error("network connection timeout");
  const runtime = await makeRuntime(runner);
  const item = await enqueue("test-stale", null);
  // Handmatig op 'processing' met oud claimedAt (simuleert crash):
  const repo = mods.repos.getAutomationQueueRepository();
  await repo.update(item.id, {
    status: "processing",
    claimedAt: new Date(Date.now() - 60_000).toISOString(),
  });

  const result = await runtime.drain({ ...CONFIG, staleAfterMs: 30_000 });
  assert.equal(result.reclaimed, 1);
  // Na reclaim wordt het item meteen opnieuw gepakt door dezelfde drain:
  assert.ok(result.claimed >= 1);
  const stored = (await new mods.queue.AutomationQueue().list(10)).find((i) => i.id === item.id);
  assert.ok(["queued", "completed", "failed"].includes(stored?.status ?? ""));
  await runtime.drain(CONFIG);
  await assertQueueEmpty();
});

// ---------------------------------------------------------------------------
// 10. Dubbele enqueue voor hetzelfde automation+entity → één item
// ---------------------------------------------------------------------------
test("enqueue is idempotent voor hetzelfde automation+entity", async () => {
  const first = await enqueue("test-dedupe", "ld-1");
  const second = await enqueue("test-dedupe", "ld-1");
  assert.equal(first.id, second.id);
  // Opruimen voor de volgende test (automation niet geregistreerd → faalt netjes):
  await (await makeRuntime(new StubRunner())).drain(CONFIG);
  await assertQueueEmpty();
});

// ---------------------------------------------------------------------------
// 11. Autonomieniveau 0 → geen enkele step-uitvoer
// ---------------------------------------------------------------------------
test("autonomieniveau 0 blokkeert alle automatische step-uitvoering", async () => {
  setEnv({ AUTOMATION_AUTONOMY_LEVEL: "0" });
  try {
    // Eerdere test-runs staan (terecht) gepauzeerd op human gates; sluit ze
    // af zodat de technische concurrency-limiet deze run niet blokkeert:
    const runRepo = mods.repos.getAutomationRunRepository();
    for (const run of await runRepo.list(50)) {
      if (run.status === "paused" || run.status === "running") {
        await runRepo.update(run.id, { status: "cancelled", completedAt: new Date().toISOString() });
      }
    }
    await registerAutomation("test-manual", [stepOf("score_lead")]);
    const runtime = await makeRuntime(new mods.orchestrator.AutomationOrchestrator());
    await enqueue("test-manual", "ld-1");
    const result = await runtime.drain(CONFIG);
    const outcome = result.items[0];
    assert.equal(outcome.outcome, "completed");
    assert.equal(outcome.runStatus, "blocked");
    await assertQueueEmpty();
  } finally {
    setEnv({ AUTOMATION_AUTONOMY_LEVEL: "1" });
  }
});

// ---------------------------------------------------------------------------
// 12. Fail-loud productiecheck (geen mock-repositories in productie)
// ---------------------------------------------------------------------------
test("assertProductionRuntimeConfigured faalt luidruchtig zonder Supabase in productie", async () => {
  setEnv({ NODE_ENV: "production" });
  try {
    assert.throws(() => mods.runtime.assertProductionRuntimeConfigured(), /BLOCKED_EXTERNAL_CONFIGURATION|Supabase/);
  } finally {
    setEnv({ NODE_ENV: undefined });
  }
});

// ---------------------------------------------------------------------------
// 13. Cron-endpoint + vercel-cron: statische guarantees
// ---------------------------------------------------------------------------
test("cron-endpoint is fail-loud beveiligd en de Vercel-cron staat juist geconfigureerd", () => {
  const route = readFileSync("app/api/cron/automation-runtime/route.ts", "utf8");
  assert.match(route, /BLOCKED_EXTERNAL_CONFIGURATION/);
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /is_studio_owner/);
  // De endpoint bevat geen eigen uitvoerlogica — alleen de bestaande runtime:
  assert.match(route, /new AutomationRuntime\(new AutomationOrchestrator\(\), new AutomationQueue\(\)\)/);
  assert.doesNotMatch(route, /enqueue|discover_leads|sendEmail|createDraft/);

  const vercel = readFileSync("vercel.json", "utf8");
  const parsed = JSON.parse(vercel);
  assert.equal(parsed.crons[0].path, "/api/cron/automation-runtime");
  assert.ok(parsed.crons[0].schedule.length > 0);
});

// ---------------------------------------------------------------------------
// 14. Migratie: atomair claimen + stale-reclaim + rechten op de database
// ---------------------------------------------------------------------------
test("migratie 0016 bevat SKIP LOCKED-claim, stale-reclaim en service-role-restrictie", () => {
  const migration = readFileSync("supabase/migrations/0016_automation_runtime.sql", "utf8");
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /claim_next_automation_queue_item/);
  assert.match(migration, /reclaim_stale_processing_items/);
  assert.match(migration, /revoke all on function public\.claim_next_automation_queue_item\(\) from public, anon, authenticated/);
  assert.match(migration, /add column if not exists claimed_at/);
  // Queue-uitkomsten zijn typed events (audit):
  for (const evt of ["queue_item_claimed", "queue_item_completed", "queue_item_retried", "queue_item_failed", "queue_item_reclaimed"]) {
    assert.ok(migration.includes(`'${evt}'`), evt);
  }
});
