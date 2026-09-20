import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assembleContentSourceBundle,
  assembleQuestionnaireItems,
  computeContentSourceFingerprint,
  CONTENT_SOURCE_ORIGINS,
  type ContentSourceInput,
  type LeadSourceInput,
} from "@/lib/websites/content/content-source";
import { buildQuestionnaireAnswerLines, type QuestionnaireResponseLike } from "@/lib/questionnaire/summary";
import type { QuestionnaireQuestion } from "@/lib/questionnaire/validation";
import { designPlanSchema } from "@/lib/websites/design-plan";
import { buildMockDesignPlan } from "@/lib/ai/mock-provider";
import type { ProjectRequirements } from "@/lib/projects/types";

// ---------------------------------------------------------------------------
// C3a — SOURCE BUNDLE: completeness, provenance, beide rondes, trustedClaims,
// fingerprint/versioning
// ---------------------------------------------------------------------------

const LEAD: LeadSourceInput = {
  businessName: "Bakkerij De Gouden Korst",
  industry: "Bakkerij",
  address: "Voorstraat 12",
  city: "Utrecht",
  province: "Utrecht",
  phone: "030-1234567",
  email: "info@goudenkorst.nl",
  website: null,
  websiteStatus: "no_website",
  googleRating: 4.8,
  reviewCount: 23,
};

const QUESTIONS: QuestionnaireQuestion[] = [
  { id: "q-aanbod", label: "Wat bied je concreet aan?", type: "textarea" },
  { id: "q-usp", label: "Waarom kiezen klanten voor jullie?", type: "textarea" },
  { id: "q-bewijs", label: "Heb je voorbeelden of reviews die we mogen tonen?", type: "textarea" },
];
const FOLLOW_UPS: QuestionnaireQuestion[] = [
  { id: "fu-bewijs", label: "Heb je voorbeelden van eerdere projecten, reviews of resultaten die we op de site kunnen tonen? Zo niet, laat dit weten.", type: "textarea" },
  { id: "fu-deadline", label: "Is er een gewenste opleverdatum voor de website?", type: "text" },
];

const REQUIREMENTS: ProjectRequirements = {
  numberOfPages: 3,
  websiteType: "Brochurewebsite",
  designLevel: "standard",
  copywriting: true,
  seo: true,
  deadline: "binnen twee maanden",
};

const MOCK_PROMPT = [
  "Plan het INTERNE Design Plan (JSON).",
  `Bedrijf: ${LEAD.businessName}`,
  `Branche: ${LEAD.industry}`,
  `Plaats: ${LEAD.city}`,
  `AANTAL PAGINA'S (bindend voor de paginastructuur): 3`,
  "E-COMMERCE: nee",
].join("\n");

function mockPlan(): ReturnType<typeof designPlanSchema.parse> {
  return designPlanSchema.parse(JSON.parse(buildMockDesignPlan(MOCK_PROMPT)));
}

function planInput(overrides: {
  qualifications?: string[];
  questionnaire?: ContentSourceInput["questionnaire"];
  requirements?: ProjectRequirements;
  plan?: ReturnType<typeof designPlanSchema.parse>;
}): ContentSourceInput {
  return {
    lead: LEAD,
    qualificationNotes: overrides.qualifications ?? [],
    questionnaire:
      overrides.questionnaire === undefined
        ? { questions: QUESTIONS, followUpQuestions: FOLLOW_UPS, responses: [] }
        : overrides.questionnaire,
    requirements: overrides.requirements ?? REQUIREMENTS,
    designPlan: overrides.plan ?? mockPlan(),
  };
}

test("source-bundle: completeness — alle origins komen voor met verwachte items", () => {
  const bundle = assembleContentSourceBundle(
    planInput({
      qualifications: ["Eigenaar wil nadruk op ambachtelijkheid"],
      questionnaire: {
        questions: QUESTIONS,
        followUpQuestions: FOLLOW_UPS,
        responses: [
          { round: 1, answers: { "q-aanbod": "Verse broodjes, taarten en catering" } },
          { round: 2, answers: { "fu-bewijs": "Reviews: 'Heerlijk brood' — klant Jansen" } },
        ],
      },
    })
  );
  const origins = new Set(bundle.items.map((item) => item.origin));
  for (const origin of CONTENT_SOURCE_ORIGINS) {
    assert.ok(origins.has(origin), `origin ${origin} ontbreekt`);
  }
  const keyOf = (origin: string, key: string) => bundle.items.some((i) => i.origin === origin && i.key === key);
  assert.ok(keyOf("lead", "businessName"));
  assert.ok(keyOf("lead", "phone"));
  assert.ok(keyOf("lead", "googleRating"));
  assert.ok(keyOf("qualification", "note:0"));
  assert.ok(keyOf("questionnaire", "q-aanbod"));
  assert.ok(keyOf("questionnaire", "fu-bewijs"));
  assert.ok(keyOf("requirements", "copywriting"));
  assert.ok(keyOf("requirements", "numberOfPages"));
  assert.ok(keyOf("design_plan", "goal:primary"));
  // blueprint-items alleen als het plan een blueprint heeft (mock heeft dat)
});

test("source-bundle: provenance — élk item heeft origin, key en niet-lege text", () => {
  const bundle = assembleContentSourceBundle(
    planInput({
      questionnaire: {
        questions: QUESTIONS,
        followUpQuestions: FOLLOW_UPS,
        responses: [{ round: 1, answers: { "q-usp": "Alles vers uit eigen keuken" } }],
      },
    })
  );
  assert.ok(bundle.items.length > 0);
  for (const item of bundle.items) {
    assert.ok(CONTENT_SOURCE_ORIGINS.includes(item.origin), `onbekende origin ${item.origin}`);
    assert.ok(item.key.length > 0 && !item.key.includes(" "), `key moet machine-leesbaar zijn: "${item.key}"`);
    assert.ok(item.text.trim().length > 0);
  }
  // Lege/null-bronnen worden overgeslagen (geen lege items).
  assert.ok(!bundle.items.some((i) => i.text.trim().length === 0));
});

test("source-bundle: questionnaire beide rondes — nieuwste antwoord wint, follow-up zichtbaar", () => {
  const responses: QuestionnaireResponseLike[] = [
    { round: 1, answers: { "q-aanbod": "Oude formulering ronde 1", "q-bewijs": "" } },
    { round: 2, answers: { "q-aanbod": "Nieuwe formulering ronde 2", "fu-deadline": "Binnen twee maanden" } },
  ];
  const bundle = assembleContentSourceBundle(
    planInput({ questionnaire: { questions: QUESTIONS, followUpQuestions: FOLLOW_UPS, responses } })
  );
  const aanbod = bundle.items.find((i) => i.key === "q-aanbod");
  assert.ok(aanbod, "ronde-1-vraag moet in de bundel staan");
  assert.ok(aanbod!.text.includes("Nieuwe formulering ronde 2"), "nieuwste antwoord wint");
  assert.ok(!aanbod!.text.includes("Oude formulering"), "oud antwoord is vervangen");
  // Leeg ronde-1-antwoord op q-bewijs: geen item.
  assert.ok(!bundle.items.some((i) => i.key === "q-bewijs"), "lege antwoorden leveren geen item");
  // Follow-up-id uit ronde 2 staat er wél (5826edc-consumptieleem dicht).
  const deadline = bundle.items.find((i) => i.key === "fu-deadline");
  assert.ok(deadline, "ronde-2-antwoord op nieuwe follow-up-id moet zichtbaar zijn");
  assert.ok(deadline!.text.includes("twee maanden"));
});

test("source-bundle: questionnaire-pariteit met buildQuestionnaireAnswerLines (semantische spiegel)", () => {
  const responses: QuestionnaireResponseLike[] = [
    { round: 1, answers: { "q-aanbod": "Vers brood" }, uploads: [{ questionId: "q-usp" }] },
    { round: 2, answers: { "fu-bewijs": "Review van Jansen" } },
  ];
  const items = assembleQuestionnaireItems({ questions: QUESTIONS, followUpQuestions: FOLLOW_UPS, responses });
  const lines = buildQuestionnaireAnswerLines(QUESTIONS, FOLLOW_UPS, responses);
  // Zelfde regels, zelfde volgorde, zelfde teksten — geen divergentie tussen
  // Design Planning-consumptie en content-pass-bronnen.
  assert.equal(items.length, lines.length);
  for (let i = 0; i < lines.length; i++) {
    assert.equal(items[i].text, `${lines[i].label}: ${lines[i].value}`);
  }
});

test("source-bundle: trustedClaims = lead-feiten + questionnaire + trustElements", () => {
  const responses = [{ round: 1, answers: { "q-usp": "Alles vers uit eigen keuken" } }];
  const bundle = assembleContentSourceBundle(
    planInput({ questionnaire: { questions: QUESTIONS, followUpQuestions: FOLLOW_UPS, responses } })
  );
  const joined = bundle.trustedClaims.join("\n");
  assert.ok(joined.includes(LEAD.businessName), "lead-feiten zijn trusted claims");
  assert.ok(joined.includes("Alles vers uit eigen keuken"), "questionnaire-antwoorden zijn trusted claims");
  // Requirements/design_plan-items zijn GEEN trusted claims op zich.
  assert.ok(!bundle.trustedClaims.some((c) => c.includes("copywriting=")), "requirements moeten buiten trustedClaims blijven");
  assert.ok(!bundle.trustedClaims.some((c) => c.includes("[bron:")), "design_plan-items blijven buiten trustedClaims");
  assert.ok(!bundle.trustedClaims.some((c) => c.includes("sectie ")), "blueprint-sectie-items blijven buiten trustedClaims");
});

test("source-bundle: fingerprint — deterministisch, volgorde-onafhankelijk, verandert met content", () => {
  const base = planInput({
    questionnaire: {
      questions: QUESTIONS,
      followUpQuestions: FOLLOW_UPS,
      responses: [{ round: 1, answers: { "q-aanbod": "Verse broodjes" } }],
    },
  });
  const a = assembleContentSourceBundle(base);
  const b = assembleContentSourceBundle(base);
  assert.equal(a.fingerprint, b.fingerprint, "zelfde input → zelfde fingerprint");
  assert.ok(a.fingerprint.length >= 16, "fingerprint is hex-64bit");

  // Item-volgorde mag niet uitmaken (de bundel sorteert canoniek zelf).
  const shuffled = [...a.items].reverse();
  assert.equal(computeContentSourceFingerprint(shuffled), a.fingerprint);

  // Gewijzigde brontekst → andere fingerprint.
  const changed = assembleContentSourceBundle(
    planInput({
      questionnaire: {
        questions: QUESTIONS,
        followUpQuestions: FOLLOW_UPS,
        responses: [{ round: 1, answers: { "q-aanbod": "Verse broodjes én taarten" } }],
      },
    })
  );
  assert.notEqual(a.fingerprint, changed.fingerprint);

  // Toegevoegde note → andere fingerprint.
  const withNote = assembleContentSourceBundle(planInput({ qualifications: ["Extra notitie"] }));
  assert.notEqual(a.fingerprint, withNote.fingerprint);
});

test("source-bundle: versie + v1-compat — plan zonder blueprint bouwt gewoon", () => {
  const plan = mockPlan();
  plan.blueprint = null;
  const bundle = assembleContentSourceBundle(planInput({ plan }));
  assert.equal(bundle.version, 1);
  assert.ok(!bundle.items.some((i) => i.origin === "blueprint"), "zonder blueprint geen blueprint-items");
  assert.ok(bundle.items.length > 0, "bundel blijft bruikbaar zonder blueprint");
  assert.ok(bundle.fingerprint.length >= 16);
});
