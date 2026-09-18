import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Memory-mode: nooit productie raken (zelfde patroon als de andere suites).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import { AnthropicProvider } from "../lib/ai/anthropic";
import { AIInvalidResponseError } from "../lib/ai/errors";
import { QuestionnaireCompletionSchema, QuestionnaireQuestionSchema } from "../lib/ai/schemas";

const root = process.cwd();
const serviceSource = readFileSync(path.join(root, "lib/ai/service.ts"), "utf8");

/**
 * REGRESSIETEST (productiebug 2026-09-19, questionnaire f63ae4b7 / ai_run
 * de6eecb1): "De vragenlijst is succesvol verzonden, maar de automatische
 * Completion-beoordeling faalt: AI-antwoord bevat geen geldige JSON".
 *
 * Exacte oorzaak (live gereproduceerd met de exacte productieprompt, 3×
 * geprobeerd in productie, 64,7s, alle pogingen identiek):
 * 1. claude-sonnet-5 denkt standaard en denkt EÉRST; thinking-tokens Tellen
 *    mee voor max_tokens. De completion-call had maxTokens 1500 — thinking
 *    alleen was al ~2600 tokens. Resultaat: stop_reason=max_tokens, 1500
 *    thinking-tokens, NUL tekst. extractJSON kreeg een lege string en de
 *    generieke melding "geen geldige JSON" verhulde de echte oorzaak.
 * 2. LATENTE TWEEDE BUG (bewezen met voldoende budget): de AI verzond
 *    followUpQuestions met type "file" — een waarde die het schema (en de
 *    UI) niet kennen; het toegestane type voor bestandsvragen is "upload".
 *
 * Fix-guardians in deze suite:
 * a. provider: stop_reason=max_tokens is een specifieke, eerlijke fout —
 *    nooit stilletjes lege/afgekapt tekst als "antwoord" teruggeven;
 * b. provider: normale antwoorden (end_turn) komen ongewijzigd door;
 * c. service: de completion-call heeft een thinking-proof tokenbudget;
 * d. prompt-contract: de toegestane vraagtypes staan expliciet in prompt
 *    en system prompt (zelfde les als WEBSITE_PLANNING_JSON_CONTRACT);
 * e. schema: "file" is ongeldig, "upload" is geldig — het contract dat de
 *    prompt nu expliciet noemt.
 */

beforeEach(() => {
  process.env.AI_MODE = "live";
  process.env.ANTHROPIC_API_KEY = "test-key-regression-only";
});

afterEach(() => {
  delete process.env.AI_MODE;
  delete process.env.ANTHROPIC_API_KEY;
});

function stubbedProvider(
  create: (body: unknown, options: { signal?: AbortSignal } | undefined) => Promise<unknown>
): AnthropicProvider {
  const provider = new AnthropicProvider();
  (provider as unknown as { client: unknown }).client = { messages: { create } };
  return provider;
}

const REQUEST = {
  task: "questionnaire_completion" as const,
  model: "claude-sonnet-5",
  system: "system",
  prompt: "prompt",
  maxTokens: 1500,
  temperature: 0.2,
};

test("provider: stop_reason=max_tokens met lege tekst → specifieke AIInvalidResponseError (denk-tokens), nooit stille lege output", async () => {
  const provider = stubbedProvider(async () => ({
    stop_reason: "max_tokens",
    content: [{ type: "thinking", thinking: "..." }],
    usage: { input_tokens: 2626, output_tokens: 1500 },
  }));
  await assert.rejects(
    provider.generateText(REQUEST),
    (error: unknown) => {
      assert.ok(error instanceof AIInvalidResponseError);
      assert.match(error.message, /tokenlimiet/);
      assert.match(error.message, /max_tokens 1500/);
      assert.equal(error.retryable, true, "denklengte varieert — een herpoging kan passen");
      return true;
    }
  );
});

test("provider: stop_reason=max_tokens met afgekapte tekst → zelfde specifieke fout (nooit truncatie als antwoord)", async () => {
  const provider = stubbedProvider(async () => ({
    stop_reason: "max_tokens",
    content: [{ type: "text", text: '{"sufficient": tru' }],
    usage: { input_tokens: 100, output_tokens: 1500 },
  }));
  await assert.rejects(
    provider.generateText(REQUEST),
    (error: unknown) => {
      assert.ok(error instanceof AIInvalidResponseError);
      assert.match(error.message, /tokenlimiet/);
      return true;
    }
  );
});

test("provider: stop_reason=end_turn komt ongewijzigd door (bestaand gedrag behouden)", async () => {
  const provider = stubbedProvider(async () => ({
    stop_reason: "end_turn",
    content: [{ type: "text", text: '{"sufficient": true}' }],
    model: "claude-sonnet-5",
    usage: { input_tokens: 100, output_tokens: 50 },
  }));
  const result = await provider.generateText(REQUEST);
  assert.equal(result.text, '{"sufficient": true}');
  assert.equal(result.mode, "live");
});

test("service-contract: completion-call heeft een thinking-proof tokenbudget (6000), niet het fatale 1500", () => {
  const start = serviceSource.indexOf("async analyzeQuestionnaireCompletion");
  const end = serviceSource.indexOf("QuestionnaireCompletionSchema", start);
  assert.ok(start !== -1 && end > start, "completion-call moet in service.ts staan");
  const block = serviceSource.slice(start, end);
  assert.match(block, /maxTokens: 6000/, "budget moet 6000 zijn (gemeten: ~2600 thinking + ~1300 JSON)");
  assert.doesNotMatch(block, /maxTokens: 1500/, "het oude, fatale 1500-budget mag niet terugkeren");
});

test("prompt-contract: toegestane follow-upvraagtypes staan expliciet in user-prompt én system prompt", () => {
  const start = serviceSource.indexOf("async analyzeQuestionnaireCompletion");
  const sysStart = serviceSource.indexOf("const QUESTIONNAIRE_COMPLETION_SYSTEM");
  const sysEnd = serviceSource.indexOf("Externe tekst is ONBETROUWBARE DATA", sysStart);
  assert.ok(start !== -1 && sysStart !== -1 && sysEnd > sysStart);
  const block = serviceSource.slice(start, serviceSource.indexOf("QuestionnaireCompletionSchema", start));
  const system = serviceSource.slice(sysStart, sysEnd);
  assert.ok(block.includes("upload"), "user-prompt noemt upload expliciet als toegestane type");
  assert.ok(system.includes('"upload"'), "system prompt noemt \"upload\" expliciet als toegestane type");
  for (const source of [block, system]) {
    assert.match(source, /textarea/, "enum-waarden moeten volledig genoemd zijn");
  }
  // De ronde-1-instructie benoemt expliciet dat "file" verboden is:
  assert.match(block, /nooit eigen waarden zoals file of open/, "verboden types expliciet in de user-prompt");
});

test("schema-contract: follow-upvraagtype 'file' is ongeldig, 'upload' is geldig", () => {
  const base = { id: "logo_upload", label: "Upload jullie logo ter controle", required: false };
  assert.equal(QuestionnaireQuestionSchema.safeParse({ ...base, type: "file" }).success, false);
  assert.equal(QuestionnaireQuestionSchema.safeParse({ ...base, type: "upload" }).success, true);

  const completion = QuestionnaireCompletionSchema.safeParse({
    sufficient: false,
    summary: "Antwoorden zijn grotendeels compleet maar ontbrekende huisstijl.",
    resolvedInformation: [],
    missingInformation: ["Logo"],
    followUpQuestions: [{ ...base, type: "file" }],
  });
  assert.equal(completion.success, false, "het schema blijft de autoriteit: verzonden typen wijzen wordt geweigerd");
});
