import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as typeof import("node:module") & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = Module._load.bind(Module);
Module._load = function intercepted(request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

import { evaluateEnvironment, envPresence, type EnvironmentObservations } from "../lib/config/environment-status";

const SECRET = "sk-ant-THIS-VALUE-MUST-NEVER-APPEAR-9f8e7d";

function obs(overrides: Partial<EnvironmentObservations> = {}): EnvironmentObservations {
  return {
    nodeEnv: "production",
    supabaseConfigured: true,
    aiConfig: { ok: true, mode: "live" },
    gmail: { configured: true, connected: true, lastIngestAt: "2026-09-22T19:00:00.000Z" },
    lastLiveAiRun: { model: "claude-sonnet-5", createdAt: "2026-09-22T18:00:00.000Z", status: "completed" },
    lastGoogleDiscoveryRun: { createdAt: "2026-09-22T17:00:00.000Z", status: "completed", createdLeads: 1 },
    ...overrides,
  };
}

test("G8: fully configured production reports every check ok (KVK info) and never leaks values", () => {
  const env = { ANTHROPIC_API_KEY: SECRET, GOOGLE_PLACES_API_KEY: SECRET, CRON_SECRET: SECRET, GMAIL_CLIENT_SECRET: SECRET } as unknown as NodeJS.ProcessEnv;
  const checks = evaluateEnvironment(env, obs());
  const byKey = Object.fromEntries(checks.map((c) => [c.key, c]));
  assert.equal(byKey.supabase.level, "ok");
  assert.equal(byKey.ai_mode.level, "ok");
  assert.equal(byKey.gmail.level, "ok");
  assert.equal(byKey.google_places.level, "ok");
  assert.equal(byKey.kvk.level, "info");
  assert.equal(byKey.cron_secret.level, "ok");
  assert.equal(byKey.discovery_mock.level, "ok");
  assert.match(byKey.ai_mode.evidence ?? "", /claude-sonnet-5/);
  assert.match(byKey.google_places.evidence ?? "", /1 lead/);
  assert.doesNotMatch(JSON.stringify(checks), /9f8e7d|NEVER-APPEAR/, "env values must never appear in output");
});

test("G8: missing configuration is reported as missing/warning with actionable detail", () => {
  const checks = evaluateEnvironment({} as unknown as NodeJS.ProcessEnv, obs({
    supabaseConfigured: false,
    aiConfig: { ok: false, error: "AI_MODE ontbreekt in de productie-omgeving" },
    gmail: { configured: false, connected: false, lastIngestAt: null },
    lastLiveAiRun: null,
    lastGoogleDiscoveryRun: null,
  }));
  const byKey = Object.fromEntries(checks.map((c) => [c.key, c]));
  assert.equal(byKey.supabase.level, "missing");
  assert.equal(byKey.ai_mode.level, "missing");
  assert.match(byKey.ai_mode.detail, /AI_MODE ontbreekt/);
  assert.equal(byKey.gmail.level, "missing");
  assert.equal(byKey.google_places.level, "missing");
  assert.equal(byKey.cron_secret.level, "missing");
});

test("G8: live without Anthropic key is missing; mock in production is a warning; gmail configured but unconnected is a warning", () => {
  const a = Object.fromEntries(evaluateEnvironment({} as unknown as NodeJS.ProcessEnv, obs()).map((c) => [c.key, c]));
  assert.equal(a.ai_mode.level, "missing");
  const b = Object.fromEntries(evaluateEnvironment({ ANTHROPIC_API_KEY: "x" } as unknown as NodeJS.ProcessEnv, obs({ aiConfig: { ok: true, mode: "mock" } })).map((c) => [c.key, c]));
  assert.equal(b.ai_mode.level, "warning");
  const c = Object.fromEntries(evaluateEnvironment({} as unknown as NodeJS.ProcessEnv, obs({ gmail: { configured: true, connected: false, lastIngestAt: null } })).map((c) => [c.key, c]));
  assert.equal(c.gmail.level, "warning");
  assert.equal(envPresence({ X: "  " } as unknown as NodeJS.ProcessEnv, "X"), false);
  assert.equal(envPresence({ X: "v" } as unknown as NodeJS.ProcessEnv, "X"), true);
});

test("G8: module only reads presence — source guard", () => {
  const src = readFileSync(new URL("../lib/config/environment-status.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\.slice\(|\.substring\(|\.length\b/, "no partial values or lengths of secrets");
  assert.doesNotMatch(src, /console\.log/);
});
