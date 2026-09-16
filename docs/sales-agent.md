# AI Sales Agent + Lead Qualification — Silvijn Studio AI (Fase 7)

## Overzicht

```
Lead detail (/leads/[id]) → inkomende reactie registreren
        → [Analyze Response] (server action)
        → SalesService.analyzeInboundMessage()
              ├─ LeadRepository / InboundMessageRepository     (échte context)
              ├─ DemoRepository / OutreachRepository            (demo + conceptgeschiedenis)
              ├─ AIService.generateSalesResponse()             (1 gecontroleerde AI-call,
              │    agent "sales", tier balanced, Zod-gevalideerd, run+activity logging)
              ├─ checkSalesResponseQuality()                   (deterministisch, geen AI)
              ├─ SalesInteractionRepository.create()           (status draft/ready_for_silvijn)
              └─ conservatieve lead-statussync
```

**Fase 7 stuurt niets en zegt niets toe.** Er bestaat geen verzend-actie, geen prijzen, geen kortingen, geen garanties, geen contracten. De AI is een EERSTE sales-assistent die analyseert en CONCEPTEN voorbereidt; de mens beslist.

## Sales Agent

Agent `sales` (registry: status IMPLEMENTED, defaultTier **BALANCED**; override via `SALES_AI_TIER`). Alle AI loopt via de centrale AIService — AI_MODE, model-tiers, `AI_MAX_REQUESTS_PER_RUN`, run-logging en cost tracking gelden onverkort. Eén AI-call per expliciete analyse; `MAX_SALES_ANALYSES_PER_RUN` (default 5) begrenst de service per instantie. Geen loops, geen recursion, geen bulk.

## Inbound messages

`InboundMessage`: id, leadId, channel (`email`|`linkedin`|`phone`|`other`), sender, subject, body, receivedAt, source. In Fase 7 bestaat er nog géén echte e-mailinbox: berichten worden handmatig geregistreerd via de UI (mock/dev, bron `manual`); de provider-koppeling komt in een latere fase. Repository: memory + Supabase (`inbound_messages`, RLS aan).

## Intent detection (12 intents)

interested · question · price_request · demo_request · call_request · more_information · not_interested · objection · not_now · wrong_contact · opt_out · **unclear**. Bij twijfel kiest de AI unclear + escalatie — nooit gokken.

## Qualification

`LeadQualification`: status (unqualified/qualifying/qualified/not_qualified/needs_human), interestLevel, projectType, needsWebsite, needsEcommerce, wantsDemo, wantsCall, timeline, budgetKnown, decisionMakerKnown, requirementsKnown, missingInformation, qualificationNotes, confidence. Een lead wordt alleen `qualified` als cruciale informatie echt bekend is; anders `qualifying`. Onzeker → `needs_human`.

## Objection handling

price_objection · timing_objection · trust_objection · need_objection · competitor · existing_provider · not_interested · unclear. De AI herkent het bezwaar en draft een antwoord — verzenden/omzetten doet een mens.

## Response rules

Toegestaan: vragen beantwoorden met beschikbare info, vervolgvragen stellen (max 3), demo verwijzen indien aanwezig, interesse bevestigen, call voorstellen. Verboden (en hard geblokkeerd door de deterministische quality check): prijzen/bedragen, korting, garanties, beloftes, contract-/juridische termen, deadlines, fake bevestigingen namens Silvijn, AI-vermeldingen richting klant, interne systeeminfo. `PRICE_INFORMATION_NEEDED` wordt via `escalationReason` gemeld — de AI verzint nooit een prijs (prijsregels volgen in een latere fase).

## Human escalation & READY FOR SILVIJN

Escalatie (automatisch `escalationRequired=true`): definitieve prijs/korting gevraagd, contractuele/juridische vraag, onduidelijke reactie, complexe/custom aanvraag, vertrouwensvraag, lage confidence. Bij escalatie krijgt de interactie direct status **READY FOR SILVIJN** met de reden (zichtbaar op lead-detail en /sales). Daarnaast kan een mens elke interactie handmatig markeren (Mark Ready for Silvijn / Markeer afgehandeld).

## Lead-statussync (conservatieve regels)

| Situatie | Update |
|---|---|
| intent=opt_out | outreachStatus → opted_out |
| positive intent (interested/demo/call) + medium/hoge interesse, huidige status new/analyzing | leadStatus → interested |
| qualification=qualified + medium/hoge interesse, huidige status new/analyzing/interested | leadStatus → qualified |
| not_interested / not_now / bezwaren | géén automatische wijziging (NOOIT lost/won) |
| onduidelijk | status ongewijzigd |

NOOIT een automatische WON- of LOST-status; downgrades gebeuren niet.

## Logging

Bestaande infrastructuur: `sales_analysis` started/completed/failed (AIService), plus domein-events `qualification`, `human_escalation`, `lead_status_sync` (activity repository). Logs bevatten leadId, agent, model, mode, duur, tokens, kosten, intent en escalatiereden — geen volledige klantteksten of persoonsgegevens.

## Mock vs live

- `AI_MODE=mock` (default): deterministische output via keyword-classificatie (lib/sales/mock-classification.ts) — 10 verplichte scenario's in lib/sales/mock-inbound.ts, geen API-calls, TESTDATA-markeringen.
- `AI_MODE=live`: echte Anthropic-call via de bestaande AIService; zonder `ANTHROPIC_API_KEY` faalt de analyse veilig met een duidelijke melding.

## Database

Migratie `0004_sales.sql`: `inbound_messages` + `sales_interactions` (beide FK → leads on delete cascade, checks op enums, qualification als jsonb, RLS aan zonder publiek beleid — server-side only).

## Privacy

Alleen zakelijke informatie uit de eigen database; geen scraping van privégegevens, geen gevoelige persoonsgegevens, geen klantteksten in logs. AI-prompts bevatten uitsluitend de nodige zakelijke context.

## Master Configuration

De AgencyConfiguration (Fase 6) is de centrale bron: `salesRules` en `forbiddenClaims` worden, zodra gevuld, direct afgedwongen in de sales-prompt. Nu vallen ze terug op neutrale defaults — geen verzonnen prijzen of regels.

## Environment variables (namen, zie .env.example)

`SALES_AI_TIER` · `MAX_SALES_ANALYSES_PER_RUN` — naast de bestaande AI-variabelen.
