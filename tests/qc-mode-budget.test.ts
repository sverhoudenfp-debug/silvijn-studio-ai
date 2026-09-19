import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Memory-mode: nooit productie raken (zelfde patroon als de andere suites).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import {
  AIInvalidResponseError,
  attachAIAttemptMetadata,
  readAIAttemptMetadata,
} from "../lib/ai/errors";
import { buildWebsiteQCPrompt } from "../lib/ai/service";
import type { WebsiteQualityAnalysisInput } from "../lib/ai/types";

const root = process.cwd();
const serviceSource = readFileSync(path.join(root, "lib/ai/service.ts"), "utf8");
const qcServiceSource = readFileSync(path.join(root, "lib/qc/service.ts"), "utf8");

/**
 * REGRESSIETESTS (productiebug 2026-09-19, QC-run 08:09-08:11 UTC op
 * fixture #2-website v1): de AI-QC faalde live op het hardcoded
 * max_tokens 2500-budget ("AI-antwoord onvolledig: tokenlimiet (max_tokens
 * 2500) bereikt vóór volledige output"), maar het quality_controls-rapport
 * toonde mode='mock' / model='n.v.t.' — de init-waarde uit het record dat
 * vóór de AI-call wordt aangemaakt; het faalpad werkte mode/model nooit bij.
 *
 * Fix-guardians in deze suite:
 * a. budget: generateWebsiteQualityAnalysis heeft een thinking-proof
 *    budget (6000) — claude-sonnet-5 thinking-tokens tellen mee voor
 *    max_tokens (zelfde foutklasse als designplan 4000→12000 en
 *    questionnaire 1500→6000); het fatale 2500 mag niet terugkeren;
 * b. metadata (RUNTIME): pogings-fouten dragen de ECHTE mode + model —
 *    helper roundtrip, non-enumerable (lekt niet in logs/serialisatie);
 * c. service-wiring (BRON-CONTRACT, zelfde patroon als security-pricing:
 *    lib/qc/service.ts importeert next/navigation via lib/auth/server en
 *    laadt buiten een React-runtime niet): generateStructured zet de
 *    pogings-metadata op de fout; het QC-faalpad leest hem en slaat de
 *    echte mode/model op; het create-pad start al eerlijk.
 */

// ------------------------------------------------------------------
// a. Budget-guardian (source-contract, zelfde patroon als de budgettests)
// ------------------------------------------------------------------

test("budget-guardian: AI-QC-call heeft thinking-proof budget (6000), niet het fatale 2500", () => {
  const start = serviceSource.indexOf("async generateWebsiteQualityAnalysis");
  const end = serviceSource.indexOf("QCAnalysisSchema", start);
  assert.ok(start !== -1 && end > start, "generateWebsiteQualityAnalysis moet in service.ts staan");
  const block = serviceSource.slice(start, end);
  assert.match(block, /maxTokens: 6000/, "budget moet 6000 zijn (2500 faalde live: thinking + QCAnalysis-schema > 2500)");
  assert.doesNotMatch(block, /maxTokens: 2500/, "het oude, fatale 2500-budget mag niet terugkeren");
});

test("budget-guardian: eerdere budget-fixes blijven intact (alleen verzwaren, niets afzwakken)", () => {
  assert.match(serviceSource, /maxTokens: 12000/, "designplanning houdt 12000");
  const qcStart = serviceSource.indexOf("async generateWebsiteQualityAnalysis");
  const qcBlock = serviceSource.slice(qcStart, serviceSource.indexOf("QCAnalysisSchema", qcStart));
  assert.match(qcBlock, /maxTokens: 6000/, "QC gebruikt 6000");
});

test("budget-guardian: alle ZWARE-schema-calls (thinking + groot outputschema) hebben ≥ 6000", () => {
  // De drie calls die in productie op thinking+truncatie faalden of daar
  // structureel voor vatbaar zijn: designplanning (live incident, 4000),
  // questionnaire-completion (live incident, 1500) en website-QC (live
  // incident, 2500). Kleine-output-calls (score, outreach, sales) mogen
  // lager — deze guardian bewaakt de zware klasse.
  const budgets: Array<[string, string, number]> = [
    ["async generateDesignPlan", "designPlanSchema", 6000],
    ["async analyzeQuestionnaireCompletion", "QuestionnaireCompletionSchema", 6000],
    ["async generateWebsiteQualityAnalysis", "QCAnalysisSchema", 6000],
  ];
  for (const [fnStart, schemaAnchor, minimum] of budgets) {
    const start = serviceSource.indexOf(fnStart);
    assert.ok(start !== -1, `${fnStart} moet in service.ts staan`);
    const block = serviceSource.slice(start, serviceSource.indexOf(schemaAnchor, start));
    // Een methode kan meerdere calls bevatten (draft + completion): de call
    // die op het zware schema valideert is de LAATSTE maxTokens in het blok.
    const matches = [...block.matchAll(/maxTokens:\s*(\d+),/g)];
    assert.ok(matches.length > 0, `${fnStart} moet een expliciet maxTokens hebben (nooit de 1500-default)`);
    const budget = Number(matches[matches.length - 1][1]);
    assert.ok(budget >= minimum, `${fnStart}-budget ${budget} is te laag voor thinking + groot schema (minimaal ${minimum})`);
  }
});

// ------------------------------------------------------------------
// b. Pogings-metadata (runtime-test: errors.ts laadt zonder React)
// ------------------------------------------------------------------

test("metadata: attach → read roundtrip met de echte mode + model", () => {
  const error = new AIInvalidResponseError("AI-antwoord onvolledig: tokenlimiet (max_tokens 6000) bereikt vóór volledige output");
  assert.equal(readAIAttemptMetadata(error), null, "zonder metadata: null");
  attachAIAttemptMetadata(error, { mode: "live", model: "claude-sonnet-5" });
  const meta = readAIAttemptMetadata(error);
  assert.ok(meta);
  assert.equal(meta.mode, "live");
  assert.equal(meta.model, "claude-sonnet-5");
  // non-enumerable: lekt niet in JSON/logs
  assert.equal(Object.keys(error).includes("aiAttempt"), false);
  assert.equal(JSON.stringify(error).includes("aiAttempt"), false);
});

test("metadata: laatst gezette waarde wint; meerdere fouten storen onafhankelijk", () => {
  const error = new AIInvalidResponseError("fout");
  attachAIAttemptMetadata(error, { mode: "mock", model: "mock-model" });
  attachAIAttemptMetadata(error, { mode: "live", model: "claude-sonnet-5" });
  assert.equal(readAIAttemptMetadata(error)?.mode, "live");
  const other = new AIInvalidResponseError("andere fout");
  assert.equal(readAIAttemptMetadata(other), null, "geen globale state tussen fouten");
});

test("metadata: ongulide waarden worden defensief geweigerd", () => {
  const error = new Error("fout");
  attachAIAttemptMetadata(error, { mode: "live", model: "" });
  assert.equal(readAIAttemptMetadata(error), null, "leeg model is géén geldige metadata");
  assert.equal(readAIAttemptMetadata("geen error"), null);
  assert.equal(readAIAttemptMetadata(null), null);
});

// ------------------------------------------------------------------
// c. Service-wiring (bron-contract)
// ------------------------------------------------------------------

test("generateStructured zet bij falen de pogings-metadata (echte mode + model) op de fout", () => {
  assert.match(
    serviceSource,
    /attachAIAttemptMetadata\(error, \{ mode: getAIConfig\(\)\.mode, model \}\);/,
    "elke structured call rapporteert zijn poging bij falen"
  );
  const attachIdx = serviceSource.indexOf("attachAIAttemptMetadata(error, { mode: getAIConfig().mode, model });");
  const logIdx = serviceSource.indexOf("await this.logFailedRun(call, task, model, started, error);", attachIdx);
  assert.ok(attachIdx > -1 && logIdx > attachIdx, "metadata wordt vóór de herthrow op de fout gezet");
});

test("QC-create start met de daadwerkelijk geplande call (geen mock/n.v.t.-init meer)", () => {
  assert.match(qcServiceSource, /attemptInfo\("website_quality_control", getWebsiteQCTier\(\)\)/, "create haalt mode/model op uit de AI-service");
  assert.match(qcServiceSource, /mode: aiAttempt\.mode/, "record-mode = echte pogingsmodus");
  // De oude, misleidende init-waarden mogen niet meer voorkomen als create-default:
  assert.doesNotMatch(qcServiceSource, /mode: "mock",\s*\n\s*model: "n\.v\.t\. \(nog geen AI-call\)"/);
});

test("QC-faalpad slaat de pogings-metadata op: failed live call toont NOOIT mode=mock", () => {
  const catchIdx = qcServiceSource.indexOf("readAIAttemptMetadata(error)");
  assert.ok(catchIdx > -1, "faalpad leest de pogings-metadata van de fout");
  const block = qcServiceSource.slice(catchIdx, qcServiceSource.indexOf("?? qc;", catchIdx));
  assert.match(block, /mode: failedAttempt\.mode/, "echte modus wordt in het rapport opgeslagen");
  assert.match(block, /model: failedAttempt\.model/, "echte model wordt in het rapport opgeslagen");
  assert.match(qcServiceSource, /status: "failed"/, "QC blijft FAILED bij AI-falen (geen poort versoepeld)");
  assert.match(qcServiceSource, /status: "ready_for_qc"/, "website keert terug naar ready_for_qc (bestaand gedrag)");
});

test("QC-succespad blijft mode/model uit het AI-resultaat halen (bestaand gedrag behouden)", () => {
  assert.match(qcServiceSource, /mode = ai\.mode;/);
  assert.match(qcServiceSource, /model = ai\.model;/);
});

test("QC-service: AI-call blijft alléén adviserend — APPROVED blijft een menselijke gate", () => {
  // invariant-bewaking: deze fix raakt geen enkele goedkeurings-/delivery-gate
  assert.match(qcServiceSource, /MENSelijke approval — de harde gate/, "approve-documentatie ongewijzigd");
  assert.match(qcServiceSource, /requireStudioOwner/, "approval vereist de ingelogde eigenaar");
  assert.doesNotMatch(qcServiceSource, /approveWebsite[\s\S]*?service_role/i, "geen service-role approval-pad");
});

const qcPromptInput: WebsiteQualityAnalysisInput = {
  businessName: "Studio Fictief",
  industry: "interieur",
  city: "Amsterdam",
  leadStatus: "qualified",
  requirementsSummary: "type: business_website",
  specificationSummary: "1 pagina, business standard",
  generatedSectionsSummary: "header/hero/services/cta/contact/footer",
  deterministicResults: "geen",
};
const qcPrompt = buildWebsiteQCPrompt(qcPromptInput);
const qcSchemaSource = readFileSync(path.join(root, "lib/ai/schemas.ts"), "utf8");

// ------------------------------------------------------------------
// d. QC-prompt JSON-contract (live-incident 2026-09-19 ~11:00 UTC: de AI
//    leverde 11 issues ZONDER message — de prompt noemde het issues-shape
//    nergens, alleen "result/issues/notes". Zelfde les als de questionnaire
//    type-contract-fix: expliciet veldcontract in de prompt.)
// ------------------------------------------------------------------

test("QC-prompt: expliciet issues-contract (severity + message ALTIJD, message minimaal 5 tekens)", () => {
  // runtime-check op de promptbouwer: service.ts laadt zonder React (geen auth/server in de importketen van de promptbouwer)
  // — geïmporteerd via dezelfde module als de andere runtime-tests in deze suite.
  assert.match(qcPrompt, /ALTIJD BEIDE velden: severity/, "severity is verplicht in elk issue");
  assert.match(qcPrompt, /EN message \(één concrete Nederlandse zin, minimaal 5 tekens/, "message is verplicht en niet-hernoembaar");
  assert.match(qcPrompt, /exact één van "info", "warning", "error", "critical"/, "severity-enum expliciet");
  assert.match(qcPrompt, /result: exact één van "passed", "warning", "failed", "not_checked"/, "result-enum expliciet");
  assert.match(qcPrompt, /notes: string of null/, "notes-contract expliciet");
  assert.match(qcPrompt, /Antwoord met uitsluitend de JSON/, "JSON-only-gebod staat in de prompt");
});

test("QC-prompt: alle vijf assessments + recommendations + summary staan in het contract", () => {
  for (const assessment of [
    "contentAssessment",
    "designAssessment",
    "responsiveAssessment",
    "conversionAssessment",
    "businessAccuracyAssessment",
  ]) {
    assert.ok(qcPrompt.includes(assessment), `${assessment} moet expliciet in het contract staan`);
  }
  assert.match(qcPrompt, /recommendations: een ARRAY van korte Nederlandse zinnen/);
  assert.match(qcPrompt, /summary: één string/);
});

test("QC-schema-bewaking: QCAnalysisSchema blijft de autoriteit (issues verplicht, message minimaal 5 tekens)", () => {
  // Bron-contract: de schema-laag mag niet worden versoepeld om de prompt
  // te "redden" — truncatie-achtige output blijft een FOUT.
  assert.match(qcSchemaSource, /severity: z\.enum\(\["info", "warning", "error", "critical"\]\)/);
  assert.match(qcSchemaSource, /message: z\.string\(\)\.min\(5\)/);
  assert.match(qcSchemaSource, /\.max\(10\)/, "issues-limiet 10 blijft gehandhaafd");
});
