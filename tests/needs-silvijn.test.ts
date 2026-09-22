import test from "node:test";
import assert from "node:assert/strict";

// lib/dashboard/needs-silvijn.ts is server-only; in de testcontext wordt die
// marker gestubd (zelfde patroon als automation-runtime.test.ts). De pure
// builder importeert geen repositories.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as typeof import("node:module") & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = Module._load.bind(Module);
Module._load = function intercepted(request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

import { buildNeedsSilvijnItems, type NeedsSilvijnInput } from "../lib/dashboard/needs-silvijn";

const t = (day: number) => `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`;

function baseInput(): NeedsSilvijnInput {
  return { websites: [], projects: [], gates: {}, interactions: [], inbound: [], outreach: [], questionnaires: [] };
}

test("G7: empty input yields no items", () => {
  assert.deepEqual(buildNeedsSilvijnItems(baseInput()), []);
});

test("G7: every human gate produces exactly one item, sorted oldest first, and non-gates are ignored", () => {
  const input = baseInput();
  input.websites = [
    { id: "w1", slug: "site-a", businessName: "A", status: "ready_for_silvijn", updatedAt: t(5) },
    { id: "w2", slug: "site-b", businessName: "B", status: "ready_for_qc", updatedAt: t(1) },
    { id: "w3", slug: "site-c", businessName: "C", status: "approved", updatedAt: t(1) },
  ] as unknown as NeedsSilvijnInput["websites"];
  input.projects = [
    { id: "p1", name: "P1", status: "price_ready", priceStatus: "ready", estimatedPrice: 1295, updatedAt: t(2) },
    { id: "p2", name: "P2", status: "awaiting_approval", priceStatus: "requires_human", estimatedPrice: null, updatedAt: t(3) },
    { id: "p3", name: "P3", status: "approved", priceStatus: "approved", estimatedPrice: 895, updatedAt: t(4) },
    { id: "p4", name: "P4", status: "approved", priceStatus: "approved", estimatedPrice: 895, updatedAt: t(4) },
    { id: "p5", name: "P5", status: "cancelled", priceStatus: "ready", estimatedPrice: 895, updatedAt: t(1) },
    { id: "p6", name: "P6", status: "quotation_pending", priceStatus: "missing_information", estimatedPrice: null, updatedAt: t(1) },
  ] as unknown as NeedsSilvijnInput["projects"];
  input.gates = {
    p3: { allowed: false, paid: 0, approved: 895, required: 895, requirementsComplete: true, fullyPaid: false },
    p4: { allowed: true, paid: 895, approved: 895, required: 895, requirementsComplete: true, fullyPaid: true },
  };
  input.interactions = [
    { id: "i1", inboundMessageId: "m3", status: "ready_for_silvijn", escalationReason: "Klant vraagt korting", intent: "price_question", suggestedNextAction: "escalate", qualification: { status: "needs_human" }, updatedAt: t(6) },
    { id: "i2", inboundMessageId: "m2", status: "draft", escalationReason: null, intent: "interested", suggestedNextAction: "reply", qualification: { status: "needs_human" }, updatedAt: t(7) },
    { id: "i3", inboundMessageId: "m4", status: "handled", escalationReason: null, intent: "interested", suggestedNextAction: "reply", qualification: { status: "qualified" }, updatedAt: t(1) },
  ] as unknown as NeedsSilvijnInput["interactions"];
  input.inbound = [
    { id: "m1", sender: "x@example.com", subject: "Vraag", receivedAt: t(8) }, // nog geen analyse -> item
    { id: "m2", sender: "y@example.com", subject: "Ok", receivedAt: t(1) }, // geanalyseerd door i2 -> geen dubbel item
    { id: "m3", sender: "z@example.com", subject: "Korting", receivedAt: t(1) }, // geanalyseerd door i1
    { id: "m4", sender: "w@example.com", subject: "Klaar", receivedAt: t(1) }, // afgehandeld door i3
  ] as unknown as NeedsSilvijnInput["inbound"];
  input.outreach = [
    { id: "o1", status: "ready_for_review", subject: "Hallo", channel: "email", updatedAt: t(9) },
    { id: "o2", status: "draft", subject: "Nog niet", channel: "email", updatedAt: t(1) },
    { id: "o3", status: "sent", subject: "Weg", channel: "email", updatedAt: t(1) },
  ] as unknown as NeedsSilvijnInput["outreach"];
  input.questionnaires = [
    { id: "q1", title: "Q1", completionStatus: "QUESTIONNAIRE_ATTENTION", updatedAt: t(10) },
    { id: "q2", title: "Q2", completionStatus: "QUESTIONNAIRE_FOLLOW_UP", updatedAt: t(1) },
    { id: "q3", title: "Q3", completionStatus: "QUESTIONNAIRE_COMPLETE", updatedAt: t(1) },
  ] as unknown as NeedsSilvijnInput["questionnaires"];

  const items = buildNeedsSilvijnItems(input);
  assert.deepEqual(
    items.map((i) => i.id),
    [
      "price_approval:p1",
      "price_approval:p2",
      "payment_confirmation:p3",
      "website_review:w1",
      "escalated_conversation:i1",
      "conversation_review:i2",
      "inbound_unprocessed:m1",
      "outreach_review:o1",
      "questionnaire_attention:q1",
    ]
  );
  const byId = new Map(items.map((i) => [i.id, i]));
  assert.equal(byId.get("website_review:w1")?.href, "/generated-websites/site-a");
  assert.equal(byId.get("price_approval:p1")?.href, "/projects/p1/finance");
  assert.match(byId.get("price_approval:p1")?.detail ?? "", /1\.295/);
  assert.match(byId.get("payment_confirmation:p3")?.detail ?? "", /Ontvangen € 0 van vereist € 895/);
  assert.equal(byId.get("escalated_conversation:i1")?.detail, "Klant vraagt korting");
  assert.match(byId.get("conversation_review:i2")?.detail ?? "", /^Kwalificatie vraagt jouw oordeel; /);
  assert.equal(byId.get("questionnaire_attention:q1")?.href, "/questionnaires/q1");
  // Deterministisch: dezelfde invoer, dezelfde uitvoer.
  assert.deepEqual(buildNeedsSilvijnItems(input), items);
});

test("G7: the module never mutates or sends — source guard", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/dashboard/needs-silvijn.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\.(update|create|delete|send|approve|confirm)\w*\(/, "read-only aggregation only");
  assert.doesNotMatch(src, /humanRpc|transition_lead|confirmPayment|approvePrice/);
});
