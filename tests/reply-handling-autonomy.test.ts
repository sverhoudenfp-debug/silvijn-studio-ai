import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as typeof import("node:module") & { _load: (r: string, p: unknown, m: boolean) => unknown };
const originalLoad = Module._load.bind(Module);
Module._load = function intercepted(request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "next/navigation") return { redirect() { throw new Error("redirect"); } };
  if (request === "next/headers") return { cookies: async () => ({ getAll: () => [], set() {} }) };
  return originalLoad(request, parent, isMain);
};

// Dynamische imports: ESM hoist zou de statische imports vóór de _load-hook laden.
const settings = () => import("../lib/settings/studio-settings");
const pipeline = () => import("../lib/sales/reply-pipeline");

const migration = readFileSync("supabase/migrations/0028_studio_settings_reply_handling.sql", "utf8");

test("0028: reply_handling_mode defaults to off; only the owner RPC can change it; every change is audited", () => {
  assert.match(migration, /values \('reply_handling_mode', '"off"'::jsonb\)/);
  // Tabel bestaat sinds 0010 (pricing-config, RLS + select-only): 0028 is additief en raakt de pricing-rij nooit.
  assert.doesNotMatch(migration, /create table|drop |'pricing'/);
  assert.match(migration, /add column if not exists updated_by/);
  assert.match(migration, /on conflict \(key\) do nothing/);
  assert.match(migration, /raise exception 'UNKNOWN_SETTING'/);
  assert.match(migration, /if not public\.is_studio_owner\(\) then\s+raise exception 'HUMAN_AUTHORIZATION_REQUIRED'/);
  assert.match(migration, /not in \('off','review','auto'\)/);
  assert.match(migration, /revoke all on function public\.set_studio_setting\(text, jsonb\) from public, anon, service_role/);
  assert.match(migration, /insert into public\.audit_events/);
  assert.doesNotMatch(migration, /price_approvals|payment_confirmations|transition_lead|outreach_drafts/i);
});

test("settings module: default off, memory-mode set/get, labels never promise price/payment autonomy", async () => {
  const { getReplyHandlingMode, setReplyHandlingMode, REPLY_HANDLING_LABELS } = await settings();
  assert.equal(await getReplyHandlingMode(), "off");
  assert.equal(await setReplyHandlingMode("review"), "review");
  assert.equal(await getReplyHandlingMode(), "review");
  await setReplyHandlingMode("off");
  assert.match(REPLY_HANDLING_LABELS.auto.description, /prijzen, betalingen en levering blijven menselijk/i);
});

test("gmail-ingest trigger: pipeline runs without an owner session; an owner_command round still requires the owner", async () => {
  const { processPendingReplies } = await pipeline();
  const result = await processPendingReplies({ ownerUserId: null, trigger: "gmail_ingest", mode: "review", limit: 5 });
  assert.equal(result.errors.length, 0);
  await assert.rejects(processPendingReplies({ ownerUserId: null, mode: "review" }), /OWNER_REQUIRED/);
});

test("questionnaire paragraph is appended once, verbatim URL, never duplicated", async () => {
  const { appendQuestionnaireParagraph } = await pipeline();
  const url = "https://questionnaire.silvijnstudio.com/test-slug";
  const once = appendQuestionnaireParagraph("Dank voor uw reactie.", url);
  assert.ok(once.endsWith(url));
  assert.match(once, /korte vragenlijst/);
  assert.equal(appendQuestionnaireParagraph(once, url), once);
});

test("reply-pipeline: questionnaire link only for positive intent with medium/high interest; never a fabricated URL", () => {
  const src = readFileSync("lib/sales/reply-pipeline.ts", "utf8");
  assert.match(src, /POSITIVE_INTENTS\.includes\(intent\) && \["medium", "high"\]\.includes\(interestLevel\)/);
  assert.match(src, /if \(questionnaire\.url\)/);
  const step = readFileSync("lib/sales/questionnaire-step.ts", "utf8");
  assert.match(step, /return \{ url: null, created: false, reason/);
  assert.doesNotMatch(step, /price|stripe|payment|project_production|transition/i);
  // De stap hergebruikt bestaande vragenlijsten en maakt nooit een tweede aan.
  assert.match(step, /existing\.find\(\(q\) => q\.status === "active"\)/);
});

test("gmail send: atomic claim happens before the provider call and the sent-record is bound to the claimed header", () => {
  const src = readFileSync("lib/gmail/send.ts", "utf8");
  const claim = src.indexOf('.is("provider_message_id", null)');
  const send = src.indexOf("gmailResult = await gmailSend(");
  assert.ok(claim > 0 && send > claim, "claim must precede the provider call");
  assert.match(src, /dubbelverzending voorkomen/);
  assert.match(src, /update\(\{ status: "failed" \}\)/);
  assert.match(src, /\.eq\("status", "approved"\)\s*\.eq\("provider_message_id", messageIdHeader\)/);
});

test("sales context feeds the AI what we actually sent (subject + body), not only draft subjects", () => {
  const src = readFileSync("lib/sales/service.ts", "utf8");
  assert.match(src, /filter\(\(d\) => d\.status === "sent"\)/);
  assert.match(src, /d\.body\.slice\(0, 700\)/);
});
