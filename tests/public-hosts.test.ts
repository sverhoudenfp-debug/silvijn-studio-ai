import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_TEXTAREA_ANSWER,
  questionnaireQuestionsSchema,
  questionnaireSlugSchema,
  validateQuestionnaireAnswers,
} from "../lib/questionnaire/validation";

const root = process.cwd();
const read = (f: string) => readFileSync(`${root}/${f}`, "utf8");

const questions = [
  { id: "name", label: "Wat is je naam?", type: "text" as const, required: true },
  { id: "email", label: "E-mail", type: "email" as const },
  { id: "color", label: "Voorkeur", type: "select" as const, options: ["Blauw", "Groen"], required: true },
  { id: "notes", label: "Toelichting", type: "textarea" as const },
];

test("proxy routes public hosts to public flows and never to /login", () => {
  const s = read("proxy.ts");
  assert.match(s, /DEMO_HOST = "demo\.silvijnstudio\.com"/);
  assert.match(s, /QUESTIONNAIRE_HOST = "questionnaire\.silvijnstudio\.com"/);
  // Public host branches rewrite/next BEFORE any Supabase auth logic runs
  const demoBranch = s.slice(s.indexOf('host === DEMO_HOST'), s.indexOf("host === QUESTIONNAIRE_HOST"));
  assert.doesNotMatch(demoBranch, /\/login/);
  assert.match(demoBranch, /NextResponse\.rewrite\(new URL\("\/demo", request\.url\)\)/);
  assert.match(demoBranch, /rewrite\(new URL\(`\/demo\$\{pathname\}`, request\.url\)\)/);
  const qBranch = s.slice(s.indexOf("host === QUESTIONNAIRE_HOST"), s.indexOf("if (!isProtectedPath(pathname))"));
  assert.doesNotMatch(qBranch, /\/login/);
  assert.match(qBranch, /NextResponse\.rewrite\(new URL\("\/questionnaire", request\.url\)\)/);
  assert.match(qBranch, /rewrite\(new URL\(`\/questionnaire\$\{pathname\}`, request\.url\)\)/);
  // The auth redirect applies only to the protected internal prefix set
  assert.match(s, /if \(!isProtectedPath\(pathname\)\) return NextResponse\.next\(\);/);
  for (const route of ["/dashboard", "/leads", "/conversations", "/sales", "/projects", "/demo-websites", "/analytics", "/settings", "/automation"]) {
    assert.ok(s.includes(`"/${route.slice(1)}"`), `missing protected prefix ${route}`);
  }
  // Public demo/questionnaire routes are NOT in the protected prefix set
  const prefixes = s.slice(s.indexOf("const PROTECTED_PREFIXES"), s.indexOf("function hostname"));
  assert.doesNotMatch(prefixes, /"\/(demo|questionnaire)"/);
  // Matcher excludes API/static assets
  assert.match(s, /matcher: \["\/\(\(\?!api\|_next\/static\|_next\/image\|favicon\.ico\)\.\*\)"\]/);
});

test("public pages never require studio owner and unknown slugs 404", () => {
  for (const f of ["app/demo/page.tsx", "app/questionnaire/page.tsx", "app/questionnaire/[slug]/page.tsx"]) {
    const s = read(f);
    assert.doesNotMatch(s, /requireStudioOwner/, f);
    assert.doesNotMatch(s, /getLeadRepository|listByLead|\.list\(\)/, `${f} mag geen leaddata laden`);
  }
  const demoPage = read("app/demo/[slug]/page.tsx");
  assert.doesNotMatch(demoPage, /requireStudioOwner/);
  assert.match(demoPage, /notFound\(\)/);
  // De demo-pagina laadt uitsluitend de lead van d\u00e9ze demo-slug, geen lijsten
  assert.match(demoPage, /findBySlug\(slug\)/);
  assert.match(demoPage, /getLeadRepository\(\)\.get\(demo\.leadId\)/);
  assert.match(read("app/questionnaire/[slug]/page.tsx"), /notFound\(\)/);
});

test("public questionnaire submit lives outside the owner-protected action map", () => {
  const s = read("app/questionnaire/actions.ts");
  assert.match(s, /"use server"/);
  assert.doesNotMatch(s, /requireStudioOwner/);
  assert.match(s, /submitQuestionnaireResponse\(slug\.data, raw\)/);
});

test("answers validate strictly against the questionnaire definitions", () => {
  const ok = validateQuestionnaireAnswers(questions, { name: "Jansen", color: "Blauw", email: "jansen@example.invalid", notes: "", rogue: "wordt genegeerd" });
  assert.deepEqual(ok.answers, { name: "Jansen", color: "Blauw", email: "jansen@example.invalid" });

  assert.throws(() => validateQuestionnaireAnswers(questions, { color: "Blauw" }), /verplicht/);
  assert.throws(() => validateQuestionnaireAnswers(questions, { name: "Jansen", color: "Rood" }), /ongeldig antwoord/);
  assert.throws(() => validateQuestionnaireAnswers(questions, { name: "Jansen", color: "Blauw", email: "geen-email" }), /e-mailadres/);
  assert.throws(
    () => validateQuestionnaireAnswers(questions, { name: "Jansen", color: "Blauw", notes: "x".repeat(MAX_TEXTAREA_ANSWER + 1) }),
    /te lang/
  );
});

test("question and slug schemas reject malformed definitions and links", () => {
  assert.ok(questionnaireQuestionsSchema.safeParse(questions).success);
  assert.equal(questionnaireQuestionsSchema.safeParse([]).success, false);
  assert.equal(questionnaireQuestionsSchema.safeParse([{ id: "q", label: "V", type: "banner" }]).success, false);
  assert.equal(questionnaireSlugSchema.safeParse("jansen-dakwerken").success, true);
  assert.equal(questionnaireSlugSchema.safeParse("Jansen Dakwerken").success, false);
  assert.equal(questionnaireSlugSchema.safeParse("../leads").success, false);
});

test("migration keeps questionnaires private at the database level", () => {
  const s = read("supabase/migrations/0013_public_questionnaires.sql");
  assert.match(s, /alter table public\.questionnaires enable row level security;/);
  assert.match(s, /alter table public\.questionnaire_responses enable row level security;/);
  assert.doesNotMatch(s, /create policy/i);
  assert.match(s, /revoke all on public\.questionnaires, public\.questionnaire_responses from anon;/);
  assert.match(s, /grant select, insert on public\.questionnaires, public\.questionnaire_responses to service_role;/);
  assert.match(s, /QUESTIONNAIRE_NOT_ACTIVE/);
});
