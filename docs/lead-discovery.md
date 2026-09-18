# Lead Discovery & Orchestration — Silvijn Studio AI (Fase 5 + Fase D)

## Overzicht

```
UI /lead-discovery  →  server action runDiscovery()  →  LeadDiscoveryService
                                                              ↓
                          LeadDiscoveryProvider (mock | google* | directory*)
                                                              ↓
   enrichment (normalisatie + validatie) → duplicate check → website-status → LeadRepository.create()
                                                              ↓
                                              DiscoveryResult (Found/Created/Duplicates/Invalid/Errors)
```
*Google/directory zijn stubs: ze melden MISSING CONFIGURATION i.p.v. nepdata.

## Providers

- **MockDiscoveryProvider** (`live=false`): 25+ duidelijk fictieve testbedrijven die alle situaties dekken (zonder/with/slechte website, onbekend, ontbrekende contactgegevens, duplicaten van bestaande leads én binnen de batch, ongeldige kandidaten, meerdere branches/steden). Mock data wordt nergens als echte externe data gepresenteerd.
- **GoogleBusinessProvider / DirectoryProvider** (stubs, `live=true`): werpen een `DiscoveryConfigurationError` met de ontbrekende variabelenaam zodra credentials ontbreken. Implementatie volgt in een latere fase.

## Candidate-lifecycle

`NEW` (gevonden) → validatie → `INVALID` (skip) → duplicate check → `DUPLICATE` (skip) → `CREATED` (lead aangemaakt) — fouten tijdens verwerking → `SKIPPED` met veilige foutmelding (geen stack traces, geen keys).

## Duplicate-detectie

Vijf signalen, gecontroleerd tegen bestaande leads én leads die eerder in dezelfde batch zijn aangemaakt:

1. genormaliseerde website (host-niveau, www-stripped)
2. e-mail (case-insensitive)
3. telefoon (laatste 9 cijfers)
4. genormaliseerde bedrijfsnaam + stad (rechtsvorm, diacritics en spacing genegeerd)
5. source + external ID

Redenen: `DUPLICATE_WEBSITE` / `DUPLICATE_EMAIL` / `DUPLICATE_PHONE` / `DUPLICATE_BUSINESS_CITY` / `DUPLICATE_SOURCE_ID`.

## Website-status (technische basischeck — geen AI)

| Situatie | Status |
|---|---|
| Geen URL | `no_website` |
| URL aanwezig, geen live check (default) | `unknown` — nooit gokken |
| Live check onbereikbaar | `unknown` |
| Bereikbaar maar geen HTTPS/title/broken | `website_poor` |
| Bereikbaar en in orde | `has_website` |

Live checks staan default UIT (`WEBSITE_CHECKS_ENABLED=false`). Een check = één gecontroleerd GET-request met 5s-timeout en ~64KB body-limiet; geen crawling, geen auth-bypass, geen privégegevens.

## Database

Nieuwe leads via de bestaande LeadRepository (mock: memory; Supabase: `leads`-tabel). Migratie `0002_lead_discovery_fields.sql` voegt backward-compatibel `external_id` + `source_url` toe met een partiële unique index op (source, external_id). Discovery-loggeving: console-events (`DISCOVERY_STARTED/COMPLETED/FAILED`, `CANDIDATE_*`) zonder persoonsgegevens; persistence van discovery-logs volgt in de analytics-fase.

## AI

Discovery functioneert volledig ZONDER Anthropic. AI-assisted enrichment (branche-classificatie, beschrijvingen) kan later OPTIONEEL via de bestaande AIService — nooit bulk, altijd binnen `AI_MODE` en `AI_MAX_REQUESTS_PER_RUN`.

## Limits & veiligheid

- `MAX_DISCOVERY_RESULTS` (default 50, hard max 200) per run
- Alleen expliciete aanroep via de server action; geen cron, geen loops, geen pagination zonder limiet
- Provider-fouten worden veilig afgevangen in het resultaat

## Environment variables (namen, zie .env.example)

`MAX_DISCOVERY_RESULTS`, `WEBSITE_CHECKS_ENABLED`, en voor toekomstige echte providers: `GOOGLE_PLACES_API_KEY`, `DIRECTORY_API_KEY`. Credentials uitsluitend server-side.

## Status oude abstractie

`lib/services/lead-source.ts` (Fase 2) is superseded door deze engine en blijft alleen als historische referentie bestaan.


## Discovery-orchestratie (Fase D, 2026-09-18)

De bestaande engine is ongewijzigd hergebruikt; Fase D voegt een gecontroleerde orchestratie-schil toe:

```
UI /lead-discovery (form + run-geschiedenis)
  → server action runDiscovery() — requireStudioOwner, geen automatische trigger
    → DiscoveryOrchestrator (lib/discovery/orchestrator.ts)
        1. opdrachtvalidatie (minimaal branche ÓF plaats/regio; limiet 1-200 afgetopt
           tot MAX_DISCOVERY_RESULTS)
        2. command-record: discovery_runs-rij (status running) vóór de run
        3. hergebruik LeadDiscoveryService.discover() — search → enrich →
           duplicate check (bestaand + batch) → website-status → lead-creatie
           met bestaande rule-based scoring
        4. run-afsluiting: tellingen, scores/prioriteiten per nieuwe lead,
           duplicaatredenen, fouten; één audit_events-rij per run
```

### discovery_runs (migratie 0017)

Command-record per expliciete owner-opdracht: scope (branche/plaats/regio/zoekterm/bron/limiet), status (running/completed/failed), tellingen, created_lead_ids, jsonb-samenvatting en fouten. RLS aan; anon heeft geen enkele permissie; authenticated uitsluitend SELECT via de `discovery_runs_owner_read`-policy (`is_studio_owner()`); schrijven gebeurt alleen server-side (service-role).

### Samenvatting in het dashboard

Na elke run: opdracht + status, chips (gevonden/nieuw/duplicaten/ongeldig/fouten/duur), nieuwe leads met score en prioriteitsband (≥70 hoog, ≥40 middel, anders laag), kandidatentabel met oversla-redenen, en de recente opdrachtgeschiedenis. Run-status is `failed` zodra de run fouten bevat (incl. providerfouten — de google/directory-stubs melden MISSING CONFIGURATION en verzinnen nooit data).

### Grenzen (onveranderd)

Discovery start uitsluitend via de expliciete owner-trigger, verstuurt nooit outreach, muteert nooit bestaande leads (duplicaten en bestaande leads worden veilig overgeslagen) en gebruikt uitsluitend broninformatie van providers; mock-data wordt nooit als echte externe data gepresenteerd.
