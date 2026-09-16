# Website Generation Engine — Silvijn Studio AI (Fase 9)

## Architectuur

```
PROJECT (gekwalificeerd, niet cancelled/completed)
      ↓
PROJECT REQUIREMENTS (Fase 8)
      ↓
AI WEBSITE PLANNING (agent website_generation, 1 gecontroleerde AI-call)
      ↓
WebsiteSpecification (Zod-gevalideerd, gestructureerd JSON)
      ↓
DETERMINISTISCHE GENERATOR (WebsiteGeneratorProvider → NextJsWebsiteGenerator)
      ↓
GeneratedWebsite (gestructureerde section-data, géén vrije code)
      ↓
BUILD / VALIDATION (WebsiteBuildService — specificatie + safety + componenten)
      ↓
READY FOR QUALITY CONTROL  ← eindpunt van Fase 9 (menselijke QC volgt in Fase 10)
```

KERNPRINCIPE: de AI schrijft NOOIT productiecode. Ze levert alléén een
gestructureerde WebsiteSpecification (JSON, Zod-gevalideerd). De
deterministische generator vertaalt die naar section-data die door
VOORAF GECONTROLEERDE React-componenten wordt gerenderd
(components/websites/generated-website-renderer.tsx). Er wordt nooit
AI-code uitgevoerd binnen de hoofdapplicatie — geen eval, geen Function
constructor, geen willekeurige code.

## WebsiteSpecification

Gestructureerd model met: business (naam, branche, plaats, provincie,
beschrijving, doelgroep), branding (kleuren/stijl-hints), structure
(pages, navigation, sections), content (headline, subheadline, services,
about, benefits, faq, testimonials, CTA-teksten), conversion (CTA's,
contact-methods, lead capture), media (image requirements/descriptions/
placeholders), seo (title, meta, keywords, localArea) en
missingInformation.

De AI gebruikt uitsluitend échte informatie uit: lead, project,
requirements, discovery-gegevens, bestaande website en de
AgencyConfiguration. Ontbreekt informatie → expliciete placeholder
(`[INFORMATIE ONBEKEND]`) of missing information. NOOIT verzonnen:
klanten, reviews, certificaten, keurmerken, prijzen, medewerkers,
adressen, telefoonnummers, garanties, resultaten of claims.

## Templates

WebsiteTemplateRegistry (lib/websites/templates.ts): local_service,
professional_service, home_improvement, business_standard — met hero-
gradient, accent-klassen, section-volgorde (incl. benefits/faq) en
branche-hints. Deterministische suggestie via selectTemplateForIndustry
(fallback business_standard); de AI kiest het uiteindelijke template.
Nieuwe template = één registry-entry; generator, renderer en preview
hoeven niet te worden aangepast.

## Generator + provider abstraction

`WebsiteGeneratorProvider`-interface met `NextJsWebsiteGenerator`
(geïmplementeerd) en `ShopifyWebsiteGenerator` (bewuste stub die
NotSupported gooit — latere fase). De Next.js-generator: header → hero →
template-sections (services/about/benefits/faq/cta) → contact → footer,
met echte contactgegevens die DETERMINISTISCH uit de lead worden
ingevoegd (de AI echoot ze nooit zelf).

## Versioning

Elke generatie = een NIEUW GeneratedWebsite-record met
`version = vorige + 1` en een unieke slug (`{bedrijf}-v{n}`).
Regeneratie archiveert de vorige versie (status archived) — niets wordt
vernietigd; specificatie, metadata, timestamp, versie en status blijven
bewaard en terugvindbaar (per project en per slug).

## Validatie (WebsiteBuildService)

Deterministische build zonder externe buildomgeving: specification
geldig, vereiste velden aanwezig (businessName/city/headline/services/
CTA/SEO), componenten geldig (alleen bekende section-types, geen
dubbelen, verplichte header/hero/contact/footer), geen malformed data en
de safety checks (hieronder). FAIL → buildStatus failed + buildErrors +
status FAILED; PASS → ready_for_qc.

## Safety / quality guards

Deterministische patrooncontroles (lib/websites/safety-check.ts) die
blokkeren: verzonnen prijzen, garanties, certificaten/keurmerken,
ervaringsclaims met getallen, klantaantallen/resultaten, sterrenratings/
reviewaantallen buiten de echte Google-data, openingstijden,
testimonials die niet uit echte leadnotities komen, telefoonnummers en
e-mailadressen buiten de lead-data, API-keys/secrets, AI-vermeldingen
en interne agency-informatie. Alle checks lopen in de build én worden
getest met fabricatie-fixtures.

## Preview

`/generated-websites/[slug]`: READY_FOR_QC → volledige weergave
(responsive, mobile-first) via de gecontroleerde renderer met banner
"READY FOR QC · nog niet live"; GENERATING/GENERATED/BUILDING →
statuspagina ("Website wordt gegenereerd"); FAILED → foutstatus met
build-errors; onbekende slug → echte 404. `/generated-websites`:
overzicht met echte stats (totaal, generating, ready voor QC, failed) —
de oude nep-shell `/websites` verwijst door.

## Guards

- Project moet bestaan en niet cancelled/completed zijn.
- Lead-status: qualified/interested/contacted/won (new/analyzing/lost
  geblokkeerd).
- Generatie is een expliciete interne actie; human approval is niet
  nodig voor een interne preview.
- MAX_WEBSITE_GENERATIONS_PER_RUN (default 3, hard max 10) per
  service-instantie; guard-failures consumeren geen AI-budget.

## AI

Agent `website_generation` (implemented, tier **balanced**; POWERFUL
alleen bij aantoonbaar complexe requirements — e-commerce, custom
functionaliteit, integraties — of via WEBSITE_GENERATION_AI_TIER). Eén
AI-call (website_planning) per generatie; alles daarna is
deterministisch. Zod-validatie, ai_runs-logging (agent, model, tokens,
kosten, duur) en activity-logging (started/completed/failed) via de
bestaande infrastructuur uit Fase 4. Mock mode: deterministische,
veilige planning rechtstreeks uit de lead-context (0 API-calls).

## Database

Migratie 0006: `generated_websites` (FK → projects + leads, status-/
template/framework-checks, specification + generated_content jsonb,
unieke slug, unique(project_id, version), RLS aan zonder publiek
beleid — server-side only). Zonder Supabase werkt alles via de
memory-repository (de app breekt niet op ontbrekende credentials).

## Security

Geen eval/Function/arbitrary code execution; geen AI-code in de
runtime; geen SSRF (geen externe fetches in het generatiepad); geen
path traversal (slugify stript alles behalve [a-z0-9-]); geen
ongecontroleerde file writes (websites zijn data, geen bestanden); geen
secrets in specificaties (API-key-patrooncheck in de build); echte
contactgegevens alleen deterministisch uit de lead.

## Shopify (toekomst)

De provider-interface is de extensiepunt: voeg later een echte
ShopifyWebsiteGenerator toe (theme ZIP-generation) zonder de core
generator of de Next.js-provider aan te passen. De stub gooit expliciet
NotSupported — geen verborgen half-werk.

## Wat NIET automatisch gebeurt (geen premature autonomy)

Geen productie-deployment, geen publicatie, geen klantmail, geen
contracten, geen facturen, geen betalingen, geen domeinkoppeling, geen
overschrijven van bestaande klantwebsites. De output eindigt bij
READY_FOR_QC; menselijke quality control en goedkeuring volgen in
Fase 10. Beeldmateriaal is placeholder-referenties — een gecontroleerde
image provider is een latere fase.

## Environment variables (namen, zie .env.example)

`WEBSITE_GENERATION_AI_TIER` · `MAX_WEBSITE_GENERATIONS_PER_RUN`.
