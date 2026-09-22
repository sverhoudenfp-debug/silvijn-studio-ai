import { test } from "node:test";
import assert from "node:assert/strict";
import { contactChannelFor, manualContactDetail, needsManualContact } from "../lib/outreach/contactability";
import { isEligibleForInitialOutreach } from "../lib/outreach/orchestrator";

// Force the test-only in-memory repositories. Never touch production data.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

test("contact channel never invents an e-mail address", () => {
  assert.equal(contactChannelFor({ email: "info@voorbeeld.nl", phone: null }), "email");
  assert.equal(contactChannelFor({ email: "   ", phone: "040 123 4567" }), "phone_only");
  assert.equal(contactChannelFor({ email: null, phone: null }), "none");
});

test("a fresh lead without e-mail is a human action, not an outreach candidate", () => {
  const lead = { leadStatus: "new", outreachStatus: "not_contacted", email: null, phone: "040 123 4567" };
  assert.equal(isEligibleForInitialOutreach(lead, false, false), false, "outreach must skip it");
  assert.equal(needsManualContact(lead), true, "and it must be surfaced to Silvijn");
  assert.match(manualContactDetail(lead), /040 123 4567/);
  assert.match(manualContactDetail({ phone: null }), /geen telefoonnummer/i);
});

test("manual-contact flag disappears once the lead has an e-mail, is contacted, or leaves the fresh statuses", () => {
  assert.equal(needsManualContact({ leadStatus: "new", outreachStatus: "not_contacted", email: "a@b.nl", phone: null }), false);
  assert.equal(needsManualContact({ leadStatus: "new", outreachStatus: "contacted", email: null, phone: null }), false);
  assert.equal(needsManualContact({ leadStatus: "opted_out", outreachStatus: "not_contacted", email: null, phone: null }), false);
  assert.equal(needsManualContact({ leadStatus: "qualified", outreachStatus: "not_contacted", email: null, phone: null }), true);
});
