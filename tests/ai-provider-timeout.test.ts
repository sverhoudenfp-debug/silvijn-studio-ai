import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Memory-mode: nooit productie raken (zelfde patroon als de andere suites).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "../lib/ai/anthropic";
import { getAIConfig } from "../lib/ai/config";
import {
  AIConfigurationError,
  AIProviderError,
  AITimeoutError,
} from "../lib/ai/errors";

const root = process.cwd();
const actionSource = readFileSync(path.join(root, "app/actions/design-plans.ts"), "utf8");
const sectionSource = readFileSync(
  path.join(root, "components/projects/design-plan-section.tsx"),
  "utf8"
);

/**
 * REGRESSIETEST (productiebug 2026-09-19, [TEST-FIXTURE] Design Plan v1):
 * "Minified React error #441" op de projectpagina na "Genereer Design Plan".
 *
 * Exacte oorzaak (live gemeten): de designplanning-call duurde ~34s, boven de
 * toen hardcoded 30s-timeout. De provider wachtte het antwoord af, gooide het
 * nú achteraf weg (AITimeoutError), hermapte die via mapAnthropicError naar
 * het generieke "Onbekende Anthropic-fout", herprobeerde 2x (elke poging
 * faalde identiek, ~100s "even bezig"), en de action-throw maskeerde
 * React/Next in productie tot #441 zonder oorzaak.
 *
 * Deze suite bewaakt de drie fixpunten:
 * 1. provider: echte abort bij de limiet en AIError-klassen gaan onveranderd door;
 * 2. config: de timeout is niet langer een te krappe hardcoded 30s;
 * 3. action/UI: verwachte fouten tonen hun échte reden inline i.p.v. #441.
 */

beforeEach(() => {
  process.env.AI_MODE = "live";
  process.env.ANTHROPIC_API_KEY = "test-key-regression-only";
  delete process.env.AI_REQUEST_TIMEOUT_MS;
});

afterEach(() => {
  delete process.env.AI_MODE;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_REQUEST_TIMEOUT_MS;
});

function stubbedProvider(
  create: (body: unknown, options: { signal?: AbortSignal } | undefined) => Promise<unknown>
): AnthropicProvider {
  const provider = new AnthropicProvider();
  // SDK-client vervangen: geen netwerk, het echte abort-gedrag blijft behouden.
  (provider as unknown as { client: unknown }).client = { messages: { create } };
  return provider;
}

const REQUEST = {
  task: "design_planning" as const,
  model: "claude-sonnet-5",
  system: "system",
  prompt: "prompt",
  maxTokens: 4000,
  temperature: 0.4,
};

test("config: request-timeout default is 120s — boven de gemeten 84,4s designplanning (Velora v3, 2026-09-19)", () => {
  const config = getAIConfig();
  assert.equal(config.requestTimeoutMs, 120_000);
});

test("config: AI_REQUEST_TIMEOUT_MS overschrijft de default met grenzen", () => {
  process.env.AI_REQUEST_TIMEOUT_MS = "45000";
  assert.equal(getAIConfig().requestTimeoutMs, 45_000);
  process.env.AI_REQUEST_TIMEOUT_MS = "500"; // < 1s minimum: terug naar default
  assert.equal(getAIConfig().requestTimeoutMs, 120_000);
  process.env.AI_REQUEST_TIMEOUT_MS = "999999"; // > cap: terug naar default
  assert.equal(getAIConfig().requestTimeoutMs, 120_000);
});

test("REGRESSIE: een trage (maar geslaagde) response wordt niet achteraf weggegooid", async () => {
  // Vroeger: post-hoc `Date.now() - started > timeoutMs` throw ná een geslaagd
  // (betaald) antwoord. Nu bestaat die check niet meer: het antwoord komt door.
  const provider = stubbedProvider(async () => ({
    content: [{ type: "text", text: "ok" }],
    model: "claude-sonnet-5",
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
  const result = await provider.generateText(REQUEST);
  assert.equal(result.text, "ok");
});

test("REGRESSIE: een afgebroken request (timeout) geeft AITimeoutError met de limiet — nooit 'Onbekende Anthropic-fout'", async () => {
  process.env.AI_REQUEST_TIMEOUT_MS = "1000";
  const provider = stubbedProvider(
    (_body, options) =>
      new Promise((_resolve, reject) => {
        // Simuleert de SDK bij een echte abort: het request stopt bij de limiet.
        options?.signal?.addEventListener("abort", () => reject(new Anthropic.APIUserAbortError()), {
          once: true,
        });
        // AbortSignal.timeout-retainders zijn unref'd — houd de event-loop wakker
        // zodat de runner niet afbreekt, en faal luid als de abort uitblijft.
        // Ref'd (default): houdt de event-loop wakker totdat de abort of de
        // safety-trigger het promise definitief afsluit.
        setTimeout(() => reject(new Error("abort kwam niet binnen 3s")), 3_000);
      })
  );
  const started = Date.now();
  await assert.rejects(
    () => provider.generateText(REQUEST),
    (error: unknown) => {
      assert.ok(error instanceof AITimeoutError, `verwacht AITimeoutError, kreeg: ${String(error)}`);
      assert.match(error.message, /afgebroken: limiet/);
      assert.doesNotMatch(error.message, /Onbekende Anthropic-fout/);
      return true;
    }
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5_000, `abort moet binnen de limiet stoppen (duurde ${elapsed}ms)`);
});

test("REGRESSIE: APIConnectionError door abort wordt timeout, niet netwerkfout", async () => {
  const provider = stubbedProvider(async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "TimeoutError";
    throw new Anthropic.APIConnectionError({ cause: abortError });
  });
  await assert.rejects(
    () => provider.generateText(REQUEST),
    (error: unknown) => {
      assert.ok(error instanceof AITimeoutError, `verwacht AITimeoutError, kreeg: ${String(error)}`);
      return true;
    }
  );
});

test("REGRESSIE: eigen AIError-klassen gaan onveranderd door — geen hermapping naar generiek", async () => {
  const specific = new AIProviderError("Anthropic rate limit bereikt, type: rate_limit_error");
  const provider = stubbedProvider(async () => {
    throw specific;
  });
  await assert.rejects(
    () => provider.generateText(REQUEST),
    (error: unknown) => {
      assert.equal(error, specific, "exact dezelfde error-instantie moet doorgaan");
      assert.equal((error as AIProviderError).message, specific.message);
      return true;
    }
  );
});

test("provider: configuration-fouten blijven AIConfigurationError", async () => {
  const provider = stubbedProvider(async () => {
    throw new AIConfigurationError("AI_MODE ontbreekt");
  });
  await assert.rejects(
    () => provider.generateText(REQUEST),
    (error: unknown) => error instanceof AIConfigurationError
  );
});

test("action-contract: verwachte designplan-fouten komen terug als { ok: false, error } — geen throw die productie maskeert tot #441", () => {
  // De action vangt AIError/DesignPlanError/DesignPlanValidationError af en
  // geeft de veilige boodschap terug; onverwachte fouten blijven throwen.
  assert.match(actionSource, /instanceof AIError \|\| error instanceof DesignPlanError \|\| error instanceof DesignPlanValidationError/);
  assert.match(actionSource, /return \{ ok: false, error: error\.message \}/);
  assert.match(actionSource, /revalidatePath\(`\/projects\/\$\{projectId\}`\);\s*\n\s*if \(error instanceof/);
  // Niet ALLE fouten inslikken: onverwachte fouten moeten nog throwen (Vercel-logging).
  assert.match(actionSource, /throw error;/);
});

test("action-contract: het mislukte plan-record wordt zichtbaar via revalidatePath óók bij falende generatie", () => {
  // De service persisteert status failed vóór de rethrow; zonder revalidate in
  // het catch-pad zou de eigenaar de nieuwe (mislukte) versie niet zien.
  const occurrences = actionSource.match(/revalidatePath\(`\/projects\/\$\{projectId\}`\)/g);
  assert.ok(occurrences && occurrences.length >= 2, "revalidatePath moet op succès- én faalpad staan");
});

test("UI-contract: design-plan-section toont de echte foutreden inline uit het actieresultaat", () => {
  assert.match(sectionSource, /const result = await generateDesignPlanAction\(projectId\)/);
  assert.match(sectionSource, /if \(!result\.ok\) setError\(result\.error\)/);
});
