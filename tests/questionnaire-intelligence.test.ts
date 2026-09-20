import { test } from "node:test";
import assert from "node:assert/strict";

import { assessContentRichness, NOT_AVAILABLE_PREFIX } from "@/lib/questionnaire/richness";
import {
  ensureDesignCoreQuestions,
  DESIGN_CORE_TOPICS,
  MAX_GENERATED_QUESTIONS,
} from "@/lib/questionnaire/design-core";
import { decideCompletion } from "@/lib/questionnaire/completion";
import { buildCompletionSummaries, buildQuestionnaireAnswerLines } from "@/lib/questionnaire/summary";
import { QuestionnaireCompletionSchema } from "@/lib/ai/schemas";
import type { QuestionnaireQuestion } from "@/lib/questionnaire/validation";
import type { QuestionnaireResponseLike } from "@/lib/questionnaire/summary";

// ---------------------------------------------------------------------------
// C1 + C2 — Questionnaire Intelligence (Design Intelligence Audit)
// ---------------------------------------------------------------------------

const FULL_DIMS = {
  offering: "Webdesign, hosting en onderhoud",
  usps: "Persoonlijk contact, snelle levering, lokale betrokkenheid",
  proof: "NIET_BESCHIKBAAR: klant bevestigt dat er geen reviews beschikbaar zijn",
  audience: "Kleine bedrijven in de regio",
  toneOfVoice: "Zakelijk maar toegankelijk",
  branding: "NIET_BESCHIKBAAR: klant geeft expliciet toestemming de huisstijl te bepalen",
  media: "NIET_BESCHIKBAAR: klant bevestigt dat er nog geen foto's beschikbaar zijn",
};

/** Geldige AI-vraag voor hergebruik in fixtures. */
const q = (id: string, label: string, type: QuestionnaireQuestion["type"] = "text"): QuestionnaireQuestion => ({
  id,
  label,
  type,
});

// ---------------------------------------------------------------------------
// C1 — content richness
// ---------------------------------------------------------------------------

test("C1 rich: volledige dimensies (incl. eerlijke afzeggingen) zijn complete", () => {
  const result = assessContentRichness(FULL_DIMS);
  assert.equal(result.complete, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.missingKeys, []);
});

test("C1: volledig ingevulde questionnaire met sufficient=true eindigt QUESTIONNAIRE_COMPLETE", () => {
  const decision = decideCompletion(
    { sufficient: true, missingInformation: [], followUpQuestions: [], contentDimensions: FULL_DIMS },
    1
  );
  assert.equal(decision.status, "QUESTIONNAIRE_COMPLETE");
  assert.deepEqual(decision.missingInformation, []);
});

test("C1: incomplete questionnaire (sufficient=false, ronde 1) krijgt follow-ups van de AI", () => {
  const followUp = [{ id: "f1", label: "Welke diensten bied je precies aan?", type: "textarea" }];
  const decision = decideCompletion(
    { sufficient: false, missingInformation: ["aanbod onbekend"], followUpQuestions: followUp },
    1
  );
  assert.equal(decision.status, "QUESTIONNAIRE_FOLLOW_UP");
  assert.equal(decision.followUpQuestions.length, 1);
});

test("C1: sufficient=true ZONDER volledige dimensies wordt gedegradeerd met deterministische kernvragen", () => {
  const dims = { ...FULL_DIMS, usps: "", proof: "", media: "" };
  const decision = decideCompletion(
    { sufficient: true, missingInformation: [], followUpQuestions: [], contentDimensions: dims },
    1
  );
  assert.equal(decision.status, "QUESTIONNAIRE_FOLLOW_UP");
  // Deterministische follow-ups: kernvragen voor de ontbrekende dimensies (max 3).
  const followUps = decision.followUpQuestions as QuestionnaireQuestion[];
  assert.equal(followUps.length, 3);
  const ids = followUps.map((f) => f.id).sort();
  assert.deepEqual(ids, ["core_bewijs", "core_media", "core_usp"]);
  // De reden wordt eerlijk in missingInformation geregistreerd.
  assert.ok(decision.missingInformation.some((m) => m.startsWith("Content-dimensie onvoldoende")));
});

test("C1: sufficient=true met lege dimensies in ronde 2 wordt een aandachtspunt (nooit stilletje compleet)", () => {
  const decision = decideCompletion(
    { sufficient: true, missingInformation: [], followUpQuestions: [], contentDimensions: null },
    2
  );
  assert.equal(decision.status, "QUESTIONNAIRE_ATTENTION");
  assert.ok(decision.missingInformation.length >= 7);
});

// ---------------------------------------------------------------------------
// C1 — ontbrekend bewijs / ontbrekende huisstijl (declinabele dimensies)
// ---------------------------------------------------------------------------

test("C1 ontbrekend bewijs: expliciete NIET_BESCHIKBAAR-bevestiging telt als opgelost (geen fabricatie nodig)", () => {
  const result = assessContentRichness({ ...FULL_DIMS, proof: `${NOT_AVAILABLE_PREFIX}: klant zegt: "we hebben nog geen reviews"` });
  assert.equal(result.complete, true);
});

test("C1 ontbrekende huisstijl: branding weg → onvolledig; met expliciete toestemming → compleet", () => {
  const missing = assessContentRichness({ ...FULL_DIMS, branding: "" });
  assert.equal(missing.complete, false);
  assert.ok(missing.missingKeys.includes("branding"));
  const allowed = assessContentRichness({ ...FULL_DIMS, branding: "NIET_BESCHIKBAAR: klant laat de kleuren aan ons over" });
  assert.equal(allowed.complete, true);
});

test("C1 anti-fabricatie: NIET_BESCHIKBAAR op een niet-declinabele dimensie (aanbod) is ongeldig", () => {
  const result = assessContentRichness({ ...FULL_DIMS, offering: "NIET_BESCHIKBAAR: onbekend" });
  assert.equal(result.complete, false);
  assert.ok(result.missingKeys.includes("offering"));
  // En de follow-upronde vraagt het aanbod deterministisch na:
  const decision = decideCompletion(
    { sufficient: true, missingInformation: [], followUpQuestions: [], contentDimensions: { ...FULL_DIMS, offering: "NIET_BESCHIKBAAR: onbekend" } },
    1
  );
  assert.equal(decision.status, "QUESTIONNAIRE_FOLLOW_UP");
  assert.ok((decision.followUpQuestions as QuestionnaireQuestion[]).some((f) => f.id === "core_aanbod"));
});

// ---------------------------------------------------------------------------
// C2 — design-kern in de gegenereerde vragenlijst
// ---------------------------------------------------------------------------

test("C2: de acht kernonderwerpen zijn gedefinieerd met korte, feilloze kernvragen", () => {
  assert.equal(DESIGN_CORE_TOPICS.length, 8);
  for (const topic of DESIGN_CORE_TOPICS) {
    assert.ok(topic.question.length <= 120, topic.id + " vraag te lang");
    assert.match(topic.id, /^core_/);
  }
});

test("C2: AI-lijst die alles al dekt blijft exact ongewijzigd (geen duplicaten)", () => {
  const covering: QuestionnaireQuestion[] = [
    q("a", "Wat bieden jullie concreet aan?"),
    q("b", "Voor wie is jullie dienst bedoeld?"),
    q("c", "Waarom zouden klanten voor jullie kiezen?"),
    q("d", "Hebben jullie reviews of referenties?"),
    q("e", "Wat moet een bezoeker op de website doen?"),
    q("f", "Welke uitstraling past bij jullie?"),
    q("g", "Hebben jullie een logo of huisstijl?"),
    q("h", "Zijn er foto's beschikbaar?"),
  ];
  const result = ensureDesignCoreQuestions(covering, "Bekende context: niets relevants");
  assert.deepEqual(result.questions, covering);
  assert.deepEqual(result.addedTopics, []);
});

test("C2: ontbrekende kernonderwerpen worden deterministisch aangevuld met vaste kernvragen", () => {
  const partial: QuestionnaireQuestion[] = [q("a", "Wat is jullie deadline?")];
  const result = ensureDesignCoreQuestions(partial, "Bekende context: minimale lead-informatie, verder is niets relevants bekend");
  assert.equal(result.questions.length, 9);
  assert.equal(result.addedTopics.length, 8);
  const ids = result.questions.map((x) => x.id);
  assert.deepEqual(ids, ["a", ...DESIGN_CORE_TOPICS.map((t) => t.id)]);
  // Kernvragen bevatten géén bedrijfsfeiten: exact de vaste teksten.
  const uspQuestion = result.questions.find((x) => x.id === "core_usp");
  assert.equal(uspQuestion?.label, "Waarom zouden klanten voor jullie kiezen?");
});

test("C2 bestaande informatie: betrouwbaar bekende onderwerpen worden NIET opnieuw gevraagd", () => {
  const partial: QuestionnaireQuestion[] = [q("a", "Wat is jullie deadline?")];
  // Context noemt expliciet diensten én huisstijl — die kernvragen blijven weg.
  const context = "Bekende requirements: diensten: webdesign, hosting; huisstijl: logo en merkkleuren bekend";
  const result = ensureDesignCoreQuestions(partial, context);
  const ids = result.questions.map((x) => x.id);
  assert.ok(!ids.includes("core_aanbod"), "aanbod is al bekend — niet opnieuw vragen");
  assert.ok(!ids.includes("core_kleuren"), "huisstijl is al bekend — niet opnieuw vragen");
  assert.ok(ids.includes("core_doel"), "onbekende kernonderwerpen wél aangevuld");
  assert.deepEqual(result.knownTopics.sort(), ["core_aanbod", "core_kleuren"].sort());
});

test("C2 limiet: bij een volle lijst (15) valt de LAATSTE niet-kernvraag weg, nooit een kernvraag", () => {
  const full: QuestionnaireQuestion[] = Array.from({ length: MAX_GENERATED_QUESTIONS }, (_, i) =>
    q(`extra_${i}`, `Branchegerichte aanvulling ${i}`)
  );
  const result = ensureDesignCoreQuestions(full, "Minimale context: alles onbekend");
  assert.equal(result.questions.length, MAX_GENERATED_QUESTIONS);
  assert.equal(result.addedTopics.length, 8);
  // De kernvragen zijn er allemaal; de laatst toegevoegde AI-vraag is weg.
  const coreIds = new Set(DESIGN_CORE_TOPICS.map((t) => t.id));
  for (const core of coreIds) assert.ok(result.questions.some((x) => x.id === core));
  assert.ok(!result.questions.some((x) => x.id === "extra_14"), "laatste niet-kernvraag is geruild");
  assert.ok(result.questions.some((x) => x.id === "extra_0"), "eerste AI-vragen blijven staan");
});

test("C2 branche-specifiek: branchegerichte AI-vragen blijven behouden na aanvulling", () => {
  const branchQuestions: QuestionnaireQuestion[] = [
    q("branche_1", "Verkopen jullie ook fysieke producten in een winkel?"),
    q("branche_2", "Willen klanten online direct een tafeltje kunnen reserveren?"),
    q("doel_vraag", "Wat moet een bezoeker op de website doen?"),
  ];
  const result = ensureDesignCoreQuestions(branchQuestions, "Restaurant; minimale context");
  const ids = result.questions.map((x) => x.id);
  assert.ok(ids.includes("branche_1") && ids.includes("branche_2"));
  assert.ok(!ids.includes("core_doel"), "doelvraag was al gedekt door de AI");
});

// ---------------------------------------------------------------------------
// Consumptie: questionnaire → Design Plan
// ---------------------------------------------------------------------------

test("consumptie: antwoorden uit ronde 1 ÉN de follow-upronde stromen door, met uploads", () => {
  const questions: QuestionnaireQuestion[] = [q("kern_aanbod", "Wat bied je concreet aan?", "textarea"), q("kern_media", "Welke foto's zijn beschikbaar?")];
  const followUps: QuestionnaireQuestion[] = [q("f_usp", "Waarom zouden klanten voor jullie kiezen?", "textarea")];
  const responses: QuestionnaireResponseLike[] = [
    { round: 1, answers: { kern_aanbod: "Webdesign en logo's", kern_media: "" }, uploads: [] },
    {
      round: 2,
      answers: { f_usp: "Persoonlijk en snel", kern_media: "Er zijn geen foto's beschikbaar" },
      uploads: [{ questionId: "kern_media" }],
    },
  ];
  const lines = buildQuestionnaireAnswerLines(questions, followUps, responses);
  const map = new Map(lines.map((l) => [l.label, l.value]));
  assert.equal(map.get("Wat bied je concreet aan?"), "Webdesign en logo's");
  // Ronde-2-antwoord komt mee — dit ontbrak vroeger volledig.
  assert.equal(map.get("Waarom zouden klanten voor jullie kiezen?"), "Persoonlijk en snel");
  // Eerlijke afzegging + uploadaantekening komen door naar de Design Planning-prompt.
  assert.match(map.get("Welke foto's zijn beschikbaar?") ?? "", /Er zijn geen foto's beschikbaar \[1 bestand/);
});

test("consumptie: nieuwe antwoord overschrijft oudere ronde-antwoorden (nieuwste wint)", () => {
  const questions: QuestionnaireQuestion[] = [q("kern_aanbod", "Wat bied je concreet aan?", "textarea")];
  const responses: QuestionnaireResponseLike[] = [
    { round: 1, answers: { kern_aanbod: "Oude antwoord" }, uploads: [] },
    { round: 2, answers: { kern_aanbod: "Nieuwere antwoord" }, uploads: [] },
  ];
  const lines = buildQuestionnaireAnswerLines(questions, [], responses);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].value, "Nieuwere antwoord");
});

// ---------------------------------------------------------------------------
// Contract-mocking en schema
// ---------------------------------------------------------------------------

test("schema-contract: contentDimensions is VERPLICHT in het completion-antwoord", () => {
  const base = {
    sufficient: true,
    summary: "Voldoende betrouwbare informatie voor een ontwerp- en bouwvoorstel.",
    resolvedInformation: [],
    missingInformation: [],
    followUpQuestions: [],
  };
  assert.ok(!QuestionnaireCompletionSchema.safeParse(base).success, "zonder contentDimensions ongeldig");
  assert.ok(QuestionnaireCompletionSchema.safeParse({ ...base, contentDimensions: FULL_DIMS }).success);
});

test("mock-contract: ronde-2-mock is eerlijk rijk (afgezegd waar geen data), ronde-1 eerlijk onvolledig", async () => {
  const { MockAIProvider } = await import("../lib/ai/mock-provider");
  const provider = new MockAIProvider();
  const call = async (round: number) => {
    const result = await provider.generateText({
      task: "questionnaire_completion",
      model: "mock",
      system: "test",
      prompt: `Bedrijf: Testbedrijf\nRONDE ${round}`,
      maxTokens: 6000,
    });
    return JSON.parse(result.text) as { sufficient: boolean; contentDimensions: Record<string, string> };
  };
  const round1 = await call(1);
  assert.equal(round1.sufficient, false);
  assert.ok(round1.contentDimensions.usps === "" && round1.contentDimensions.branding === "", "ronde 1 eerlijk onvolledig");
  // Deterministische check op de mock-dimensies zelf:
  assert.equal(assessContentRichness(round1.contentDimensions).complete, false);
  const round2 = await call(2);
  assert.equal(round2.sufficient, true);
  assert.match(round2.contentDimensions.proof, /^NIET_BESCHIKBAAR/);
  assert.equal(assessContentRichness(round2.contentDimensions).complete, true, "ronde 2 eerlijk rijk");
});

// ---------------------------------------------------------------------------
// E2E-bugfix: ronde-2-completion ziet ronde-1-antwoorden
// ---------------------------------------------------------------------------

test("bugfix regressie: ronde-2-beoordeling krijgt de ronde-1-antwoorden te zien", () => {
  const questions: QuestionnaireQuestion[] = [
    q("kern_aanbod", "Wat bied je concreet aan?", "textarea"),
    q("kern_usp", "Waarom zouden klanten voor jullie kiezen?", "textarea"),
  ];
  const followUps: QuestionnaireQuestion[] = [q("f_media", "Welke foto's zijn beschikbaar?")];
  const responses: QuestionnaireResponseLike[] = [
    { round: 1, answers: { kern_aanbod: "Webdesign en onderhoud", kern_usp: "Snel en persoonlijk" }, uploads: [] },
    { round: 2, answers: { f_media: "Eén sfeerfoto van het atelier" }, uploads: [] },
  ];
  const round2 = buildCompletionSummaries(questions, followUps, responses, 2);
  // ALLE antwoorden moeten zichtbaar zijn — dit was de E2E-bug.
  assert.match(round2.answersSummary, /Wat bied je concreet aan\?: Webdesign en onderhoud/);
  assert.match(round2.answersSummary, /Waarom zouden klanten voor jullie kiezen\?: Snel en persoonlijk/);
  assert.match(round2.answersSummary, /foto's zijn beschikbaar\?: Eén sfeerfoto van het atelier/);
  // De vragenlijst bevat beide rondes.
  assert.equal(round2.questionsSummary.split("\n").length, 3);
  // Ronde 1 blijft ongewijzigd gedrag: alleen kernvragen.
  const round1 = buildCompletionSummaries(questions, [], [responses[0]], 1);
  assert.equal(round1.questionsSummary.split("\n").length, 2);
  assert.match(round1.answersSummary, /Webdesign en onderhoud/);
});
