# C3 Content Intelligence — Architectuurontwerp

**Datum:** 2026-09-20 · **Status:** ontwerp/audit ter review — GEEN implementatie
· **Scope:** content-pass tussen Blueprint en website generation

---

## 1. Audit: hoe content vandaag stroomt

De huidige keten (Fase A t/m C2, commits tot en met 5826edc) werkt zo:

1. **Design Planning** (één AI-call): produceert het interne Design Plan met
   Blueprint v2. De planning-context bevat sinds 5826edc álle questionnaire-
   antwoorden (beide rondes) + lead + requirements + Google-data.
2. **Website Generation** (`lib/websites/service.ts`, stap 5): één AI-call
   `generateWebsiteSpecification` (maxTokens 4000) produceert een **vlakke**
   `WebsiteSpecification.content`-blob: headline, subheadline, valueProposition,
   services[], about, benefits[], faq[], testimonials[], contactIntro,
   CTA-teksten + `seo` + `missingInformation`.
3. **Blueprint-compositie** (`theme-zip/blueprint-composition.ts`): per
   sectie-instantie wordt content uit diezelfde vlakke blob gehaald per
   sectietype (bijv. regel 137–141: hero ← `spec.content.headline`; regel 189:
   elke services-instantie ← `spec.content.services`).

### Geconstateerde hiaten (waarom C3 nodig is)

| # | Hiaat | Detail |
|---|-------|--------|
| 1 | Content is niet per-sectie | Meerdere instanties van hetzelfde type krijgen identieke content; per-instantie differentiatie bestaat alleen in layout/blocks/motion |
| 2 | Questionnaire-data bereikt de specificatie-call niet | De planning-call krijgt lead + notes + requirementsSummary + designPlanSummary (componenten/features), níet de questionnaire-antwoorden. Klant-copy-materiaal valt weg tussen Design Plan en generatie |
| 3 | `copywriting` true/false heeft geen structureel effect | Vandaag: prijs-add-on ("Tekstschrijving"), completeness-check en één prompt-regel ("teksten: te verzorgen"). De AI schrijft altijd dezelfde commerciële copy |
| 4 | Geen per-eenheid bronbinding | trustedClaims bestaat alleen voor blueprint-trustElements (theme-validatie) en sinds 5826edc verbatim-questionnaire-antwoorden (design-plan-consistency). Website-content heeft géén herleidbare herkomst per tekst |
| 5 | Geen slot-artefact | "Wat de klant nog moet aanleveren" bestaat alleen als losse `missingInformation`-regels, niet als uitvoerbare content-slots met instructies |

### Wat er al wél klaar ligt (fundament voor C3)

- **SECTION-REGISTRY** (`blueprint/section-registry.ts`): per sectietype al
  `planningTarget` (tier, `minimalTrustedInput`, `plannableWithEmptySlots`,
  `emptySlotShape`) + blokdefinities (keys, min/max). Dit is hét natuurlijke
  contract voor per-sectie content-eisen.
- **Verbatim-trustpatroon**: `scanTextForFabricationPatterns(text, trustedClaims)`
  bewijst dat "verbatim in bron = vertrouwd" afdwingbaar is (C2-fix, 5826edc).
- **Deterministische override-patroon**: `followUpsAfterDecision` /
  `applyDesignPlanToSpecification` / `enforceTrustedBusinessName` — de AI
  adviséért, een deterministische pass dwingt het beleid af. C3 hergebruikt dit.
- **Blueprints zijn additief en optioneel**: zelfde adoptiepatroon is mogelijk
  voor een ContentPlan (bestaande websites zonder plan blijven exact geldig).

---

## 2. Doel en niet-doelen

**Doel:** een aparte ContentPass die, per blueprint-sectie-instantie,
deterministisch vastlegt: welke content nodig is, uit welke betrouwbare bron die
komt, wat veilig gegenereerd mag worden, wat ontbreekt en wat als
merchant/customer-slot moet blijven staan.

**Niet-doelen (hard):** geen wijzigingen aan production gates, pricing,
payment, approval, delivery of bestaande rendering. Het bestaande
anti-fabricatiecontract wordt niet vervangen maar verlengd.

---

## 3. Voorgestelde architectuur

```
Design Plan + Blueprint v2 (bestaand)
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ CONTENT-PASS (C3) — intern artefact "ContentPlan"        │
│                                                          │
│ 1. assembleContentSourceBundle()      [deterministisch]  │
│    lead + qualification + questionnaire (beide rondes)  │
│    + requirements + design plan + blueprint             │
│    + trustElements → SourceBundle met herkomst per item  │
│                                                          │
│ 2. AI-call: candidate content units   [1 call, live/mock]│
│    per sectie-instantie, contract uit CONTENT_SLOTS     │
│                                                          │
│ 3. Deterministische validatie + policy-pass             │
│    (evidenceCheck, factLockCheck, policyCheck,          │
│     coverageCheck, businessNameGuard, fabricatiescan)   │
│    → ContentPlan status completed | failed (fail-loud) │
└─────────────────────────────────────────────────────────┘
        │  (ContentPlan v{n} in tabel content_plans)
        ▼
Website Generation (bestaand, stap 5/6) ── consumeert ContentPlan
  spec.content wordt deterministisch per sectie-instantie-pad gevuld
  (geen ContentPlan → huidig gedrag 100% ongewijzigd)
        │
        ▼
Blueprint-compositie + theme-ZIP + QC (bestaand)
```

**Nieuwe modules (puur, unit-testbaar, conform huisstijl):**

| Module | Rol |
|--------|-----|
| `lib/websites/content/content-slots.ts` | Gesloten CONTENT_SLOT_REGISTRY per sectietype, afgeleid uit de SECTION-REGISTRY (zie §5) |
| `lib/websites/content/content-source.ts` | `assembleContentSourceBundle()` — puur, herkomst-gelabelde bronitems |
| `lib/websites/content/content-plan.ts` | Zod-schema `contentPlanSchema` + types |
| `lib/websites/content/content-policy.ts` | Deterministische passes: evidence, fact-lock, copywriting-policy, coverage |
| `lib/websites/content/content-plan-service.ts` | Service: guards, AI-call, validatie, opslag, versiebeheer |
| `supabase/migrations/0023_content_plans.sql` | Tabel + RLS (patroon 0020 `design_plans`) |
| `app/actions/content-plan.ts` + UI-sectie | Owner-only server action + projectdetail-paneel (patroon design plan) |

**Positie in de keten:** ná Blueprint (vereist een completed design plan mét
blueprint), vóór website generation. Owner-geïnitieerd, net als designplanning.
Onafhankelijk her-genereerbaar zonder herplanning (belangrijk voor de 5
revisierondes: content-revisie ≠ nieuwe architectuur).

---

## 4. Input van de content-pass: de SourceBundle

Deterministisch gebouwd (géén AI in de bronassemblage). Elk bronitem draagt
herkomst, zodat de policy-pass per content-unit kan afdwingen wat eruit mag:

```ts
type ContentSourceOrigin =
  | "lead"            // bedrijfsnaam, branche, adres, contact, Google-data
  | "qualification"   // qualification-notes van de eigenaar
  | "questionnaire"   // antwoorden beide rondes (via buildQuestionnaireAnswerLines, 5826edc) + completion-analysis contentDimensions
  | "requirements"    // scope, pagina's, copywriting-vlag, deadline
  | "design_plan"     // doelen, doelgroep, USP's, toon, navigatie
  | "blueprint"       // trustElements (bron-verplicht!), blocks-hints,
                      //   contentHints, conversionPlan, sectie-instanties zelf

interface ContentSourceItem {
  origin: ContentSourceOrigin;
  key: string;        // bijv. "questionnaire:ronde2:bewijs"
  text: string;       // de feitelijke tekst (verbatim grondslag)
}
```

- Questionnaire-antwoorden worden via **dezelfde regels** als de Design
  Planning-consumptie gelezen (`buildQuestionnaireAnswerLines` — na 5826edc
  inclusief de follow-upronde).
- `trustElements` zijn al upstream Zod-gevalideerd met verplichte `source`
  (enum: requirements/questionnaire/lead_notes) — de content-pass erft die
  herkomst mee: trust-content MAG alleen uit trustElements-flows komen.
- Uploads blijven aantallen (inhoud is niet leesbaar; wel eerlijk als "1
  sfeerfoto aangeleverd" in de instructies bruikbaar).

---

## 5. Output: het ContentPlan (per blueprint-section)

### 5.1 Content-slots per sectietype

De CONTENT_SLOT_REGISTRY definieert per sectietype de gevraagde
content-eenheden, één-op-één gespiegeld aan de SECTION-REGISTRY-blokken én aan
wat blueprint-composition vandaag leest. Minimale dekking (conform opdracht):

| Contentsoort | Sectietype(s) | Slotkinds |
|---|---|---|
| Hero copy | hero | `headline`, `subheadline`, `cta_label` |
| Headings/subheadings | alle secties | `heading`, `subheading` (uit `contentHints`/purpose, gebonden aan echte paginadoelen) |
| Services | services | `item_title`, `item_body` (aantal = aantal echte dienstblokken) |
| Benefits/USP's | benefits, usp_band | `item_text` (benefits), `item_label` + `item_hint` (usp_band, úitsluitend uit trustElements) |
| Process | process | `step_title`, `step_body` |
| CTA's | cta, alle supportsCta-instanties | `cta_label`, `cta_secondary_label` |
| FAQ | faq | `faq_question`, `faq_answer` |
| About | about | `body` |
| Project/case content | projects | `item_title`, `item_body` (evidence_only: úitsluitend echte cases) |
| Testimonials/stats/rates/team | testimonials, stats, rates, team | `quote`/`quote_author`, `stat_label`/`stat_value`, `rate_item`, `member_name`/`member_role` — evidence_only |
| SEO title/meta | pagina-niveau | `seo_title`, `meta_description` |
| Microcopy | contact/newsletter/booking + UI-labels | `microcopy` (formulierlabels, navigatie, knopteksten — grotendeels deterministische defaults) |

Net als bij de theme-builder geldt: de registry is de **enige bron van waarheid**
— een conformance-test dwingt dat élk sectietype in BLUEPRINT_SECTION_TYPES
een slotdefinitie heeft (patroon `THEME_REQUIRED_SETTING_IDS`).

### 5.2 Content-unit (kernobject)

```ts
const contentUnitSchema = z.object({
  /** Pad: "<pageKey>/<sectionIndex>" — de plek in het blueprint. */
  path: z.string(),
  kind: z.enum(CONTENT_UNIT_KINDS),        // gesloten
  status: z.enum(["generated", "customer_slot", "merchant_slot", "fixed"]),
  text: z.string().nullable(),
  /** Alleen bij status=generated: verbatim fragmenten die de tekst dragen. */
  evidence: z.array(z.string().min(2).max(300)).max(6),
  sourceOrigin: z.enum(CONTENT_SOURCE_ORIGINS).nullable(),
  /** Alleen bij customer_slot: wat de klant moet aanleveren en waar het heen gaat. */
  instruction: z.string().min(10).max(400).nullable(),
});
```

**Statussemantiek:**

| Status | Betekenis |
|---|---|
| `generated` | AI-copy, gedragen door `evidence` (verbatim uit de SourceBundle); commerciële feiten erin zijn fact-locked |
| `customer_slot` | De klant moet dit leveren; `instruction` zegt precies wat en waar het komt te staan (dit is hét afhandelingsartefaat voor copywriting=false én voor ontbrekende informatie) |
| `merchant_slot` | Bewust leeg gelaten, merchant-editable in Shopify (beeldslots, optionele uitbreiding; regeert al in de registry als `plannableWithEmptySlots`/`emptySlotShape`) |
| `fixed` | Deterministisch overgenomen waarde (bedrijfsnaam, contactgegevens, Google-rating) — geen AI aan te pas gekomen |

### 5.3 Plan-niveau

```ts
const contentPlanSchema = z.object({
  version: z.literal(1),
  pages: z.array(z.object({
    key: z.string(),                        // moet in blueprint.pages bestaan
    seo: z.object({ title: ..., metaDescription: ... }).nullable(),
    units: z.array(contentUnitSchema),        // per sectie-instantie op die pagina
  })),
  missingInformation: z.array(z.string()).max(20),
});
```

Deterministische consistentichecks (in `content-policy.ts`):
- elk unit-path bestaat in het blueprint (geen units buiten de architectuur);
- elke sectie-instantie heeft slots voor ál zijn verplichte slotkinds
  (coverage; het blueprint garandeert al de instantiestructuur);
- units op evidence_only-instanties hebben `sourceOrigin` passend bij de
  trustElements-`source`; géen trust-content zonder verbatim bron;
- `fixed`-units zijn byte-gelijk aan de brongegevens;
- bedrijfsnaam exact de lead-bronnaam (hergebruik
  `enforceTrustedBusinessName`-patroon).

---

## 6. Bronbetrouwbaarheid: vier afdwongen lagen

1. **Gesloten input**: de AI krijgt uitsluitend de SourceBundle + slotcontract.
   Zonder bronitem géén claim — de assemblage is deterministisch.
2. **Evidence-check (per unit)**: bij `generated` moet élk `evidence`-fragment
   (genormaliseerd) verbatim in de SourceBundle voorkomen. Dit is exact het
   C2-patroon (`trustedClaims` in `scanTextForFabricationPatterns`): een match
   die verbatim in de bron staat is géén fabricatie. Lessen uit 5826edc zijn
   meegenomen: normalisatie moet omgaan met "resultaat" vs "resultaten" en
   `/beeld/` vs "voorBEELDen" (geen onbedoelde substring-lekken).
3. **Fact-lock (per soort)**: fact-locked waarden (contactgegevens, prijzen,
   tarieven, cijfers, ratings/review-aantallen, openingstijden,
   certificeringen/keurmerken, quotes+ auteurs, teamnamen) mogen NOOIT
   geparafraseerd door de AI — alleen `fixed` (deterministisch overgenomen) of
   verbatim in evidence. De bestaande fabricatie-regels (prijzen, reviews,
   certificeringen, diensten, openingstijden, contactgegevens) blijven
   onaangeroerd en gelden nu óók per unit in plaats van alleen plan-breed.
   **BESLOTEN (C3e-afronding, 2026-09-20 — bewuste ontwerpkeuze / geaccepteerd
   rest-risico):** de verbatim-afdwang van punt 2 geldt volledig voor de
   `evidence`-fragmenten zélf, maar de uiteindelijke unit-tékst van
   NIET-fact-locked commerciële AI-copy wordt alleen op evidence-aanwezigheid
   gecontroleerd, niet woord-voor-woord tegen de SourceBundle. De gekozen
   beveiliging voor deze units is de combinatie van (a) verplichte
   evidence-aanwezigheid (geen evidence → customer_slot), (b) de fabricagescan
   in de ZIP-validatie, en (c) géén trusted-claims-status voor AI-copy (alleen
   fact-locked `fixed`-units komen in trustedClaims, C3d). Er komt bewust GEEN
   nieuwe architectuurlaag voor verbatim-tekstmatching op niet-fact-locked
   copy; het rest-risico (reformulering die (b)/(c) niet vangt) is geaccepteerd
   en vastgelegd in de finalizer-kopdocumentatie.
4. **Policy-override (deterministisch wint)**: de AI-uitkomst is een advies;
   `content-policy.ts` kan elk unit dat het beleid schendt deterministisch
   omzetten naar `customer_slot` (met instructie) — hetzelfde patroon als
   `followUpsAfterDecision`/`applyDesignPlanToSpecification`. Falende
   validatie = status `failed` + fouten, fail-loud, géén half plan.

---

## 7. copywriting=true vs. false (structureel, niet prompt-smaken)

`requirements.copywriting` wordt de schakel die de policy-pass afdwingt:

| Aspect | copywriting = true | copywriting = false |
|---|---|---|
| Headlines, body, services-omschrijvingen, about, benefits-formulering, FAQ-antwoorden | `generated` (professionele copy op basis van evidence) | `customer_slot` mét instructie ("beschrijf in 2–3 zinnen per dienst wat je aanbiedt, zoals je het aan een klant zou uitleggen") |
| Fact-locked waarden | `fixed`/verbatim | idem — feiten mogen altijd geplaatst worden (bedrijfsnaam, contact, echte dienstnamen uit klantinput) |
| CTA-labels | `generated` mits gedragen door conversionGoal + evidence | deterministische defaults ("Neem contact op", "Plan een gesprek") passend bij het echte conversiedoel; nóóit verzonnen claims eromheen |
| Microcopy/UI-labels | deterministische defaults | idem (dit is UI-tekst, geen commerciële copy) |
| SEO title/meta | AI-copy met evidence (naam + echte kern) | deterministische template: naam + branche + plaats (alleen feiten) |
| Ontbrekende informatie | `customer_slot` + `missingInformation` | idem |

Afdwinging zit NIET in de prompt maar in de pass: bij copywriting=false zet de
policy-pass elk commercieel `generated`-unit om naar `customer_slot` (met
instructie), ongeacht wat de AI teruggeeft. De prompt krijgt het beleid ook
mee (minder verspilling), maar de deterministische laag is de garantie.

---

## 8. Opslag: per blueprint-section, geversioneerd

Nieuwe tabel `content_plans` (migratie 0023, patroon 0020 `design_plans`):

```
id, project_id (FK), design_plan_id (FK), version,
status (draft|completed|failed), mode, model,
source_fingerprint,        -- hash over de SourceBundle: her-generatie
                          -- detecteert gewijzigde bronnen
plan JSONB, validation_errors JSONB,
created_date/updated_date/created_by
unique (design_plan_id, version)
```

- **RLS**: anon 0 rechten (live 42501-bewijs), authenticated alleen SELECT,
  service-role R/W — identiek aan `design_plans` (0020).
- **Waarom een eigen tabel (niet JSONB in design_plans):** content her-generéért
  onafhankelijk van de architectuur (revisierondes), heeft eigen versies per
  design-plan-versie, en de source_fingerprint maakt zichtbaar of bronnen
  zijn veranderd sinds de laatste pass. Daarnaast blijft het Design Plan
  zelf ongewijzigd geldig zónder content-pass.
- Owner-only server action + projectdetail-paneel (patroon: designplan-sectie).

---

## 9. Consumptie door bestaande website generation

1. **`generateWebsite` (stap 5/6)**: bestaat er een completed ContentPlan voor
   het actieve design plan, dan wordt `spec.content` deterministisch per
   sectie-instantie-pad uit het plan gevuld (`fixed` → overgenomen;
   `generated` → overgenomen; `customer_slot`/`merchant_slot` → duidelijke
   placeholder-instructie). De AI-specificatie-call behoudt structuur,
   branding, media en conversie, maar het content-contract verschuift van
   "schrijf" naar "neem verbatim over". Post-check: fact-locked velden
   byte-gelijk. **Geen ContentPlan → huidig gedrag 100% ongewijzigd**
   (backward compatible, zoals blueprint v2 additive is).
2. **Blueprint-compositie**: per instantie units op pad lezen i.p.v. de vlakke
   blob (met blob als fallback). Klant-/merchant-slots worden zichtbare,
   merchant-editable settings + een instructielijst ("nog aan te leveren").
3. **theme-ZIP trustedClaims**: uitbreiden met unit-evidence + trustElements,
   zodat de bestaande scan (Fase C) de content-pass-dekking erft.
4. **QC (additief)**: coverage-warnings (ontbrekende klant-slots = "te
   leveren", geen critical), geen wijziging aan bestaande QC-regels of
   luslimieten.
5. **Niets raakt**: production gates (poort vereist betaald+requirements),
   pricing (copywriting-add-on blijft zoals het is; de content-pass is intern
   gereedschap), payment, approval, delivery, rendering (theme-templates
   ongewijzigd; alleen de bron van de content waarden verandert).

---

## 10. Teststrategie

**Unit (deterministisch, geen netwerk):**
- content-slots: elk BLUEPRINT_SECTION_TYPE heeft een slotdefinitie;
  slotkinds gesloten; aantallen gebonden aan registry min/max.
- source-bundle: assemblage over beide questionnayerondes (fixture-lessen
  5826edc: ronde-2-definities, nieuwste-antwoord-wint), uploads als aantallen,
  trustElements-herkomst-erving.
- policy-pass: copywriting=false flippt commercieel generated → customer_slot
  mét instructie; copywriting=true laat correcte generated staan;
  fact-lock weigert geparafraseerde telefoon/prijs/rating; evidence-check
  (normalisatie: "resultaat"/"resultaten", /beeld/-lek); bedrijfsnaam-guard.
- Zod-schema + consistency: paden bestaan, coverage, evidence_only-binding.
- mock-provider levert een contract-conform ContentPlan (patroon: eerlijke
  lege trust-slots zoals blueprint v2).

**SQL-suite (live, patroon 0020/0022):** RLS op content_plans (anon 42501,
authenticated SELECT-only, service-role schrijfpad), FK-integriteit,
unique-constraint versies.

**Live E2E op de zip-flow-fixture (read-only verificatie + transactionele
opruiming, patroon van de questionnaire-E2E):**
1. completed Design Plan mét blueprint → ContentPass: completed, alle
   sectie-instanties gedekt, ronde-2-bewijs correct gebonden;
2. copywriting=false-variant: commerciële units worden customer_slots met
   instructies, feiten blijven `fixed`;
3. fabricatie-injectie (prompt-override-poging) → deterministische weigering;
4. her-generatie: nieuwe versie, bronnen-fingerprint;
5. consumptie: website generation op de fixture produceert specificatie
   waarvan fact-locked velden byte-gelijk zijn; bestaande plannen/leads
   fingerprints exact ongewijzigd.

** regressie:** 391/391 bestaande tests ongewijzigd groen; nieuwe modules puur
en zonder server-only imports zodat ze unit-testbaar blijven.

---

## 11. Open beslispunten (voor implementatie)

1. **Klant-slot-instructies tonen**: alleen intern dashboard-paneel, of ook als
   uit te sturen document/vraagronde aan de klant? (Masterconfig zegt: klant
   levert teksten aan bij copywriting=false — wát precies is vandaag een
   losse mail; het ContentPlan maakt dit één afvinkbaar artefact.)
2. **AI-calls**: één call per ContentPlan (voorstel, budget ~20000 conform
   designplanning-les) versus per pagina — voorstel: één call; per-pagina pas
   als de rijkste case tegen de budget-grens loopt.
3. **SEO-template bij copywriting=false**: deterministisch "Naam — Branche in
   Plaats" als voorgestelde default; bevestigen.
4. **Migratienummer 0023**: controleren tegen de actuele tracking-tabel.
5. **Volgorde binnen C3-fasering**: voorstel C3a contract+slots+policy+tests →
   C3b service+migratie+mock → C3c live fixture E2E → C3d generatie-consumptie
   + compositie → C3e QC-addities + UI-paneel.
