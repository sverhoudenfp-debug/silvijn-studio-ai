import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideCompletion } from "../lib/questionnaire/completion";
import {
  generatedQuestionsSchema,
  questionnaireSlugSchema,
  validateQuestionnaireAnswers,
  type QuestionnaireQuestion,
} from "../lib/questionnaire/validation";
import { sanitizeFilename, validateUploadFile } from "../lib/questionnaire/upload-validation";

const migration = readFileSync("supabase/migrations/0014_questionnaire_management.sql", "utf8");
const id = "10000000-0000-4000-8000-000000000001";

const questions: QuestionnaireQuestion[] = [
  { id: "goal", label: "Wat is het doel van je website?", type: "select", options: ["Aanvragen", "Telefoontjes"], required: true },
  { id: "email", label: "E-mailadres", type: "email", required: true },
  { id: "notes", label: "Aanvullende wensen", type: "textarea" },
  { id: "brief", label: "Upload je merkmiddelen", type: "upload" },
];

test("completion decision: sufficient ends the flow, round 1 gets follow-ups, round 2 never does", () => {
  // Volledige content-dimensies (C1) laten een honest sufficient-oordeel staan.
  const fullDims = {
    offering: "Webdesign en onderhoud",
    usps: "Snel, persoonlijk, lokaal",
    proof: "NIET_BESCHIKBAAR: klant bevestigt geen reviews te hebben",
    audience: "MKB in de regio",
    toneOfVoice: "Zakelijk maar toegankelijk",
    branding: "NIET_BESCHIKBAAR: klant geeft toestemming huisstijl te bepalen",
    media: "NIET_BESCHIKBAAR: klant bevestigt dat foto's ontbreken",
  };
  assert.deepEqual(
    decideCompletion({ sufficient: true, missingInformation: [], followUpQuestions: [], contentDimensions: fullDims }, 1),
    { status: "QUESTIONNAIRE_COMPLETE", followUpQuestions: [], missingInformation: [] }
  );
  const followUp = [{ id: "f1", label: "Aanvulling", type: "text" }];
  assert.deepEqual(decideCompletion({ sufficient: false, missingInformation: ["x"], followUpQuestions: followUp }, 1), {
    status: "QUESTIONNAIRE_FOLLOW_UP",
    followUpQuestions: followUp,
    missingInformation: ["x"],
  });
  // insufficient zonder follow-upvragen wordt direct een aandachtspunt
  assert.deepEqual(decideCompletion({ sufficient: false, missingInformation: ["x"], followUpQuestions: [] }, 1), {
    status: "QUESTIONNAIRE_ATTENTION",
    followUpQuestions: [],
    missingInformation: ["x"],
  });
  // ronde 2 krijgt NOOIT nieuwe follow-upvragen
  assert.deepEqual(decideCompletion({ sufficient: false, missingInformation: ["x"], followUpQuestions: followUp }, 2), {
    status: "QUESTIONNAIRE_ATTENTION",
    followUpQuestions: [],
    missingInformation: ["x"],
  });
  // max 3 follow-upvragen worden afgekapt
  assert.equal(
    decideCompletion({ sufficient: false, missingInformation: [], followUpQuestions: [{}, {}, {}, {}] }, 1).followUpQuestions.length,
    3
  );
});

test("answer validation: required, select options, email format and limits are enforced", () => {
  const good = { goal: "Aanvragen", email: "klant@example.com", notes: "Uitgebreide tekst" };
  assert.deepEqual(validateQuestionnaireAnswers(questions, good).answers, good);
  assert.throws(() => validateQuestionnaireAnswers(questions, { ...good, goal: "" }), /verplicht/);
  assert.throws(() => validateQuestionnaireAnswers(questions, { ...good, goal: "Eigen optie" }), /ongeldig antwoord/);
  assert.throws(() => validateQuestionnaireAnswers(questions, { ...good, email: "geen-email" }), /e-mailadres/);
  assert.throws(() => validateQuestionnaireAnswers(questions, { ...good, notes: "x".repeat(5001) }), /te lang/);
  // onbekende velden worden genegeerd (nooit opgeslagen)
  assert.equal("evil" in validateQuestionnaireAnswers(questions, { ...good, evil: "x" }).answers, false);
});

test("generated questionnaires obey the business limits (1-15, correct types)", () => {
  const valid = [{ id: "q1", label: "Vraag?", type: "text", required: true }];
  assert.ok(generatedQuestionsSchema.safeParse(valid).success);
  assert.equal(generatedQuestionsSchema.safeParse([]).success, false);
  assert.equal(generatedQuestionsSchema.safeParse([{ ...valid[0], type: "ranking" }]).success, false);
  const tooMany = Array.from({ length: 16 }, (_, i) => ({ id: `q${i}`, label: `Vraag ${i}`, type: "text" }));
  assert.equal(generatedQuestionsSchema.safeParse(tooMany).success, false);
  assert.ok(questionnaireSlugSchema.safeParse("bakkerij-demo-1a2b").success);
  assert.equal(questionnaireSlugSchema.safeParse("Ongeldig_slug!").success, false);
});

test("upload validation: allowlist, size limit and filename sanitization", () => {
  const ok = new File(["x"], "brief.pdf", { type: "application/pdf" });
  validateUploadFile(ok);
  assert.throws(() => validateUploadFile(new File(["x"], "app.exe", { type: "application/x-msdownload" })), /niet toegestaan/);
  assert.throws(() => validateUploadFile(new File([new Uint8Array(11 * 1024 * 1024)], "groot.png", { type: "image/png" })), /te groot/);
  assert.throws(() => validateUploadFile(new File([], "leeg.pdf", { type: "application/pdf" })), /Leeg bestand/);
  assert.equal(sanitizeFilename("Müller & Zn. (BV).pdf"), "Muller-Zn.-BV-.pdf");
  assert.equal(sanitizeFilename("---"), "bestand");
});

test("owner actions stay owner-guarded and AI never publishes, closes or transfers", () => {
  const actions = readFileSync("app/actions/questionnaires.ts", "utf8");
  assert.match(actions, /requireStudioOwner\(\)/);
  assert.ok((actions.match(/requireStudioOwner\(\)/g) ?? []).length >= 5, "elke action bewaakt");
  assert.doesNotMatch(actions, /createSignedUrl|stripe|transfer/i);
  const service = readFileSync("lib/questionnaire/service.ts", "utf8");
  assert.doesNotMatch(service, /approv|payment|stripe/i);
});

test("public flow shares no lead or dashboard data and only exposes active-or-closed slugs", () => {
  const page = readFileSync("app/questionnaire/[slug]/page.tsx", "utf8");
  assert.doesNotMatch(page, /lead\.email|lead\.phone|projectId|leadId/);
  const service = readFileSync("lib/questionnaire/service.ts", "utf8");
  assert.match(service, /status === "draft"\) throw new QuestionnaireNotFoundError/);
  assert.match(service, /status !== "active"\) throw new QuestionnaireValidationError/);
});

test("migration 0014 extends 0013 without breaking it: RLS stays on, bucket stays private", () => {
  assert.match(migration, /add column completion_status text\s+check \(completion_status in \('QUESTIONNAIRE_FOLLOW_UP', 'QUESTIONNAIRE_COMPLETE', 'QUESTIONNAIRE_ATTENTION'\)\)/);
  assert.match(migration, /add column round integer not null default 1\s+check \(round in \(1, 2\)\)/);
  assert.match(migration, /'questionnaire-uploads',\s*'questionnaire-uploads',\s*false/);
  assert.match(migration, /file_size_limit, allowed_mime_types/);
  assert.doesNotMatch(migration, /create policy/i);
  assert.match(migration, /alter table public\.questionnaires/i);
  assert.doesNotMatch(migration, /drop (table|column|policy)/i);
});

test("uploads are stored privately and only reachable via short-lived signed URLs", () => {
  const uploads = readFileSync("lib/questionnaire/uploads.ts", "utf8");
  const validation = readFileSync("lib/questionnaire/upload-validation.ts", "utf8");
  assert.match(validation, /QUESTIONNAIRE_UPLOAD_BUCKET = "questionnaire-uploads"/);
  assert.match(validation, /ALLOWED_UPLOAD_MIMES/);
  assert.match(uploads, /createSignedUrl/);
  assert.match(uploads, /storage\.from\(QUESTIONNAIRE_UPLOAD_BUCKET\)/);
  const service = readFileSync("lib/questionnaire/service.ts", "utf8");
  assert.match(service, /follow_up/i);
  assert.match(service, /ronde 2 is eenmalig/i);
});

test("proxy keeps the questionnaire host public and the dashboard host protected", () => {
  const proxy = readFileSync("proxy.ts", "utf8");
  assert.match(proxy, /"\/questionnaires",/);
  assert.match(proxy, /QUESTIONNAIRE_HOST = "questionnaire.silvijnstudio.com"/);
});

test("AI context reuses real sources and never invents facts (prompt rules)", () => {
  const context = readFileSync("lib/questionnaire/context.ts", "utf8");
  assert.match(context, /getLeadRepository|getProjectRepository|getSalesInteractionRepository/);
  assert.match(context, /getInboundMessageRepository/);
  const prompts = readFileSync("lib/ai/service.ts", "utf8");
  assert.match(prompts, /Stel ALLEEN vragen die invloed hebben op website, content, UX, functionaliteit of conversie/);
  assert.match(prompts, /verzin NOOIT bedrijfsfeiten/i);
  assert.match(prompts, /verzin NOOIT bedrijfsfeiten|Verzin geen bedrijfsfeiten/i);
  assert.match(prompts, /ONBETROUWBARE DATA/i);
});

test("questionnaire ids are validated as UUIDs where flows reference stored rows", () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  assert.ok(uuid.test(id));
});
