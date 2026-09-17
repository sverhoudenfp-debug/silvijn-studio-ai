# Core lead lifecycle and reply-only conversations

## Scope and baseline

Extends commit `1bdcbc2`. No Gmail, Shopify, questionnaire, demo-generation, notification or analytics subsystem was implemented. Existing authentication, owner membership, financial approvals and payment RPCs remain in place. The production-status trigger was narrowly corrected because IN_PROGRESS is operational, not another human approval.

## Database changes

Migration `0012_core_lead_conversations` was applied to the existing Supabase project `dblxmvdbjadjkmxxvsca` on 2026-09-17 at 16:00:04 UTC and verified in `studio_schema_migrations`.

- Extended **existing `leads.lead_status`**, stored in its existing lowercase convention. All 23 canonical states and four additional legacy values (`qualified`, `contacted`, `interested`, `won`) are supported. No parallel lifecycle/status column was added.
- Added transition context only: `status_reason`, `status_project_id`, `status_evidence_message_id`, with same-lead foreign keys. Graph is defined in `lib/leads/lifecycle.json`; tests compare it exactly with the SQL predicate in this migration. Future changes require a NEW migration, not editing this applied one.
- Added `lead_contacts` and `conversations`. A contact belongs to one lead and channel. A conversation has a required, confirmed first inbound reply. First-reply uniqueness plus lead/contact/channel/thread uniqueness prevent duplicate conversation creation.
- Extended existing `inbound_messages` and `outreach_drafts`, rather than creating another message store. Added contact/conversation/reply relationships, delivery timestamp and purpose/approved-price context for outbound records, manual reply attestation/idempotency, provider-message/account keys and thread keys for later integration.
- Composite FKs reject cross-lead/contact/channel/project links. Sales analyses must belong to the same lead as their inbound message. Confirmed message identity/content and sent-message content are immutable; an unanswered sent message can be attached to its actual first reply without rewriting its content.
- Added the `conversation_messages` **security-invoker view**, combining only confirmed inbound replies and sent outbound messages. Drafts and unverified legacy inbound records are excluded, not deleted.
- Added reply, thread, status and timeline indexes. Added two owner-read policies, bringing the total to 22 public policies. No public table has RLS disabled. Anonymous/private-inbox access is not granted. Direct conversation insertion is not granted to authenticated users or the service role.

## Server operations and state semantics

- `record_prospect_reply` uses the existing verified-owner architecture to record a manually attested, actually received reply. Lead locking, request-key conflict checks and atomic insert/attachment make retries idempotent. A missing sender/body/time or unconfirmed/mock message cannot activate a conversation.
- Outbound outreach can exist independently and many outbound records may belong to one lead. It never creates a conversation. Only the outreach record explicitly answered is linked; unrelated drafts/attempts are not silently attached.
- Separate contacts or supplied thread keys get separate conversations. Same lead/contact/channel/thread reuses its conversation. Same provider-account/message identity cannot be stored twice when populated by a future adapter.
- `transition_lead` checks expected current state, records the reason and rejects stale writes. Database triggers also validate direct server/service updates. Lifecycle changes are audited with actor role and scoped evidence.
- Interest/qualification requires a confirmed reply. Demo-offer/demo-sent labels require matching existing sent-message evidence; no demo is created by these transitions.
- Price readiness requires an existing complete indication. Presentation requires the exact approved scope/price and a recorded sent offer. Acceptance requires an owner-recorded reply to that actual price offer. No transition creates a price approval or payment.
- Payment states require the corresponding immutable payment records. Production requires the approved scope, agreed plan, required owner-confirmed payment and complete requirements.
- `start_project_production` is callable by the trusted service role as well as the owner. It validates the existing production gate and updates project status and eligible lead lifecycle states atomically, with audit records. **No second human approval is needed.** Other human approval/payment protections remain intact and their regression suites pass.
- `won` is preserved as a legacy value, not treated as PRICE_ACCEPTED, paid, approved or delivered. It is not automatically promoted. Opt-out remains terminal in this graph; closing/reopening other leads does not undo suppression or invent financial events.
- `DELIVERED` is recognized as a canonical state, but transition is intentionally blocked with `BLOCKED_DELIVERY_WORKFLOW_NOT_IMPLEMENTED`. This step does not invent handover evidence or perform delivery. Other advanced transitions reject missing source records instead of pretending success.

## Application and UI changes

- Added typed lifecycle metadata, input validation and owner-authorized transition action. Existing repositories expose the new inbound/outbound relationships.
- Replaced the mock-only conversations page with persisted, owner-scoped conversations and paginated inbound/outbound timelines, contact identity, lead links and lifecycle badges. Message text is rendered as text, not injected HTML. No fake AI conversation or send control remains on this page.
- Lead and project detail pages have persisted lifecycle controls with reason, project context and evidence selection. Graph options are a convenience; the database remains authoritative. Invalid transitions return a visible error, not a locally fabricated status.
- Manual reply UI requires a valid sender, actual received timestamp and explicit real-reply attestation. It supports choosing the answered sent-outreach record and links to the full conversation. Unverified old messages are labeled and cannot drive live sales analysis.
- Canonical `website_interested` / `qualifying` remain usable by existing project preparation. This creates neither price approval nor production authorization. Existing legacy eligibility remains compatible; `won` is not newly authorized for project creation.
- Project lists show lead lifecycle alongside existing project execution status. Read-only outreach/demo badges replace temporary client-side status editing. Related detail state is refreshed after persistence.
- Existing status counters received only the type/zero-initialization compatibility change required by the wider LeadStatus union. No analytics feature or model was built.

## Verification

Final application checks:

- `npm test`: **19 passed, 0 failed**, including 9 core-state tests. The transition matrix checks all 729 pairs, canonical/legacy compatibility, schema validation, SQL/application graph parity, canonical project eligibility, suppression, removal of mock conversations and production routing. Source/graph checks are not claimed as browser E2E.
- `npm run typecheck`: passed.
- `npm run lint`: passed, no warnings in the final run.
- `npm run build`: passed.

All four suites ran against the migrated live database with rolled-back synthetic fixtures:

1. `scripts/test-core-lifecycle.sql`: valid/invalid/gated/stale transitions, no conversation for unanswered outreach or unverified/mock inbound data, confirmed reply creation, same-initial-reply uniqueness, idempotent retry/conflict, separate contacts, thread reuse, inbound/outbound timeline integrity, cross-lead/contact constraints, opt-out suppression, financial non-bypass, service-role autonomous production, real authenticated-role outsider denial and existing owner read/write access.
2. `scripts/test-security-finance.sql`: existing owner/service/outsider financial authorization, pricing, split/full payments, idempotency and scope binding.
3. `scripts/test-rls-isolation.sql`: actual PostgreSQL authenticated-role isolation and verified-email owner requirements.
4. `scripts/test-human-immutability.sql`: protected approved artifacts, QC decisions, forged approved project rejection and auditable owner revision.

Pre-application dry runs also verified migration rollback and preserved an explicitly seeded legacy `won` fixture. Initial SQL syntax/ambiguity and test-expectation failures were fixed before applying the migration. A TypeScript narrowing issue and unused import were fixed; no final check remains failed.

## Data preservation and limits

Before/after verification: **17 leads**, with identical ordered content fingerprints across every original lead column, not merely matching counts. Final counts after test rollback: 0 outreach, 0 inbound, 0 contacts, 0 conversations, 0 projects and 0 Auth users. No prospect message, financial receipt or approval fixture was retained.

There was no authenticated browser-session E2E because no real owner login was available. SQL tests used the actual database roles and verified-owner predicates, but are not proof of login-email delivery or browser interaction. Production deployment must be checked after this commit is pushed.

Gmail is not connected or implemented. Today, genuine inbound replies are recorded through explicit owner attestation. The schema has provider/account/thread identifiers for a later trusted ingestion adapter; this phase does not claim a live Gmail receiver. No real emails, demos, payments, website approvals or deliveries were performed.
