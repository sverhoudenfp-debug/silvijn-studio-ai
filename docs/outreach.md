# AI Outreach Engine — Silvijn Studio AI (Fase 6)

## Overzicht

```
Lead detail (/leads/[id]) → [Generate Outreach Draft] → server action
        → OutreachService.generateDraftForLead()
              ├─ LeadRepository.get()          (échte leaddata, niets verzinnen)
              ├─ DemoRepository.findByLeadId()  (alleen een READY demo mag genoemd worden)
              ├─ scoreLead()                   (rule-based score factoren, geen AI)
              ├─ AIService.generateOutreachMessage()  (1 gecontroleerde AI-call,
              │    agent "outreach", tier balanced, Zod-gevalideerd, run+activity logging)
              ├─ checkOutreachQuality()        (deterministisch, geen AI, geen repair-loops)
              └─ OutreachRepository.create()   (status: draft of ready_for_review)
```

**Er wordt in Fase 6 NIET verzonden.** `sendEmail()`/EmailProvider (Fase 2) blijft onbenut; er bestaat geen server action die een e-mail verstuurt.

## Draft-lifecycle

```
DRAFT ──(quality check geslaagd)──→ READY_FOR_REVIEW ──(mens)──→ APPROVED ──(latere fase)──→ SENT
  │                                     │
  └── quality check faalt: blijft DRAFT  └── mens ──→ CANCELLED
```

- Nieuwe AI-output begint altijd als DRAFT (nooit direct SENT).
- Quality check slaagt → status ready_for_review (klaar voor menselijke review).
- Quality check faalt → status blijft draft, issues worden op het draft bewaard en getoond.
- APPROVED betekent alleen goedkeuring — verzenden bestaat nog niet.
- SENT kan in Fase 6 via geen enkel pad worden gezet (server action weigert).

## Outreach Agent (bestaande agent-registry)

Agent `outreach` (status: implemented, defaultTier: **balanced**). POWERFUL alléén via expliciete env-override `OUTREACH_AI_TIER=powerful`. Alle AI loopt via de centrale AIService — nooit een aparte Anthropic client; AI_MODE, model-tiers, AI_MAX_REQUESTS_PER_RUN, run-logging en cost tracking gelden onverkort.

## Personalisatie & input

De prompt bevat uitsluitend échte leaddata: bedrijfsnaam, branche, stad/provincie, websitestatus, aanwezigheid van telefoon/e-mail, lead score + factoren, bron, discovery-notities en — alleen indien aanwezig — de READY demo (URL, headline, template). De regels verbieden: verzonnen contactpersonen, claims die niet uit de data volgen, demo-vermeldingen zonder bestaande demo, AI-vermeldingen richting de klant, en prijzige toezeggingen.

## Quality checks (deterministisch, geen AI)

Onderwerpregel aanwezig; body aanwezig + redelijke lengte (150–2500); CTA aanwezig; geen placeholders ({{...}}); geen verzonnen contactpersoon ("Beste meneer Jansen"); geen ongefundeerde claims (vaste patroonlijst); geen AI-vermelding richting klant; geen interne/technische informatie (API-key-patronen, prompt-schema-termen); geen testtekst. In AI_MODE=mock zijn expliciete TESTDATA-markeringen toegestaan (mock output moet per definitie testdata zijn); in live mode zijn ze verboden.

## Mock vs live

- `AI_MODE=mock` (default): deterministische TESTDATA-output via MockAIProvider — geen enkele API-call, geen kosten.
- `AI_MODE=live`: echte Anthropic-call via de bestaande AIService; zonder `ANTHROPIC_API_KEY` faalt de generatie veilig met een duidelijke melding.

## Bulk & kosten

Geen bulkgeneratie. Eén draft per expliciete user-actie. `MAX_OUTREACH_GENERATIONS_PER_RUN` (default 5) begrenst de service per instantie als extra vangnet bovenop `AI_MAX_REQUESTS_PER_RUN`.

## UI

- `/outreach`: echte cijfers uit de draft-repository (totaal, draft, klaar voor review, goedgekeurd, verzonden=0) + conceptenlijst met Goedkeuren/Annuleren. De oude pagina met verzonnen "96 verzonden"-statistieken is vervangen — nepstats zijn niet toegestaan.
- Lead detail: Outreach-sectie met [Generate Outreach Draft], per concept: AI GENERATED DRAFT-badge, onderwerp, body, personalisatiereden, CTA, status, quality issues en de expliciete melding "Deze e-mail is nog NIET verzonden."

## Database

Migratie `0003_outreach_drafts.sql`: tabel outreach_drafts (FK → leads, on delete cascade; channel/status checks; quality_issues text[]; RLS aan zonder publiek beleid — server-side only). Repository-abstractie in `lib/outreach/repository.ts` (MemoryOutreachRepository module-singleton + SupabaseOutreachRepository).

## Privacy (GDPR)

Alleen bedrijfsinformatie uit de eigen lead-database wordt gebruikt — geen scraping van privéprofielen, geen gevoelige persoonsgegevens, geen privé-e-mailadressen. AI-prompts bevatten bedrijfsdata; logs bevatten alléén leadId/draftId, model, mode, tokens en kosten — geen volledige e-mailteksten of persoonsgegevens.

## Master Configuration (voorbereiding, nog leeg)

`lib/config/agency-config.ts` definieert `AgencyConfiguration` (bedrijfsgegevens, tone of voice, outreach/sales/qualification/pricing-regels, verboden claims, enz.). `getAgencyConfiguration()` levert nu een lege config; de outreach-prompt valt terug op neutrale defaults. Silvijn vult de waarden later centraal in — agents dupliceren deze regels niet.

## Environment variables (namen, zie .env.example)

`OUTREACH_AI_TIER` (optioneel: fast/balanced/powerful override) · `MAX_OUTREACH_GENERATIONS_PER_RUN` — naast de bestaande AI-variabelen.
