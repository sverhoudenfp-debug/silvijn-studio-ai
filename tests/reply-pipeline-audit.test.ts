import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Regressietests voor de reply_pipeline_run-audit (2026-09-28).
 * Oorzaak: audit_events.entity_id is text NOT NULL, maar de pipeline insertte
 * null — elke audit-regel viel stilletjes weg (AUDIT_WRITE_FAILED, 0 rijen
 * ooit). Fix: het concrete lead-id van de eerste verwerkte outcome als
 * entity_id. De rij moet alle NOT NULL-kolommen (action, entity_type,
 * entity_id, details) concreet vullen zodat de insert daadwerkelijk opslaat.
 */
import { buildReplyPipelineAuditEvent, type ReplyPipelineOutcome } from "../lib/sales/reply-pipeline";

const OUTCOME: ReplyPipelineOutcome = {
  leadId: "aacd17d2-c840-4008-88f2-1370a89783d5",
  businessName: "Test",
  outcome: "draft_for_review",
  detail: "ok",
};

test("reply_pipeline_run-audit heeft een concrete entity_id en alle NOT NULL-kolommen gevuld", () => {
  const row = buildReplyPipelineAuditEvent({
    ownerUserId: null,
    trigger: "gmail_ingest",
    mode: "review",
    outcomes: [OUTCOME],
    errors: [],
  });
  assert.equal(row.action, "reply_pipeline_run");
  assert.equal(row.entity_type, "reply_pipeline");
  assert.equal(row.entity_id, OUTCOME.leadId, "entity_id moet een concrete niet-lege string zijn (was null)");
  assert.ok(typeof row.entity_id === "string" && row.entity_id.length > 0);
  assert.ok(row.details && typeof row.details === "object");
  assert.deepEqual(row.details, {
    trigger: "gmail_ingest",
    mode: "review",
    processed: 1,
    answered: 0,
    escalated: 0,
    optedOut: 0,
    errors: 0,
  });
  assert.equal(row.actor_id, null, "actor_id is nullable: null is geldig bij ingest-tick");
});

test("audit-teltwaarden kloppen bij gemengde outcomes en errors (owner-run)", () => {
  const row = buildReplyPipelineAuditEvent({
    ownerUserId: "8a3f7c0e-1111-2222-3333-444455556666",
    trigger: "owner_command",
    mode: "auto",
    outcomes: [
      { ...OUTCOME, outcome: "answered" },
      { ...OUTCOME, leadId: "b0d1c2a3-1111-2222-3333-444455556666", outcome: "escalated" },
      { ...OUTCOME, leadId: "c1d2e3f4-1111-2222-3333-444455556666", outcome: "opted_out" },
      { ...OUTCOME, leadId: "d2e3f4a5-1111-2222-3333-444455556666", outcome: "error", detail: "x" },
    ],
    errors: ["fout 1"],
  });
  assert.equal(row.actor_id, "8a3f7c0e-1111-2222-3333-444455556666");
  assert.equal(row.entity_id, OUTCOME.leadId, "concreet lead-id van de eerste outcome");
  assert.deepEqual(row.details, {
    trigger: "owner_command",
    mode: "auto",
    processed: 4,
    answered: 1,
    escalated: 1,
    optedOut: 1,
    errors: 1,
  });
});

test("audit-builder weigert een run zonder outcomes (fail-loud, geen stille null-insert)", () => {
  assert.throws(
    () =>
      buildReplyPipelineAuditEvent({
        ownerUserId: null,
        trigger: "gmail_ingest",
        mode: "review",
        outcomes: [],
        errors: [],
      }),
    /AUDIT_ROW_REQUIRES_OUTCOMES/
  );
});
