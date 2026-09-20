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
import { designPlanSchema, type DesignPlan } from "../lib/websites/design-plan";

const root = process.cwd();
const serviceSource = readFileSync(path.join(root, "lib/ai/service.ts"), "utf8");

/**
 * REGRESSIETEST (productiebug 2026-09-19, Velora Interieur / design plan v2,
 * ai_run 23:49 UTC): "AI-antwoord onvolledig: tokenlimiet (max_tokens 4000)
 * bereikt vóór volledige output".
 *
 * Exacte oorzaak: claude-sonnet-5 denkt standaard en denkt EERST;
 * thinking-tokens tellen mee voor max_tokens. Bij rijke questionnaire-input
 * (Velora Interieur: uitgebreide antwoorden op alle vragen) kostte het
 * denken + het grote Design Plan-JSON (~19 top-level velden) samen meer dan
 * het 4000-tokenbudget → stop_reason=max_tokens op alle 3 de pogingen.
 * De v1 (met beperktere input, ~4900 total tokens) lukte nog nét.
 *
 * Fix-guardians in deze suite:
 * a. provider: stop_reason=max_tokens is een specifieke, retrybare fout —
 *    nooit stille truncatie als "antwoord" (gedekt in
 *    ai-questionnaire-completion.test.ts; hier opnieuw bewaakt voor de
 *    designplanning-request-vorm);
 * b. service: de designplanning-call heeft een thinking-proof tokenbudget
 *    (12000, sinds Fase A+B 16000, sinds de C1/C2-doorvoer 20000), niet het fatale 4000;
 * c. prompt-contract: de user-prompt bevat het expliciete, volledige
 *    JSON-veldcontract (DESIGN_PLANNING_JSON_CONTRACT) en verbiedt eigen
 *    veldnamen — het strikte schema-contract blijft in de prompt staan;
 * d. schema: een volledig, geldig Design Plan doorstaat de Zod-validatie
 *    (het doelbudget produceert output die het schema accepteert).
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
  task: "design_planning" as const,
  model: "claude-sonnet-5",
  system: "system",
  prompt: "prompt",
  maxTokens: 4000,
  temperature: 0.4,
};

test("provider: stop_reason=max_tokens tijdens designplanning → specifieke AIInvalidResponseError, nooit stille truncatie", async () => {
  const provider = stubbedProvider(async () => ({
    stop_reason: "max_tokens",
    content: [
      { type: "thinking", thinking: "..." },
      { type: "text", text: '{"goals": {"primaryGoal": "Nieuwe klanten aantrek' },
    ],
    usage: { input_tokens: 2300, output_tokens: 4000 },
  }));
  await assert.rejects(
    provider.generateText(REQUEST),
    (error: unknown) => {
      assert.ok(error instanceof AIInvalidResponseError);
      assert.match(error.message, /tokenlimiet/);
      assert.match(error.message, /max_tokens 4000/);
      assert.equal(error.retryable, true, "denklengte varieert — een herpoging kan passen");
      return true;
    }
  );
});

test("provider: stop_reason=end_turn met volledige JSON komt ongewijzigd door (bestaand gedrag behouden)", async () => {
  const provider = stubbedProvider(async () => ({
    stop_reason: "end_turn",
    content: [{ type: "text", text: '{"goals": {"primaryGoal": "x"}}' }],
    model: "claude-sonnet-5",
    usage: { input_tokens: 2300, output_tokens: 3800 },
  }));
  const result = await provider.generateText(REQUEST);
  assert.equal(result.text, '{"goals": {"primaryGoal": "x"}}');
  assert.equal(result.mode, "live");
});

test("service-contract: designplanning-call heeft een thinking-proof tokenbudget (20000, sinds de C1/C2-questionnaredoorvoer), niet het fatale 4000", () => {
  const start = serviceSource.indexOf("async generateDesignPlan");
  const end = serviceSource.indexOf("designPlanSchema", start);
  assert.ok(start !== -1 && end > start, "generateDesignPlan moet in service.ts staan");
  const block = serviceSource.slice(start, end);
  assert.match(
    block,
    /maxTokens: 20000/,
    "budget moet 20000 zijn (E2E 2026-09-20: ronde-1+2-antwoorden in de prompt + thinking + plan + blueprint overschreden 16000; 24000+ is SDK-onmogelijk non-streaming, zie provider-comment)"
  );
  assert.doesNotMatch(block, /maxTokens: 4000/, "het oude, fatale 4000-budget mag niet terugkeren");
  assert.doesNotMatch(block, /maxTokens: 12000/, "het pre-blueprint budget is achterhaald: blueprint-instanties kosten structureel extra output-tokens");
});

test("service-contract: designplanning-call zet reasoning-effort low (C3e-live-les 2026-09-20): adaptive thinking verslond anders het volledige 20000-budget vóór enige JSON", () => {
  const start = serviceSource.indexOf("async generateDesignPlan");
  const end = serviceSource.indexOf("designPlanSchema", start);
  assert.ok(start !== -1 && end > start, "generateDesignPlan moet in service.ts staan");
  const block = serviceSource.slice(start, end);
  assert.match(
    block,
    /thinkingEffort: "low"/,
    "C3e-live-les: zonder reasoning-cap besteedt sonnet-5 bij rijke input alle max_tokens aan thinking (stop_reason=max_tokens, 2x live gereproduceerd); effort 'low' is de juiste inspanning voor deze invultaak"
  );
});

test("prompt-contract: user-prompt bevat het expliciete, volledige JSON-veldcontract en verbiedt eigen veldnamen", () => {
  const start = serviceSource.indexOf("function buildDesignPlanPrompt");
  const end = serviceSource.indexOf("const WEBSITE_QC_SYSTEM", start);
  assert.ok(start !== -1 && end > start, "buildDesignPlanPrompt moet in service.ts staan");
  const contractStart = serviceSource.indexOf("const DESIGN_PLANNING_JSON_CONTRACT =");
  const contractEnd = serviceSource.indexOf("/**", contractStart);
  assert.ok(contractStart !== -1 && contractEnd > contractStart, "JSON-contract moet in service.ts staan");
  // Prompt-functie + het volledige veldcontract dat de prompt injecteert:
  const block = serviceSource.slice(start, end) + serviceSource.slice(contractStart, contractEnd);

  // Het volledige veldcontract zit in de user-prompt (géén alleen-top-level-keys):
  for (const field of [
    "goals:", "audience:", "navigation:", "pageStructure:", "visualHierarchy:",
    "branding:", "typography:", "colors:", "spacing:", "components:", "ctaStrategy:",
    "imagery:", "responsive:", "animation:", "functionality:", "accessibility:",
    "seoPerformance:", "basis:", "missingInformation:",
  ]) {
    assert.ok(block.includes(field), `user-prompt noemt het contractveld ${field} expliciet`);
  }
  assert.match(block, /geen eigen veldnamen verzinnen/, "eigen veldnamen zijn expliciet verboden");
  assert.match(block, /VERPLICHTe JSON-STRUCTUUR/, "het contract staat als verplichte structuur in de prompt");
  // System prompt: output uitsluitend JSON + geen code
  const sysStart = serviceSource.indexOf("DESIGN_PLANNING_SYSTEM =");
  const sysEnd = serviceSource.indexOf("export function buildDesignPlanPrompt", sysStart);
  const system = serviceSource.slice(sysStart, sysEnd);
  assert.match(system, /uitsluitend JSON/, "system prompt eist uitsluitend JSON");
  assert.match(system, /Geen code, geen HTML/, "system prompt verbiedt code buiten de JSON-structuur");
});

test("schema-contract: een volledig, geldig Design Plan doorstaat de Zod-validatie", () => {
  const fullPlan: DesignPlan = {
    goals: {
      primaryGoal: "Nieuwe klanten aantrekken met een rustige, premium uitstraling",
      secondaryGoals: ["Bestaande klanten informeren"],
      conversionGoal: "Aanvraag vrijblijvend gesprek",
    },
    audience: {
      primaryAudience: "Particuliere opdrachtgevers met een groter budget",
      secondaryAudiences: ["Bedrijfsinterieurs"],
      toneOfVoice: "Zakelijk en warm",
    },
    navigation: {
      items: [{ label: "Home", pageKey: "home" }],
      structure: "Eén primaire navigatie met vaste CTA",
    },
    pageStructure: [
      {
        key: "home",
        title: "Home",
        purpose: "Warm binnenkomen en direct de kern tonen",
        sections: ["hero", "diensten"],
      },
    ],
    visualHierarchy: { strategy: "Grote beelden, rustige typografie", aboveTheFold: ["Hero met CTA"] },
    branding: {
      styleDirection: "Warm minimalistisch",
      mood: ["rustig", "premium"],
      existingBrandAssets: null,
      preferredColors: ["#8a6d3b"],
      dislikedColors: ["#ff0000"],
      restrictions: [],
    },
    typography: { pairing: "Serif + humanistisch sans", scale: "1.25", weights: ["400", "600"], rationale: "Rust en leesbaarheid" },
    colors: {
      primary: "#8a6d3b",
      secondary: null,
      accent: null,
      neutrals: ["#f7f5f2"],
      usageGuidance: "Primary alléén voor CTA's",
    },
    spacing: { scale: "8px-basis", density: "Rustig, veel lucht" },
    components: [{ key: "hero_cta", purpose: "Conversie", notes: null }],
    ctaStrategy: { primary: "Plan een gesprek", secondary: null, placement: ["hero"], leadCapture: true },
    imagery: { style: "Warm interieur, natuurlijk licht", requirements: [], placeholderStrategy: null },
    responsive: { mobile: "Mobile-first", tablet: null, desktop: null, breakpoints: ["768px"] },
    animation: { strategy: "Subtiele fades", allowed: ["fade-in"], restrictions: [] },
    functionality: { features: [{ key: "contactformulier", description: "Aanvraag gesprek", source: "questionnaire" }], integrations: ["Instagram"] },
    accessibility: { contrast: "Minimaal 4.5:1", focusAndKeyboard: null, semantics: null, formsAndLabels: null, guidelines: ["WCAG 2.1 AA"] },
    seoPerformance: { titleStrategy: null, metaStrategy: null, localSeo: null, performanceBudget: null, imageOptimization: null },
    basis: { sources: ["lead", "requirements", "questionnaire"] },
    missingInformation: ["Logo"],
  };
  const validated = designPlanSchema.safeParse(fullPlan);
  assert.equal(validated.success, true, "een volledig geldig Design Plan moet valideren");
});

test("schema-contract: truncatie-achtige incomplete output wordt door het schema geweigerd", () => {
  const truncated = { goals: { primaryGoal: "Nieuwe klanten aantrek" } };
  assert.equal(designPlanSchema.safeParse(truncated).success, false, "het schema blijft de autoriteit: afgekapte output faalt de validatie");
});

test("SDK-grens: designplanning-budget blijft onder de non-streaming limiet (21333) van de Anthropic SDK", () => {
  // E2E-les 2026-09-20: calculateNonstreamingTimeout gooit een kale
  // AnthropicError ("Streaming is required...") zodra maxTokens > 128000/6.
  // De provider draait non-streaming, dus het budget moet onder de grens
  // blijven. 20000 heeft +25% headroom boven het oude 16000 en past ruim.
  const SDK_NONSTREAMING_LIMIT = Math.floor(128000 / 6);
  const start = serviceSource.indexOf("async generateDesignPlan");
  const end = serviceSource.indexOf("designPlanSchema", start);
  const block = serviceSource.slice(start, end);
  const match = block.match(/maxTokens: (\d+),/);
  assert.ok(match, "designplanning maxTokens moet aantoonbaar in de generateDesignPlan-call staan");
  const budget = Number.parseInt(match[1], 10);
  assert.ok(budget <= SDK_NONSTREAMING_LIMIT, `budget ${budget} moet <= ${SDK_NONSTREAMING_LIMIT} blijven zonder streaming`);
  assert.ok(budget > 16000, "budget moet boven het bewezen te krappe 16000 blijven");
});
