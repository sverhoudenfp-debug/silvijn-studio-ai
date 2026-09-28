import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Regressietests voor het sales OUTPUT-CONTRACT (2026-09-28).
 * Aanleiding: het live model kende de toegestane enum-waarden en de
 * qualification-objectvorm niet (prompt noemde ze niet), produceerde
 * qualification als tekst en een objectionType buiten de enum, en faalde
 * daardoor terecht in de Zod-validatie. Het schema is niet gewijzigd;
 * het prompt noemt nu exact de schema-afgeleide contractwaarden en de
 * validatiefeedback-retry (al aanwezig voor design_planning) helpt het
 * model bij een zeldzige misslag.
 */
import { AIService, buildSalesPrompt } from "../lib/ai/service";
import { SalesAnalysisSchema } from "../lib/ai/schemas";

const INPUT = {
  businessName: "Studio Fictief",
  industry: "schilder",
  city: "Utrecht",
  websiteStatus: "no_website_listed",
  website: null,
  leadScore: 49,
  demoUrl: null,
  demoHeadline: null,
  outreachHistory: [],
  previousInbound: [],
  previousInteractions: [],
  inbound: {
    sender: "Klant <klant@example.nl>",
    subject: "Re: test",
    body: "Bedankt voor je bericht, dit is mijn testreactie.",
    receivedAt: "2026-09-28T15:45:00Z",
    channel: "email",
  },
} as Parameters<typeof buildSalesPrompt>[0];

const VALID_OUTPUT = {
  intent: "question",
  objectionType: "none",
  qualification: {
    status: "qualifying",
    interestLevel: "medium",
    projectType: null,
    needsWebsite: true,
    needsEcommerce: false,
    wantsDemo: false,
    wantsCall: false,
    timeline: null,
    budgetKnown: false,
    decisionMakerKnown: false,
    requirementsKnown: false,
    missingInformation: [],
    qualificationNotes: "Vriendelijke testreactie, interesse nog onduidelijk.",
    confidence: 0.5,
  },
  response: "Bedankt voor uw reactie. Wij maken onderscheidende websites voor lokale bedrijven en denken graag mee over wat zichtbaarheid voor uw bedrijf kan opleveren.",
  suggestedNextAction: "Vraag naar wensen en timing van de klant",
  questions: ["Wat wilt u met uw website bereiken?"],
  escalationRequired: false,
  escalationReason: null,
};

test("sales-prompt bevat exact alle enum-opties en qualification-velden uit het schema", () => {
  const prompt = buildSalesPrompt(INPUT);
  for (const opt of SalesAnalysisSchema.shape.intent.options) assert.ok(prompt.includes(opt), `intent-optie ${opt} ontbreekt`);
  for (const opt of SalesAnalysisSchema.shape.objectionType.options) assert.ok(prompt.includes(opt), `objectionType-optie ${opt} ontbreekt`);
  const q = SalesAnalysisSchema.shape.qualification.shape;
  for (const field of Object.keys(q)) assert.ok(prompt.includes(`"${field}"`), `qualification-veld ${field} ontbreekt`);
  for (const opt of [...q.status.options, ...q.interestLevel.options]) assert.ok(prompt.includes(opt), `qualification-enum ${opt} ontbreekt`);
  assert.ok(prompt.includes('"none"'), 'geen-bezwaar-optie "none" moet expliciet in het contract staan');
});

test("qualification als losse string wordt correct afgewezen", () => {
  const parsed = SalesAnalysisSchema.safeParse({ ...VALID_OUTPUT, qualification: "gemiddelde interesse" });
  assert.equal(parsed.success, false);
  assert.ok(!parsed.success && parsed.error.issues.some((i) => i.path.join(".") === "qualification"));
});

test("ongeldige objectionType-waarde wordt correct afgewezen", () => {
  const parsed = SalesAnalysisSchema.safeParse({ ...VALID_OUTPUT, objectionType: "geen_bezwaar" });
  assert.equal(parsed.success, false);
  assert.ok(!parsed.success && parsed.error.issues.some((i) => i.path.join(".") === "objectionType"));
});

test("geldige volledige sales-output wordt geaccepteerd", () => {
  const parsed = SalesAnalysisSchema.safeParse(VALID_OUTPUT);
  assert.equal(parsed.success, true);
});

test("sales-validatiefeedback wordt gebruikt bij een retry (eerst ongeldig, dan geldig)", async () => {
  const service = new AIService();
  const prompts: string[] = [];
  let call = 0;
  Object.defineProperty(service, "provider", {
    get: () => ({
      generateText: async (request: { prompt: string }) => {
        prompts.push(request.prompt);
        call += 1;
        const output =
          call === 1
            ? { ...VALID_OUTPUT, objectionType: "geen_bezwaar", qualification: "tekst in plaats van object" }
            : VALID_OUTPUT;
        return {
          text: JSON.stringify(output),
          model: "mock",
          mode: "mock",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
    }),
  });
  const result = await service.generateStructured(
    { agent: "sales", system: "test", prompt: buildSalesPrompt(INPUT), maxTokens: 2000 },
    SalesAnalysisSchema
  );
  assert.equal(result.data.objectionType, "none");
  assert.equal(prompts.length, 2, "eerste poging ongeldig → één retry met feedback");
  assert.equal(prompts[0], buildSalesPrompt(INPUT));
  assert.ok(prompts[1].includes("VALIDATIEFEEDBACK"), "retry-prompt bevat de feedback");
  assert.ok(prompts[1].includes("objectionType:"), "feedback bevat de concrete objectionType-fout");
  assert.ok(prompts[1].includes("qualification:"), "feedback bevat de concrete qualification-fout");
  assert.ok(prompts[1].includes("OUTPUT-CONTRACT"), "retry herhaalt het oorspronkelijke contract");
});

test("exhausteert retry-limiet bij herhaald ongeldige output en gooit de schemafout", async () => {
  const service = new AIService();
  let calls = 0;
  Object.defineProperty(service, "provider", {
    get: () => ({
      generateText: async () => {
        calls += 1;
        return { text: JSON.stringify({ ...VALID_OUTPUT, qualification: "tekst" }), model: "mock", mode: "mock", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
      },
    }),
  });
  await assert.rejects(
    service.generateStructured({ agent: "sales", system: "test", prompt: buildSalesPrompt(INPUT) }, SalesAnalysisSchema),
    (err: Error) => err.message.includes("AI-output voldoet niet aan het schema")
  );
  assert.equal(calls, 3, "1 poging + 2 retries (bestaande limiet, niet verhoogd)");
});
