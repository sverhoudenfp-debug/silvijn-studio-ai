# Automation Engine — Silvijn Studio AI (Fase 11)

## Architectuur

```
AUTOMATION (workflow-definitie, in de database)
      ↓
ORCHESTRATOR (run per lead — één actieve run per entity, locking)
      ↓
STEPS → EXECUTORS (hergebruiken de BESTAANDE services per fase:
      create-project      → ProjectService.createFromLead (Fase 8)
      check-requirements  → AIService agent 'project_requirements' + human gate
      create-price        → PricingEngine (Fase 8, deterministisch)
      check-price         → drempel/mens-afhankelijk → human gate
      generate-website    → WebsiteGenerationService (Fase 9)
      run-qc              → QualityControlService (Fase 10)
      wait-for-human      → NEVER auto — run wacht op Silvijn)
      ↓
RUN pauzeert bij ELKE human gate (waiting_for_human)
      ↓
SILVIJN handelt / keurt goed (bestaande UI per fase)
      ↓
RESUME (expliciet, server action) → volgende step
```

De engine is een **orkestrator over de bestaande fasen-services** — geen
nieuwe businesslogica, geen eigen AI-agen. De stappen hergebruiken 1-op-1
de services en guards uit Fase 6–10.

## Harde safety-regels

1. **FORBIDDEN_AUTOMATION_ACTIONS** (`lib/automation/capability-matrix.ts`):
   `send`, `publish`, `approve`, `deliver`, `charge` — deze acties kunnen
   NOOIT door een automation-step worden uitgevoerd. De matrix faalt hard
   zodra een workflow-definitie ze probeert op te nemen.
2. **wait-for-human stap kan nooit slagen zonder mens**: de executor eindigt
   per definitie in `waiting_for_human`; er is géén codepad dat deze stap
   afrondt.
3. **Eén actieve run per entity**: dubbele `runAutomation` voor dezelfde
   entity wordt geblokkeerd (409-gedrag), inclusief race-condition-locking
   binnen één proces.
4. **Stap-limieten**: `maxRetries` (default 2) en `timeoutMs` per step; alleen
   `isTransientError`-fouten (netwerk/timeouts) hertellen als retry. Elke
   andere fout = `failed` en de run stopt.
5. **Kostencap**: elke executor registreert AI-gebruik via `logAiCost`
   (bestaande `ai_runs`-logging uit Fase 4); `getAutomationRunCost(runId)`
   aggregeert per run. Er is nog géén hard budget-plafond — dat volgt in de
   security-hardening.
6. **Autonomieniveau** (`AUTOMATION_AUTONOMY_LEVEL`, default 1): 0 = alles
   blocked, 1 = alleen human-gated stappen toegestaan. Hogere niveaus
   bestaan als type maar worden nog nergens gezet.

## Entity-statussen

- `active` / `paused` (automation), `running` / `waiting_for_human` /
  `paused` / `failed` / `completed` (run)
- Run-stappen: `pending` → `running` → `completed` | `failed` | `skipped`
- **Resume is expliciet**: geen enkele step hervat zichzelf; alleen
  `resumeRun` via server action start de run weer.

## Database (migratie 0008)

Tabellen `automations`, `automation_runs`, `automation_run_steps`,
`automation_queue`, `automation_events` — RLS aan, geen publiek beleid: alle
mutaties lopen uitsluitend server-side. Workflow-definities worden bij
eerste gebruik geseed via `AutomationService.ensureWorkflows()`.

## Supabase-setup (éénmalig)

De Supabase-credentials zijn geconfigureerd, maar de tabellen bestaan nog
niet in het live project. Voer **eenmalig** `supabase/apply-all.sql` in zijn
geheel uit in de Supabase SQL-editor (Dashboard → SQL Editor → New query →
plak → Run). Dit bestand bevat migratie 0001 t/m 0008 in de juiste volgorde.
Zonder deze stap faalt de build zodra de Supabase-credentials actief zijn,
omdat de repository-laag fail-loud kiest boven stille fallback naar mock.

## Scheduler (voorbereid, nog NIET actief)

`lib/automation/scheduler.ts` implementeert de dispatch-loop
(queue → orchestrator → wait), maar wordt nergens automatisch aangeroepen.
Activatie (Vercel Cron) is bewust uitgesteld tot Fase 12+ na Silvijns
expliciete instructie.

## UI

- `/automations` — overzicht workflows + runs (autonomieniveau, status,
  human gates, kosten)
- Run-detail per workflow met stap-timeline en wachtreden

## Tests

`scripts/test-automation.ts` — 79 checks: capability-matrix, guards,
locking, idempotency, human gates (requirements + prijs + QC + approval),
resume-gedrag, kostencap, queue en e2e happy path (`qualifiedLeadToWebsite`
van create-project tot en met `wait-for-human`).
