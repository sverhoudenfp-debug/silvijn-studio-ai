# Productie-readiness (Fase 12)

Dit document beschrijft de harde productie-garanties van Silvijn Studio AI,
de fixes die Fase 12 heeft opgeleverd en de tests die ze bewaken.

## Garanties

1. **Fail-loud, nooit stille mock.** Zodra `NODE_ENV=production` is en de
   Supabase-credentials zijn geconfigureerd, crasht de applicatie bij een
   ontbrekende of ongeldige `AI_MODE` met een `AIConfigurationError` — in
   plaats van ongemerkt op mock-data verder te draaien.
   Expliciete mock in productie kan alleen via `AI_MODE=mock`.

2. **Geen secrets in logs of errors.** De Anthropic SDK mapt fouten naar
   veilige business-fouten (`AIServiceError`); onbekende fouten worden
   gelogd zonder de originele error-inhoud (die kan credentials bevatten).
   Alleen `error.type` (foutcode) wordt bewaard.

3. **Externe data is data, nooit instructies.** Alle zes agent-prompts
   (business-analysis, outreach, sales, requirements, website-planning,
   website-QC) markeren externe brondata als ONBETROUWaar tussen
   `<onbetrouwbaar>`-delimiters en instrueren het model die te negeren als
   instructie. Live geverifieerd: een injectiepoging in branche- en
   locatievelden levert een normale analyse op — geen van de markers of
   actie-instructies kwam terug in de output.

4. **Publieke rollen hebben geen toegang.** Alle 15 live tabellen zijn
   RLS-afgeschermd: de publishable key (anon-rol) kan niet lezen, schrijven
   of verwijderen. Alle app-toegang verloopt via de `service_role` key,
   uitsluitend server-side.

## Nieuwe diagnostiek

- `GET /api/health` — productie-diagnose: Supabase-status, AI-mode,
  laatst-geloggde AI-run, aanwezigheid van pricing-configuratie. Geen
  gevoelige waarden. Handig bij een 500 in Vercel zonder log-toegang.

## Echte data in de UI (dashboard + analytics)

Sinds Fase 12 draaien `/dashboard` en `/analytics` op 100% echte
repository-data (live Supabase of expliciete mock — nooit verzonnen cijfers):
- Analytics-aggregatieservice `lib/services/analytics.ts` (tellingen,
  gemiddelden, kosten-per-lead, opbrengst-schatting, automatiseringsduur)
- Dashboard: KPI's, Activity-feed (`ai_activities`), Top Opportunities,
  Outreach-concepten, Lead Pipeline, Automation Status — allemaal
  server-side uit repositories.

## Tests

| Script | Wat het bewijst |
| --- | --- |
| `scripts/test-production-readiness.ts` | Fail-loud config, injectie-hardening in alle prompts, analytics-aggregatie (17 checks) |
| `scripts/test-rls-anon.ts` | Anon-rol buitengesloten op alle 15 tabellen (lezen + schrijven) |
| `scripts/test-injection-live.ts` | LIVE prompt-injection-weerbaarheid (1 fictieve call, netto € cent) |
| `scripts/test-e2e-flow.ts` | Volledige flow lead → analyse → outreach → sales → project → prijs → website → QC → READY_FOR_SILVIJN tegen de live DB, mock AI (0 kosten), incl. opschoning van testdata |

## Bekende openstaande acties

1. **Migratie 0009 toepassen** (`supabase/migrations/0009_generated_websites_status_alignment.sql`)
   in de Supabase SQL-editor. De status-check-constraint uit 0006 kent de
   QC-statussen (`qc_running`, `ready_for_silvijn`, `needs_revision`,
   `approved`) niet; zonder deze migratie faalt de QC-stap live.
   Gevonden door de live E2E-test.
2. **Prijzen configureren.** `getPricingConfiguration()` heeft (bewust) lege
   `packages: {}` — de prijsengine verzint nooit bedragen. Zodra Silvijn zijn
   pakketprijzen invult, wordt `calculatePrice` → `price_ready` mogelijk.
3. **Vercel-deploy + environment variables** (`AI_MODE=live`) — daarna is
   `/api/health` de eerste productie-controle.
