# Quality Control + Human Approval — Silvijn Studio AI (Fase 10)

## Architectuur

```
GENERATED WEBSITE (Fase 9, status ready_for_qc)
      ↓
DETERMINISTIC CHECKS (9 categorieën, hard)
        +
AI QUALITY ANALYSIS (adviserend, 1 gecontroleerde AI-call)
      ↓
COMBINED QC REPORT (merge: worst-wins — AI kan alleen verzwaren)
      ↓
PASS / NEEDS_REVISION / FAIL (automatische regels, deterministisch)
      ↓
READY_FOR_SILVIJN (alleen bij PASS)
      ↓
HUMAN APPROVAL (server action, expliciete bevestiging)
      ↓
APPROVED  ← eindpunt van Fase 10 (delivery = latere fase)
```

Hybride QC: wat codematig betrouwbaar te controleren is, wordt
DETERMINISTISCH gecontroleerd (technical, security, SEO-structuur,
accessibility-structuur, business accuracy, fabricatie-regels). De AI
concentreert zich op content, UX, design, conversion, wording en
business-consistentie — **adviserend**: ze mag issues classificeren en
aanbevelingen doen, maar nooit harde regels afzwakken en nooit
goedkeuren.

## QC-datamodel

`QualityControl` (lib/qc/types.ts): id, generatedWebsiteId, projectId,
leadId, websiteVersion, status (pending/running/completed/failed),
overallResult (pass/needs_revision/fail/blocked), checks (9
categorieën met elk passed/warning/failed/not_checked), issues (met
severity info/warning/error/critical), warnings, passedChecks,
failedChecks, recommendations, aiSummary, score (0-100 — interne
kwaliteitsindicator, géén commerciële prijs en géén automatisch
"goed genoeg"-oordeel), aiRunId, mode, model, approval (menselijke
actie-log) en tijdstempels.

## De 9 check-categorieën

1. **Technical** — build-status, generatiestatus, specificatievalidatie,
   vereiste componenten (header/hero/contact/footer), duplicate
   sections, routes, navigatie, interne preview-links.
2. **Content** — herhaal van de Fase 9-fabricatiechecks (verzonnen
   prijzen, garanties, certificaten, keurmerken, ratings, reviews,
   openingstijden, testimonials, contactgegevens) + placeholder-detectie
   ([INFORMATIE ONBEKEND] = correct gedrag, INFO) + missende content
   (subheadline, over-ons, dienstomschrijvingen → WARNING). Grammatica/
   toon beoordeelt de AI.
3. **Design** — template-bestaan, sectievolgorde conform registry,
   consistente accentkleuren-klassen, hero-beeldvereiste. Visueel
   oordeel = AI.
4. **Responsive** — STRUCTURAL CHECK: alle componenten komen uit de
   mobile-first, responsive gecontroleerde bibliotheek. VISUAL CHECK is
   expliciet NIET uitgevoerd (WARNING) — er wordt nooit gedaan alsof er
   een echte browser-/screenshot-test heeft plaatsgevonden.
5. **Conversion** — primaire CTA, contactsectie, contactmethodes,
   diensten, lead-capture. Duidelijkheid beoordeelt de AI.
6. **SEO** — titel-/meta-lengtes, bedrijfsnaam + plaats in titel,
   keywords, localArea, heading-hiërarchie (één h1), rankingclaims
   ("op #1 in Google") worden geblokkeerd. Geen ranking-voorspellingen.
7. **Accessibility** — heading-structuur, link-/button-labels,
   image/alt-vereisten, formuliernotitie. Volledige WCAG-compliance is
   expliciet NIET bewezen (kleurcontrast/keyboard = echte audit,
   NOT_CHECKED).
8. **Security** — API-keys/secrets, eval/Function/script-patronen,
   interne prompts/AI-instructies, interne agency-info, unsafe
   URL-schema's (javascript:/data:), path traversal in slugs,
   AI-vermeldingen richting bezoekers. Scant zowel de specificatie als
   de gegenereerde content.
9. **Business Accuracy** — website vs. Lead + Project + Requirements:
   bedrijfsnaam (CRITICAL bij mismatch → FAIL), plaats (ERROR),
   branche (WARNING), contactgegevens exact, afgesproken functionaliteit
   (e-commerce), missingInformation expliciet als MISSING_INFORMATION
   (INFO) — nooit als feit.

## Automatische result-regels (deterministisch)

- CRITICAL issue → FAIL
- Security FAILED → FAIL
- Technical FAILED → FAIL
- Gefabriceerde bedrijfsinformatie (ERROR/CRITICAL fabricatie-regel) → FAIL
- Verkeerde bedrijfsnaam → FAIL
- ERROR issues of FAILED categorieën → NEEDS_REVISION
- Alleen warnings → kan PASS zijn

De AI kan deze regels NIET overrulen: de merge is worst-wins —
AI-input kan alleen verzwaren. De score (0-100) is een interne
indicator en zegt nooit iets over goedkeuring of levering.

## Statusflow (GeneratedWebsite)

generating → generated → building → ready_for_qc → qc_running →
ready_for_silvijn → approved. Bij problemen: failed (QC FAIL / build) of
needs_revision (NEEDS_REVISION of menselijk revisieverzoek). Regeneratie
archiveert alléén nog-lopende versies (ready_for_qc/qc_running/
needs_revision) — APPROVED-, FAILED- en gearchiveerde versies blijven
ongemoeerd; alle versies en QC-history blijven terugvindbaar.

## Human approval (harde gate)

- `approveWebsite` (server action): alléén mogelijk bij status
  READY_FOR_SILVIJN én QC voltooid én PASS én geen critical issues én
  build geslaagd én security niet failed. **Geen override in deze fase.**
- UI vraagt altijd expliciete bevestiging ("Approve website versie N?")
  met bedrijfsnaam, versie, QC-resultaat, critical issues en warnings.
- Approval wordt gelogd: approver (agency-user-abstraction "Silvijn",
  via `getApproverName()` — echt auth-systeem is een latere fase),
  tijdstempel, website-versie, QC-id en actie.
- APPROVED betekent: website is door Silvijn goedgekeurd. NIET: project
  geleverd. `Project.status` wordt door QC/approval bewust NIET
  gewijzigd; delivery en completion volgen in een latere fase.

## Revision flow

`requestWebsiteRevision` (server action): vereist een reden
(+ optioneel geselecteerde issues en notities). Zet status
needs_revision en logt de actie. De bestaande versie blijft ongewijzigd
bewaard; daarna kan via de bestaande generatie-flow v{n+1} ontstaan —
nooit overschrijven. `archiveWebsite` archiveert menselijk; de versie
blijft terugvindbaar.

## AI Quality Control Agent

Agent `website_quality_control` (implemented, tier **BALANCED**; override
`WEBSITE_QC_AI_TIER`). Eén gecontroleerde AI-call per QC-run
(`website_quality_analysis`), Zod-gevalideerd via QCAnalysisSchema.
De AI ontvangt: project, lead, requirements, specificatie, gegenereerde
secties en de deterministische resultaten. De AI mag analyseren,
classificeren en aanbevelen — NIET goedkeuren, leveren, publiceren,
contracteren, factureren of prijzen verzinnen. AI-failure → QC FAILED
(geen pass), website keert terug naar ready_for_qc; deterministische
resultaten blijven in het rapport bewaard.

Mock mode: deterministische, veilige analyse rechtstreeks uit de echte
data (0 API-calls). Live mode: maximaal de bestaende AI-safety
(request-limits, run-logging) — live test wacht op ANTHROPIC_API_KEY.

## Database

Migratie 0007: `quality_controls` (FK → generated_websites/projects/
leads; status-/result-checks; checks/issues/approval als JSONB;
score-check 0-100; RLS aan zonder publiek beleid — server-side only;
mutaties alléén via server actions). Zonder Supabase werkt de
memory-repository; de app breekt niet.

## Logging

AI activity: website_quality_control (started/completed/failed) en
website_quality_analysis via de bestaande Fase 4-infrastructuur.
ai_runs: agent, model, mode, tokens, kosten, duur. Geen secrets, geen
API-keys in logs.

## Limitations (eerlijk gedocumenteerd)

- Geen echte visuele browser-/screenshot-tests: responsive is STRUCTURAL
  CHECK + expliciete WARNING, nooit een nep-"visueel goedgekeurd".
- Geen volledige WCAG-audit (kleurcontrast/keyboard = NOT_CHECKED).
- Geen SEO-rankingclaims of -voorspellingen.
- Contactformulier is presentatie-only (echte verzending = delivery-fase).
- Geen automatische klantdelivery, publicatie, e-mail, contracten,
  facturen, betalingen of productie-deployments — harde grens van deze
  fase.

## Toekomst

- Echte browser/screenshot-testing via een veilige, gecontroleerde
  image/provider (latere fase) → ResponsiveCheckService kan dan
  VISUAL CHECK invullen.
- Delivery-fase: publicatie, domein, klantmail, facturatie — allemaal
  achter menselijke goedkeuring.
- Echte auth → approver wordt de ingelogde gebruiker i.p.v. de
  agency-user-abstraction.
