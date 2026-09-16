# AI- & Database-architectuur — Silvijn Studio AI (Fase 4)

## Overzicht

```
UI / Pages / toekomstige agents
        ↓
   AIService (lib/ai/service.ts)          LeadRepository / DemoRepository / AIRunRepository
        ↓                                          ↓
   AIProvider (lib/ai/provider.ts)         Mock-implementatie | Supabase-implementatie
   ├── MockAIProvider  (mock mode)                ↓
   └── AnthropicProvider (live mode)       lib/supabase/server.ts (secret key, RLS bypass)
                ↓
        Anthropic Claude API
```

## AI-provider

- **Anthropic** is de primaire provider; de SDK wordt uitsluitend aangeroepen vanuit `lib/ai/anthropic.ts`.
- **Mock mode** (default, `AI_MODE=mock`): voorspelbare output, geen API-aanroepen, geen kosten. De volledige Zod-validatie-pipeline draait ook in mock mode.
- **Live mode** (`AI_MODE=live`): vereist `ANTHROPIC_API_KEY` (server-side only). De key verlaat de server nooit en staat nergens in Git.

## Modelconfiguratie

Eén centrale plek: `lib/ai/config.ts`. Tiers met defaults (per env te overschrijven):

| Tier | Default model | Gebruik |
|---|---|---|
| fast | claude-haiku-4-5 | hoog volume, classificatie |
| balanced | claude-sonnet-4-5 | standaard productietaken |
| powerful | claude-opus-4-5 | zware generatie-taken |

## AI-services

- `generateText()` — vrije tekst (expliciete call).
- `generateStructured(schema)` — JSON-output, geëxtraheerd en gevalideerd met Zod; ongeldig antwoord triggert een beperkte retry.
- `analyzeBusiness(input)` — eerste geïmplementeerde agent-service; output sluit aan op `Lead.aiAnalysis`.

## Logging en kosten

- Elke AI-execution wordt gelogd in **ai_runs** (agent, taak, model, mode, tokens, kosten, duur, fouten) via `AIRunRepository`.
- Domein-activiteiten ("business analysis gestart/voltooid/mislukt") worden gelogd in **ai_activities**.
- Kosten worden berekend via `lib/ai/pricing.ts` (centrale prijstabel — schattingen, bij modelupgrade controleren).
- Zonder Supabase-configuratie vallen beide logs veilig terug op console/in-memory.

## Kostenveiligheid (Fase 4)

- Alle AI-calls zijn **expliciet** — geen cron, geen loops, geen bulk, geen automatische agents.
- `AI_MAX_REQUESTS_PER_RUN` (default 5) begrenst het aantal verzoeken per service-instantie.
- Mock mode is de default; live mode faalt fail-fast zonder `ANTHROPIC_API_KEY`.

## Agent-registry

`lib/ai/agents.ts` definieert de toekomstige agents (lead-research, business-analysis, lead-scoring, demo-generation, outreach, sales, qualification, pricing, website-generation, quality-control). In Fase 4 is alleen `business_analysis` geïmplementeerd; `lead_scoring` bestaat rule-based (lib/agents/lead-scoring.ts). De overige zijn geregistreerd als toekomstige capabilities.

## Database (Supabase)

- Migratie: `supabase/migrations/0001_init.sql` — tabellen `leads`, `demo_websites` (FK → leads, unique slug), `ai_activities`, `ai_runs`, met constraints, indexen en `updated_at`-triggers.
- Seed: `supabase/seed.sql` — gegenereerd uit de mock data via `npx tsx scripts/generate-seed.ts`; uitsluitend fictieve bedrijven.
- RLS staat aan op alle tabellen zonder publiek beleid: in Fase 4 verloopt data-toegang uitsluitend server-side via de secret key. Authenticatie volgt in de security-fase.
- Repository-abstractie (`lib/repositories/`): de UI praat alleen met repositories. Zodra `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SECRET_KEY` zijn geconfigureerd, schakelen alle dataroutes automatisch van mock naar Supabase (opnieuw builden vereist).

## Environment variables

Zie `.env.example` (uitsluitend namen): `ANTHROPIC_API_KEY`, `AI_MODE`, `AI_MODEL_FAST`, `AI_MODEL_BALANCED`, `AI_MODEL_POWERFUL`, `AI_MAX_REQUESTS_PER_RUN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.

## Testen

- `npx tsx scripts/test-ai.ts` — gecontroleerde test (mock of één live call als `ANTHROPIC_API_KEY` aanwezig is) met een fictief bedrijf; valideert output, logging en safety-limieten.
- Nooit echte klantdata, nooit bulk calls.
