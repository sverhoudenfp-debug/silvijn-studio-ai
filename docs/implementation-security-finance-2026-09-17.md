# Implementation checkpoint: security, pricing and payments

This is an implemented and tested checkpoint, NOT completion of Masterconfig Part 1 + Part 2.

## Implemented

- Verified Supabase Auth login with PKCE callback, session refresh in Next.js proxy, logout and a server-side owner guard. No `getSession()` trust, frontend role trust or fallback approver name.
- Every protected dashboard page/layout and all 42 exported protected server actions authorize before data access. Public health is liveness-only. Public demos no longer bake mock data into a production build or link into internal administration.
- Internal access model is owner-only, as required by Masterconfig. Membership is configured for the studio mailbox `silvijn@silvijnstudio.com`; ownership requires that exact email on a verified Auth user. No Auth account was created and no login email was sent during implementation.
- SQL-backed human price approval, price rejection, payment-plan selection, manual payment confirmation, lifecycle transitions, website approval/revision/archive. Critical operations record the verified actor UUID in the same database transaction.
- A concrete finance page at `/projects/[id]/finance`, linked from project detail: approved amount, balance, production gate, approval/payment histories and human-only forms.
- Payment confirmation is append-only and idempotent, validates remaining balance and cannot be performed by the service role. Full upfront and split payment gates differ correctly. A payment event is not a Stripe webhook or autonomous confirmation.
- Approved prices bind to a specific indication AND requirements snapshot. Changed scope cannot reuse approval. Repricing after confirmed payments is blocked pending financial reconciliation.
- Production generation is gated on price approval, a recorded plan, confirmed payment and complete requirements. The default target is now Shopify rather than Next.js. **The Shopify generator remains unfinished; this checkpoint does not deliver themes.**
- Central pricing is loaded from `studio_settings`: EUR 895 first page, EUR 200 additional page, configurable webshop base of EUR 2495. Unknown requested add-on prices block calculation instead of silently becoming free. VAT is explicitly unconfigured, not assumed.
- Approved artifacts and QC human decisions cannot be overwritten or deleted through the elevated application client. Owner revision/archive uses audited RPCs.
- Security response headers, server-only elevated client, explicit rejection of invalid `AI_MODE`, no silent database mock fallback in production runtime.
- Removed workflow seeding from read/list calls. Corrected oldest-vs-newest price selection in the automation executor and analytics reading counters from the wrong object. These fixes do not mean distributed orchestration and cost accounting are complete.
- Removed nonfunctional topbar controls instead of presenting fake pause/notification/search functionality; added working logout.

## Database changes actually applied and verified

Target: existing `silvijn-studio-ai` Supabase project, ref `dblxmvdbjadjkmxxvsca`.

- `0010_studio_security_finance`: six new tables (`studio_members`, `audit_events`, `price_approvals`, `payment_events`, `studio_settings`, `studio_schema_migrations`), project approval/payment-plan/requirements-complete columns, relationships, indexes, owner-read policies, scoped RPC grants and human-control triggers.
- `0011_human_decision_immutability`: protects approved content and QC decisions, covers forged approved project inserts and adds atomic revision/archive RPC.
- 20 public policies verified. No public table has RLS disabled. Customers and other authenticated users cannot access internal project/CRM records. Service-role bypass of RLS is separately constrained through application guards, revoked direct financial writes and database triggers.
- Applied versions recorded in `studio_schema_migrations`; no migration runner claiming an unverified application.
- Verified after rolled-back tests: 17 original leads, 0 projects, 0 payment events, 0 Auth users. No business records or useful tables were deleted. Test fixtures were created only inside transactions that rolled back.
- Supabase Auth redirect/site URL now points at the existing Vercel application and callback. Existing redirect entries would be preserved; automatic email confirmation remains disabled.

## Verification executed

- `npm test`: 10/10 tests passed. Covers exact pricing totals, required information, non-free unknown add-ons, config validation, entrypoint authorization coverage, target/payment guard source checks, health disclosure and invalid AI mode. Source checks are NOT a substitute for authenticated browser E2E.
- `npm run lint`: passed, zero warnings in final run.
- `npm run typecheck`: passed. Initial legacy-script Promise type errors were corrected.
- `npm run build`: passed. Final output confirms `/demo/[slug]` is dynamic, not statically generated from mock data.
- `scripts/test-security-finance.sql`: passed on the real database in a rolled-back transaction. Verified owner/outsider/service rules, price snapshot, both payment plans, duplicate confirmation, conflicting idempotency key, overpayment, scope change and database privileges.
- `scripts/test-rls-isolation.sql`: passed under the actual PostgreSQL `authenticated` role, not merely as admin. Outsider/unverified-email reads denied; verified owner reads allowed; direct payment and membership writes denied.
- `scripts/test-human-immutability.sql`: passed. Service-context overwrite/delete/forged approval/approved project insertion denied; owner revision audited. Synthetic artifact fixture tests database guards, NOT real Shopify output.
- Authenticated browser login, email delivery, Shopify runtime, Gmail send/reply and full Masterconfig business E2E were NOT performed. Earlier Phase 10/12 mock-based scripts are not current production acceptance evidence.
- Live application behavior must be checked after the commit is deployed. A successful local build alone is not a deployment claim.

## Remaining external verification/configuration

- First actual owner login and mailbox receipt still need verification. Supabase custom SMTP was not configured at inspection; default provider delivery to the studio mailbox is not proven.
- The app's Vercel environment needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and server-only `SUPABASE_SECRET_KEY`. Missing authentication configuration fails closed. This checkpoint does not claim changes to Vercel environment variables.
- Gmail OAuth credentials/scopes and refresh-token handling, Google Places credentials, domain routing for public customer URLs and Shopify runtime validation environment are not verified by these tests.
- VAT treatment and unconfigured functional add-on amounts remain explicit business/configuration decisions.

## Remaining implementation, not falsely classified as external blockers

- Full real discovery/analysis/scoring/outreach orchestration and distributed locks, retry-safe durable execution and complete AI-cost accounting.
- Gmail integration, real reply-only conversation creation, complete threads, follow-ups, suppression/duplicate controls and autonomous sales states.
- Persisted dynamic questionnaires, scoped public links, uploads, completeness/follow-up handling. `requirements_complete` stays false until a real completion mechanism is implemented.
- Full custom Shopify Design Plan, Liquid generation, valid theme ZIP storage/download, static and runtime validation, QC repair/retest loops and versioned artifacts.
- Real demo generation/feedback/storage lifecycle, product import and validated Shopify CSV, revision rounds, final-payment and final-delivery/transfer checklists.
- Notifications and full operational analytics. No phone/daily-summary schedule was configured by this checkpoint.
- Full 29-workflow E2E list and the Masterconfig acceptance suite.

No live outreach, payment links, payment receipts, final approvals, delivery or Shopify transfers were performed.
