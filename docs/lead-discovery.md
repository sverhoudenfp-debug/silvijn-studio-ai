# Lead Discovery Engine — Silvijn Studio AI (Fase 5)

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
