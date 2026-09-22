import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import {
  OutreachOrchestrator,
  OutreachCommandValidationError,
  isEligibleForInitialOutreach,
} from "../lib/outreach/orchestrator";
import {
  findDueFollowups,
  processDueFollowups,
  MAX_FOLLOWUPS_PER_LEAD,
} from "../lib/outreach/followups";
import { processInboundReply, processPendingReplies } from "../lib/sales/reply-pipeline";
import graph from "../lib/leads/lifecycle.json";
import { AUTOMATED_TRANSITION_TARGETS, isAutomatedTransitionTarget } from "../lib/leads/automated";
import { getLeadRepository } from "../lib/repositories/lead-repository";
import { getOutreachRepository } from "../lib/outreach/repository";
import { getInboundMessageRepository } from "../lib/sales/repository";

/**
 * Fase E: Outreach + Sales-orchestratie. Veilige testdata uitsluitend — mock
 * AI (keyword-classificatie), memory-repository's, geen Supabase/Gmail/AI.
 * Supabase-variabelen worden actief gewist zodat geen enkele test
 * productiedata raakt (zelfde patroon als automation-runtime.test.ts).
 */
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
process.env.AI_MODE = "mock";

const owner = "10000000-0000-4000-8000-0000000000e1";
const migration = readFileSync("supabase/migrations/0018_outreach_sales_orchestration.sql", "utf8");

let seq = 0;
async function seedLead(overrides: Record<string, unknown> = {}) {
  seq += 1;
  return getLeadRepository().create({
    businessName: `Testbedrijf ${seq} TESTDATA`,
    industry: "Dakwerken",
    city: "Eindhoven",
    province: "Noord-Brabant",
    country: "Nederland",
    websiteStatus: "no_website",
    email: `test${seq}@example.invalid`,
    source: "mock",
    ...overrides,
  });
}

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

// ---------------------------------------------------------------------------
// Selectie & validatie
// ---------------------------------------------------------------------------

test("campaign input is strictly validated (mode, limit, owner)", async () => {
  const orchestrator = new OutreachOrchestrator();
  await assert.rejects(
    orchestrator.runCommand({ ownerUserId: owner, mode: "yolo" as never, limit: 3 }),
    OutreachCommandValidationError
  );
  await assert.rejects(
    orchestrator.runCommand({ ownerUserId: "", mode: "review", limit: 3 }),
    OutreachCommandValidationError
  );
  for (const limit of [0, -1, 26, 1000, Number.NaN]) {
    await assert.rejects(
      orchestrator.runCommand({ ownerUserId: owner, mode: "review", limit }),
      OutreachCommandValidationError
    );
  }
});

test("eligibility: suppressed, email-less, already-contacted leads are never selected", () => {
  const base = { leadStatus: "new", outreachStatus: "not_contacted", email: "a@b.invalid" };
  assert.equal(isEligibleForInitialOutreach(base, false, false), true);
  assert.equal(isEligibleForInitialOutreach({ ...base, leadStatus: "opted_out" }, false, false), false);
  assert.equal(isEligibleForInitialOutreach({ ...base, outreachStatus: "opted_out" }, false, false), false);
  assert.equal(isEligibleForInitialOutreach({ ...base, leadStatus: "contacted" }, false, false), false);
  assert.equal(isEligibleForInitialOutreach({ ...base, leadStatus: "delivered" }, false, false), false);
  assert.equal(isEligibleForInitialOutreach({ ...base, email: null }, false, false), false);
  assert.equal(isEligibleForInitialOutreach(base, true, false), false, "openstaand draft blokkeert");
  assert.equal(isEligibleForInitialOutreach(base, false, true), false, "verzonden initial blokkeert");
});

// ---------------------------------------------------------------------------
// Review-modus: bestaande menselijke flow blijft bestaan
// ---------------------------------------------------------------------------

test("review campaign creates drafts for human review without sending or state change", async () => {
  const lead = await seedLead();
  const orchestrator = new OutreachOrchestrator();
  const result = await orchestrator.runCommand({ ownerUserId: owner, mode: "review", limit: 25 });

  assert.equal(result.command.status, "completed");
  assert.ok((result.command.draftsCreated ?? 0) >= 1);
  assert.equal(result.command.sent, 0);

  const draft = (await getOutreachRepository().list()).find((d) => d.leadId === lead.id);
  assert.ok(draft, "draft moet bestaan");
  assert.equal(draft!.purpose, "initial");
  assert.equal(draft!.status, "ready_for_review");
  assert.ok(!draft!.sentAt, "review-modus verstuurt nooit zelf");

  const after = await getLeadRepository().get(lead.id);
  assert.equal(after!.leadStatus, "new", "review-modus wijzigt geen lead-status");
  assert.equal(after!.outreachStatus, "not_contacted");
});

test("leads without e-mail are reported as skipped with a manual-contact reason and never get a draft", async () => {
  const noEmail = await seedLead({ email: null, phone: "040 987 6543" });
  const orchestrator = new OutreachOrchestrator();
  const result = await orchestrator.runCommand({ ownerUserId: owner, mode: "auto", limit: 25 });

  assert.equal(result.command.status, "completed");
  const entry = result.summary.leads.find((l) => l.leadId === noEmail.id);
  assert.ok(entry, "no-email lead must be visible in the command summary");
  assert.equal(entry!.outcome, "skipped");
  assert.match(entry!.detail ?? "", /handmatig contact/i);
  assert.match(entry!.detail ?? "", /040 987 6543/);
  assert.ok((result.command.skipped ?? 0) >= 1);
  assert.ok(!result.command.selectedLeadIds?.includes(noEmail.id), "never selected for outreach");

  const drafts = (await getOutreachRepository().list()).filter((d) => d.leadId === noEmail.id);
  assert.equal(drafts.length, 0, "no draft, no invented address");
  const after = await getLeadRepository().get(noEmail.id);
  assert.equal(after!.email, null);
  assert.equal(after!.outreachStatus, "not_contacted");
});

// ---------------------------------------------------------------------------
// Auto-modus: autonoom verzenden binnen de expliciete opdracht
// ---------------------------------------------------------------------------

test("auto campaign sends via the approved provider and transitions leads to contacted", async () => {
  const lead = await seedLead();
  const orchestrator = new OutreachOrchestrator();
  const result = await orchestrator.runCommand({ ownerUserId: owner, mode: "auto", limit: 25 });

  assert.equal(result.command.status, "completed");
  assert.ok((result.command.sent ?? 0) >= 1);
  const sentLead = result.summary.leads.find((l) => l.leadId === lead.id);
  assert.equal(sentLead?.outcome, "sent");

  const draft = (await getOutreachRepository().list()).find((d) => d.leadId === lead.id);
  assert.equal(draft!.status, "sent");
  assert.ok(draft!.sentAt, "verzendbewijs aanwezig");
  assert.ok(draft!.providerMessageId, "provider message-id vastgelegd");

  const after = await getLeadRepository().get(lead.id);
  assert.equal(after!.leadStatus, "contacted");
});

test("a lead is never selected twice: second campaign skips already-contacted leads", async () => {
  const lead = await seedLead();
  const orchestrator = new OutreachOrchestrator();
  const first = await orchestrator.runCommand({ ownerUserId: owner, mode: "auto", limit: 25 });
  assert.ok(first.summary.leads.some((l) => l.leadId === lead.id));

  const second = await orchestrator.runCommand({ ownerUserId: owner, mode: "auto", limit: 25 });
  assert.equal(
    second.summary.leads.some((l) => l.leadId === lead.id),
    false,
    "al gecontacteerde lead wordt overgeslagen"
  );
  const drafts = (await getOutreachRepository().list()).filter(
    (d) => d.leadId === lead.id && d.purpose === "initial"
  );
  assert.equal(drafts.length, 1, "exact één initiële outreach per lead");
});

// ---------------------------------------------------------------------------
// Follow-ups: max 2, stop bij reactie, stop bij afmelding
// ---------------------------------------------------------------------------

test("follow-ups become due only after the interval and are capped at 2 per lead", async () => {
  const lead = await seedLead();
  const orchestrator = new OutreachOrchestrator();
  await orchestrator.runCommand({ ownerUserId: owner, mode: "auto", limit: 25 });

  // Nette basis: niet meteen due
  assert.equal((await findDueFollowups()).some((d) => d.leadId === lead.id), false);

  // Verzendmoment terugdated: nu due
  const draft = (await getOutreachRepository().list()).find((d) => d.leadId === lead.id);
  await getOutreachRepository().update(draft!.id, { sentAt: daysAgo(6) });
  assert.equal((await findDueFollowups()).some((d) => d.leadId === lead.id), true);

  // Follow-up 1 en 2 versturen, daarna hard stop
  const run1 = await processDueFollowups({ mode: "auto", limit: 10 });
  assert.ok(run1.processed.some((p) => p.leadId === lead.id && p.outcome === "sent"));
  const followupDrafts = async () =>
    (await getOutreachRepository().list()).filter((d) => d.leadId === lead.id && d.purpose === "followup");
  assert.equal((await followupDrafts()).length, 1);

  for (const d of await followupDrafts()) await getOutreachRepository().update(d.id, { sentAt: daysAgo(6) });
  const run2 = await processDueFollowups({ mode: "auto", limit: 10 });
  assert.ok(run2.processed.some((p) => p.leadId === lead.id && p.outcome === "sent"));
  assert.equal((await followupDrafts()).length, 2);
  assert.equal(MAX_FOLLOWUPS_PER_LEAD, 2);

  for (const d of await followupDrafts()) await getOutreachRepository().update(d.id, { sentAt: daysAgo(30) });
  assert.equal(
    (await findDueFollowups()).some((d) => d.leadId === lead.id),
    false,
    "na 2 follow-ups is de lead definitief afgerond zonder reactie"
  );
});

test("a real reply stops follow-ups for that lead", async () => {
  const lead = await seedLead();
  const orchestrator = new OutreachOrchestrator();
  await orchestrator.runCommand({ ownerUserId: owner, mode: "auto", limit: 25 });
  const draft = (await getOutreachRepository().list()).find((d) => d.leadId === lead.id);
  await getOutreachRepository().update(draft!.id, { sentAt: daysAgo(6) });
  await getLeadRepository().updateStatuses(lead.id, { leadStatus: "interested", outreachStatus: "replied" });

  assert.equal(
    (await findDueFollowups()).some((d) => d.leadId === lead.id),
    false,
    "lead met reactie krijgt nooit een koude follow-up"
  );
});

// ---------------------------------------------------------------------------
// Reply-pipeline: opt-out, escalatie, demo-aanvraag, interesse
// ---------------------------------------------------------------------------

async function seedReply(leadId: string, body: string) {
  return getInboundMessageRepository().create({
    leadId,
    channel: "email",
    sender: "klant@example.invalid",
    subject: "Re: Voorbeeldwebsite",
    body,
    source: "manual-testdata",
    replyConfirmed: true,
    receivedAt: new Date().toISOString(),
  });
}

test("opt-out stops everything immediately and is never answered", async () => {
  const lead = await seedLead();
  await getLeadRepository().updateStatuses(lead.id, { leadStatus: "contacted", outreachStatus: "sent" });
  const inbound = await seedReply(lead.id, "Graag afmelden van deze e-mails.");

  const outcome = await processInboundReply({ leadId: lead.id, inboundMessageId: inbound.id, mode: "auto" });
  assert.equal(outcome.outcome, "opted_out");

  const after = await getLeadRepository().get(lead.id);
  assert.equal(after!.outreachStatus, "opted_out");
  assert.equal(
    (await getOutreachRepository().list()).some((d) => d.leadId === lead.id && d.status === "sent" && d.purpose !== "initial"),
    false,
    "er wordt nooit gereageerd op een afmelding"
  );
  assert.equal(
    (await findDueFollowups()).some((d) => d.leadId === lead.id),
    false,
    "afgemelde lead krijgt geen follow-ups"
  );
});

test("price requests escalate to Silvijn and are never answered automatically", async () => {
  const lead = await seedLead();
  await getLeadRepository().updateStatuses(lead.id, { leadStatus: "contacted", outreachStatus: "sent" });
  const inbound = await seedReply(lead.id, "Wat kost zo'n website eigenlijk?");

  const outcome = await processInboundReply({ leadId: lead.id, inboundMessageId: inbound.id, mode: "auto" });
  assert.equal(outcome.outcome, "escalated");
  assert.equal(
    (await getOutreachRepository().list()).some((d) => d.leadId === lead.id && d.status === "sent" && d.purpose !== "initial"),
    false
  );
  const after = await getLeadRepository().get(lead.id);
  assert.notEqual(after!.leadStatus, "price_ready", "prijs vraagt altijd een menselijke beslissing");
});

test("demo request in auto mode sends a demo_offer and transitions to demo_offered", async () => {
  const lead = await seedLead();
  await getLeadRepository().updateStatuses(lead.id, { leadStatus: "contacted", outreachStatus: "sent" });
  const inbound = await seedReply(lead.id, "Ik wil die demo-website graag zien.");

  const outcome = await processInboundReply({ leadId: lead.id, inboundMessageId: inbound.id, mode: "auto" });
  assert.equal(outcome.outcome, "answered");

  const demoOffer = (await getOutreachRepository().list()).find(
    (d) => d.leadId === lead.id && d.purpose === "demo_offer" && d.status === "sent"
  );
  assert.ok(demoOffer, "demo-aanvraag leidt tot een verzonden demo_offer");
  const after = await getLeadRepository().get(lead.id);
  assert.equal(after!.leadStatus, "demo_offered");
});

test("review mode leaves the AI answer as a draft for human review", async () => {
  const lead = await seedLead();
  await getLeadRepository().updateStatuses(lead.id, { leadStatus: "contacted", outreachStatus: "sent" });
  const inbound = await seedReply(lead.id, "Dit klinkt interessant, graag meer informatie.");

  const outcome = await processInboundReply({ leadId: lead.id, inboundMessageId: inbound.id, mode: "review" });
  assert.equal(outcome.outcome, "draft_for_review");
  assert.equal(
    (await getOutreachRepository().list()).some((d) => d.leadId === lead.id && d.status === "sent"),
    false,
    "review-modus verstuurt nooit zelf"
  );
});

test("processPendingReplies processes each confirmed reply exactly once", async () => {
  const lead = await seedLead();
  await getLeadRepository().updateStatuses(lead.id, { leadStatus: "contacted", outreachStatus: "sent" });
  await seedReply(lead.id, "Interessant, stuur maar meer informatie.");

  const run = await processPendingReplies({ ownerUserId: owner, mode: "auto", limit: 10 });
  assert.ok(run.processedCount >= 1);
  assert.ok(run.sentCount >= 1);

  const rerun = await processPendingReplies({ ownerUserId: owner, mode: "auto", limit: 10 });
  assert.equal(rerun.processedCount, 0, "idempotent: geen dubbele verwerking");
});

// ---------------------------------------------------------------------------
// Harde grenzen: geen menselijke gate is AI-toegestane
// ---------------------------------------------------------------------------

test("the AI whitelist can never reach a human or financial gate", () => {
  const humanAndFinanceGates = [
    "silvijn_approval", "price_presented", "price_accepted", "payment_pending",
    "deposit_paid", "paid", "in_progress", "ready_for_silvijn", "final_payment_pending",
    "paid_in_full", "approved", "delivered", "won", "lost",
  ];
  for (const gate of humanAndFinanceGates) {
    assert.equal(isAutomatedTransitionTarget(gate as never), false, gate);
  }
  // Whitelist in de applicatie is exact de whitelist in de SQL-functie.
  const sqlWhitelist = Array.from(
    migration.match(/p_next not in \(([^)]+)\)/)![1]
      .split(",")
      .map((s) => s.trim().replace(/'/g, ""))
  ).sort();
  assert.deepEqual(sqlWhitelist, [...AUTOMATED_TRANSITION_TARGETS].sort());
  assert.equal(migration.includes("to service_role"), true);
  assert.match(migration, /revoke all on function public\.transition_lead_automated[^;]+from public, anon, authenticated/);
});

test("automated transitions remain within the existing lifecycle graph", () => {
  // De whitelist zelf bevat uitsluitend geldige lifecycle-statussen.
  const valid = new Set(Object.keys(graph));
  for (const target of AUTOMATED_TRANSITION_TARGETS) assert.ok(valid.has(target), target);
});

test("migration follows the studio security pattern (owner read, service-role write only)", () => {
  assert.match(migration, /create table public\.outreach_commands/);
  assert.match(migration, /alter table public\.outreach_commands enable row level security/);
  assert.match(migration, /create policy outreach_commands_owner_read[\s\S]*?using \(public\.is_studio_owner\(\)\)/);
  assert.match(migration, /revoke all on public\.outreach_commands from anon/);
  assert.match(migration, /grant select on public\.outreach_commands to authenticated/);
  assert.match(migration, /owner_user_id uuid not null references auth\.users \(id\)/);
  assert.match(migration, /check \(mode in \('review', 'auto'\)\)/);
  assert.match(migration, /check \(status in \('running', 'completed', 'failed'\)\)/);
});

test("auto-outreach start uitsluitend via de owner-geautoriseerde server action", () => {
  // Scan alle app- en lib-bestanden: de OutreachOrchestrator, follow-up-ronde en
  // reply-pipeline mogen úitsluitend vanuit de owner-geate server actions
  // (app/actions/outreach.ts, app/actions/sales.ts — beide requireStudioOwner)
  // worden aangeroepen. Geen route, cron, workflow of API-endpoint kan dit.
  const offenders: string[] = [];
  const scan = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) { scan(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const content = readFileSync(full, "utf8");
      if (/OutreachOrchestrator|processDueFollowups|processPendingReplies|processInboundReply/.test(content)) {
        offenders.push(full);
      }
    }
  };
  scan("app");
  scan("lib");
  const allowed = [
    "app/actions/outreach.ts",
    "app/actions/sales.ts",
    "lib/outreach/orchestrator.ts",
    "lib/outreach/followups.ts",
    "lib/sales/reply-pipeline.ts",
    // 0028 (bewuste scopewijziging 2026-09-22): de Gmail-ingest-tick mag de
    // reply-pipeline starten, maar uitsluitend achter de eigenaarsinstelling
    // studio_settings.reply_handling_mode (default "off"; alleen de owner-RPC
    // kan die wijzigen). Koude outreach en follow-ups blijven owner-only.
    "app/api/gmail/ingest/route.ts",
  ];
  const violations = offenders.filter((o) => !allowed.includes(o));
  assert.deepEqual(violations, [], "orchestratie is alleen bereikbaar via de owner-geate actions");
  // De vermelende actions staan op de eerste regel achter requireStudioOwner.
  for (const action of ["app/actions/outreach.ts", "app/actions/sales.ts"]) {
    const src = readFileSync(action, "utf8");
    assert.match(src, /"use server"/);
    assert.match(src, /await requireStudioOwner\(\)/);
  }
  // De ingest-route start nooit koude outreach of follow-ups en leest de modus
  // uit de eigenaarsinstelling; zonder modus (off) wordt de pipeline niet eens geladen.
  const ingest = readFileSync("app/api/gmail/ingest/route.ts", "utf8");
  assert.doesNotMatch(ingest, /OutreachOrchestrator|processDueFollowups|processInboundReply/);
  assert.match(ingest, /getReplyHandlingMode\(\)/);
  assert.match(ingest, /if \(mode !== "off"\)/);
  assert.match(ingest, /trigger: "gmail_ingest"/);
  // Vercel-cron kent geen outreach-endpoint: alleen de automation-runtime.
  const vercel = readFileSync("vercel.json", "utf8");
  for (const cron of JSON.parse(vercel).crons ?? []) {
    assert.match(cron.path, /automation-runtime/);
  }
});

test("human decision gates, finance functions and Shopify-transfer remain untouched by 0018", () => {
  // 0018 raakt geen enkele menselijke beslissingstabel of -functie.
  assert.doesNotMatch(migration, /human_|price_approvals|payment_confirmations|website_decisions|projects|shopify/i);
  // De AI-whitelist kan de menselijke/financiële gates niet bereiken (unit-zijde)
  for (const forbidden of ["silvijn_approval", "price_presented", "price_accepted", "payment_pending",
    "deposit_paid", "paid", "in_progress", "ready_for_silvijn", "final_payment_pending", "paid_in_full",
    "approved", "delivered", "won", "lost"]) {
    assert.ok(!AUTOMATED_TRANSITION_TARGETS.includes(forbidden as never), forbidden);
  }
  // De menselijke transition_lead (0012) en human-decision-guards (0011/0012) staan er nog steeds.
  assert.doesNotMatch(migration, /create or replace function public\.transition_lead\(/);
  assert.doesNotMatch(migration, /drop function|drop table|drop policy/i);
  // Orchestratie-code raakt geen betalingen, projecten of Shopify.
  for (const file of ["lib/outreach/orchestrator.ts", "lib/outreach/followups.ts", "lib/sales/reply-pipeline.ts"]) {
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(src, /stripe|shopify|projects\b|payment_intent|checkout/i);
  }
});

test("discovery and the automation runtime can never start outreach or replies", () => {
  const discovery = readFileSync("lib/discovery/orchestrator.ts", "utf8");
  assert.doesNotMatch(discovery, /sendOutreachViaGmail|approveAndSendDraft|OutreachOrchestrator|from\("outreach_drafts"\)|from\("outreach_commands"\)/);
  const executors = readFileSync("lib/automation/executors.ts", "utf8");
  assert.doesNotMatch(executors, /approveAndSendDraft|sendOutreachViaGmail|OutreachOrchestrator/);
  const replyPipeline = readFileSync("lib/sales/reply-pipeline.ts", "utf8");
  assert.doesNotMatch(replyPipeline, /price_offer/, "de reply-pipeline maakt nooit een prijsvoorstel");
  assert.doesNotMatch(readFileSync("lib/outreach/orchestrator.ts", "utf8"), /price_offer/);
});
