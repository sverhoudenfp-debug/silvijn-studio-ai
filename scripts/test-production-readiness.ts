/**
 * Fase 12 — productie-readiness tests.
 * Dekking:
 *  1. Fail-loud AI-config: productie zonder AI_MODE crasht (geen stille mock).
 *  2. Expliciete mock-mode in productie is toegestaan.
 *  3. Prompt-injection-hardening: alle agent-prompts behandelen externe data als data.
 *  4. Repository-leesmethodes (analytics) bestaan op beide sinks.
 */

import { readFileSync } from "node:fs";
import { getAIConfig } from "../lib/ai/config";
import { AIConfigurationError } from "../lib/ai/errors";
import { getAIRunRepository, MemoryAIRunRepository, SupabaseAIRunRepository } from "../lib/repositories/ai-run-repository";
import { getAIActivityRepository } from "../lib/repositories/ai-activity-repository";
import { getAgencyAnalytics } from "../lib/services/analytics";

let failures = 0;
function check(name: string, condition: boolean) {
  console.log(`${condition ? "✓" : "✗"} ${name}`);
  if (!condition) failures++;
}

// ---- 1. Fail-loud: productie zonder AI_MODE ----
{
  const savedNodeEnv = process.env.NODE_ENV;
  const savedMode = process.env.AI_MODE;
  delete process.env.AI_MODE;
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  try {
    getAIConfig();
    check("productie zonder AI_MODE gooit AIConfigurationError", false);
  } catch (e) {
    check(
      "productie zonder AI_MODE gooit AIConfigurationError",
      e instanceof AIConfigurationError
    );
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = savedNodeEnv;
    if (savedMode !== undefined) process.env.AI_MODE = savedMode;
  }
}

// ---- 2. Expliciete mock-mode in productie is toegestaan ----
{
  const savedNodeEnv = process.env.NODE_ENV;
  const savedMode = process.env.AI_MODE;
  process.env.AI_MODE = "mock";
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  try {
    const config = getAIConfig();
    check("productie met AI_MODE=mock → expliciete mock (geen crash)", config.mode === "mock");
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = savedNodeEnv;
    if (savedMode === undefined) delete process.env.AI_MODE;
    else process.env.AI_MODE = savedMode;
  }
}

// ---- 3. Prompt-injection-hardening (statisch: alle agents) ----
{
  const serviceSource = readFileSync(new URL("../lib/ai/service.ts", import.meta.url), "utf8");
  const systemConsts = [
    "WEBSITE_PLANNING_SYSTEM",
    "WEBSITE_QC_SYSTEM",
    "REQUIREMENTS_SYSTEM",
    "SALES_SYSTEM",
    "OUTREACH_SYSTEM",
    "BUSINESS_ANALYSIS_SYSTEM",
  ];
  for (const name of systemConsts) {
    const match = serviceSource.match(new RegExp(`const ${name} = \`([^\`]*)\``, "s"));
    check(`${name} bevat untrusted-data-regel`, Boolean(match && match[1].includes("ONBETROUWBARE DATA")));
  }
  check("business-analysis prompt gebruikt <onbetrouwbaar>-delimiters", serviceSource.includes("<onbetrouwbaar>"));
  check("sales prompt omringt inbound body met delimiters", serviceSource.includes("input.inbound.body,\n    \"</onbetrouwbaar>\""));
}

// ---- 4. Analytics: repository-leesmethodes ----
{
  check("AIRunRepository.listRecent bestaat (interface + sinks)", typeof getAIRunRepository().listRecent === "function" && typeof new SupabaseAIRunRepository().listRecent === "function");
  check("MemoryAIRunRepository.listRecent bestaat", typeof new MemoryAIRunRepository().listRecent === "function");
  check("AIActivityRepository.listRecent bestaat", typeof getAIActivityRepository().listRecent === "function");
}

// ---- 5. Analytics-aggregatie (mock-sinks; geen data → geen crash) ----
async function main() {
  const analytics = await getAgencyAnalytics();
  check("analytics: leads.total is een getal", typeof analytics.leads.total === "number");
  check("analytics: ai.totalCostUsd is een getal", typeof analytics.ai.totalCostUsd === "number");
  check("analytics: automation.averageDurationMs is getal of null", analytics.automation.averageDurationMs === null || typeof analytics.automation.averageDurationMs === "number");
  check("analytics: costPerLead is null zonder data of getal", analytics.ai.costPerLead === null || typeof analytics.ai.costPerLead === "number");

  console.log(failures === 0 ? "\nALLE FASE-12 TESTS GESLAAGD" : `\n${failures} TESTS GEFAALD`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
