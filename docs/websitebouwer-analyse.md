# Silvijn Studio AI — analyse van de websitebouwer (Architectuur A)

Datum: 5 november 2026. Read-only analyse; geen code, data of instellingen gewijzigd.
Basis: commit `a31d8a2`, gegenereerd thema in `visual-output/fase3b/theme` (73 bestanden),
913 tests, productie op `silvijn-studio-ai.vercel.app`.

Doel van dit document: eerlijk beeld van wat de bouwer nu zelfstandig kan, wat half af is en
wat ontbreekt, met een nieuwe volgorde waarin de complete website centraal staat.

---

## Samenvattend oordeel

De motor is technisch betrouwbaar en de keten lead → project → website → QC → levering staat.
Wat ontbreekt is geen techniek maar **volledigheid**: de bouwer levert één sterke pagina plus
een lege contactpagina, en daarna is handwerk in Shopify nodig om er een site van te maken.
Zolang dat handwerk nodig is, is "de AI maakt een complete website" niet waar en is de prijs
van 895 euro niet te rechtvaardigen zonder jouw uren erbij.

Kern in één zin: **de bouwer kan één goede pagina maken, maar nog geen website.**

---

## 1. Websitegeneratie (complete sites met meerdere pagina's)

**Status: gedeeltelijk.**

Aanwezig: één deterministische build die een volledig Shopify-thema schrijft (73 bestanden,
12 templates, 28 secties, 4 snippets), inclusief homepage met secties uit het Design Plan,
contactpagina met echte contactgegevens, en systeempagina's (404, zoeken, cart, product,
collectie, klantaccounts, gift card, password).

Ontbreekt: pagina's die het Design Plan voorziet buiten home en contact worden aangemaakt als
**leeg** template:

```ts
// lib/websites/theme-zip/theme-builder.ts:4285
jsonFile(`templates/page.${slugKey}.json`, {
  sections: { main: { type: "main-page", settings: {} } },
  order: ["main"],
});
```

`main-page.liquid` rendert alleen `page.title` + `page.content`, en `page.content` is leeg
omdat er in Shopify nog geen pagina bestaat. Bewijs in de praktijk: de nav bevat
`/pages/over-ons` en `/pages/contact`, maar er is **geen code die pagina's aanmaakt**; er is
nergens een Shopify Admin API-aanroep in de repo. Een verse klant krijgt dus navigatie naar
twee pagina's die pas bestaan nadat jij ze handmatig aanmaakt en het template toewijst.

Correctie op een eerdere lezing van dit rapport: `templates/page.over-ons.json` bleek wél
door de generator gemaakt, namelijk via de blueprint-compositie (`composeBlueprintTemplates`).
Het gat zit dus niet in de compositie maar in de dekking: zonder blueprint (v1-plan) ontstaan
lege shells, en ook met blueprint was er geen garantie op een H1, geen sluitende CTA en geen
controle dat de navigatie naar bestaande pagina's wijst. W1 (5 november) sluit dat gat.

**Wat er moet gebeuren**

- `lib/websites/theme-zip/theme-builder.ts`: per geplande pagina een echte sectiestack
  genereren (hero/tekst/diensten/FAQ/CTA) in plaats van één lege `main-page`.
- `lib/websites/types.ts` + Design Plan-contract: `pageStructure` uitbreiden met een
  sectieplan per pagina (niet alleen een key en titel).
- Nieuw: `lib/websites/shopify/admin.ts` voor paginacreatie, menuopbouw en productimport
  (vereist een Shopify app met `write_content`, `write_online_store_navigation`,
  `write_products`; aparte autorisatie van jou).
- `lib/websites/theme-zip/service.ts`: pagina's en menu's onderdeel maken van de levering,
  met een expliciete status als de Admin API niet geautoriseerd is.

**Verwachte verbetering:** van 1 inhoudelijke pagina naar 5-7, zonder handwerk in Shopify.
**Bewijs:** integriteitstest die elke nav-link en CTA-link afbeeldt op een bestaand doel, plus
een live push naar een unpublished thema waarin alle pagina's openen met inhoud.

---

## 2. Paginastructuur, secties en navigatie

**Status: gedeeltelijk.**

Aanwezig: 28 secties, 12 bloktypes, header met sticky gedrag en mobiel menu, footer-groep,
12 templates, contactpagina met formulier, 404 en zoekpagina.

Ontbreekt: diepgang per sectie. 28 secties verdelen zich over slechts 12 bloktypes, dus de
meeste secties zijn "één blok per keer". Een dienstensectie heeft één kaarttype, een
FAQ-sectie één vraagtype, enzovoort. In de Theme Editor kan een klant daardoor weinig
combineren. Zes van de 26 secties met schema hebben **geen preset**, wat betekent dat ze niet
via "Sectie toevoegen" in de editor te plaatsen zijn. Er zijn 0 `{% doc %}`-blokken, dus de
editor toont geen uitleg bij snippets.

Ook: `page.contact.json` bevat een telefoonnummer uit de specificatie (in de testfixture
`030 000 00 00`). Er is geen controle die plaatsaachtige contactgegevens tegenhoudt voordat
ze op een klantsite belanden.

**Wat er moet gebeuren**

- `theme-builder.ts`: per sectie 2-4 bloktypes waar dat zinvol is (dienst, USP, stap, vraag,
  quote, statistiek), en presets voor alle 26.
- `preflight.ts`: nieuwe check op plaatsaachtige contactgegevens (telefoon/patronen als
  `000 00 00`, `voorbeeld@`, `1234 AB`) → blokkerend bij READY_FOR_SILVIJN.
- LiquidDoc toevoegen aan de 4 snippets en aan secties met verplichte instellingen.

**Verwachte verbetering:** klant kan zelf secties stapelen en variëren; minder revisierondes.
**Bewijs:** snapshot-test die per sectie aantal bloktypes en presets vastlegt; preflight-check
met een fixture die nepcontactgegevens bevat moet falen.

---

## 3. Designkwaliteit en onderscheidend vermogen

**Status: gedeeltelijk, met een bekend plafond.**

Aanwezig: OKLCH-kleursysteem met AA-garantie, 8 OFL-fontpairings (zelf gehost, met licentie),
8 designrichtingen met harde getallen, compositie-engine met variabele splitsingen,
art-direction-contract (header, hero-behandeling, kaarten, decoratie, motion), H1 tot 96,9 px
met veilige mobiele ondergrens, 0 contrastfouten in axe op de homepage.

Ontbreekt: variatie in *vorm*, niet in *tokens*. Er zijn 20 presets maar de compositorische
verschillen zijn offsets van 24-28 px; `art-direction.css` bevat **0 media queries**, dus
art-direction is niet responsive; het thema heeft 21 inline styles die buiten de tokens vallen.
Verschillende branches kunnen daardoor op elkaar lijken.

**Wat er moet gebeuren**

- `lib/websites/theme-zip/art-direction.css` (in de builder): mobiele en tablet-regels per
  compositie; geen decoratie die op 375 px de tekst in de weg zit.
- `lib/websites/theme-zip/blueprint-composition.ts`: minstens drie echte layoutfamilies per
  sectietype (niet alleen offsets), gekozen uit branche + merkpersoonlijkheid.
- Inline styles opruimen in de product-, cart- en zoek-templates.

**Verwachte verbetering:** twee willekeurige branches zien er aantoonbaar anders uit.
**Bewijs:** per branche een screenshotset met een structurele maat (sectiehoogte-variatie,
beeldarea, aantal layoutvarianten) die buiten een bandbreedte moet vallen om "te homogeen" te
signaleren; dat is de meetlat die al bestaat, uitgebreid met een variantie-eis.

---

## 4. Content

**Status: goed voor de homepage, ontbreekt per pagina.**

Aanwezig: een echte ContentPlan-laag (`lib/websites/content/*`) die door de AI wordt gevuld,
met slots, prompt, finalizer, staleness-bewaking en een claimmodel (`contentPlanTrustedClaims`)
zodat de AI geen verzonnen feiten op de site zet. Dit is gekoppeld aan de websiteflow
(`theme-zip/service.ts`) en aan owner-acties (`app/actions/content-plans.ts`).

Ontbreekt: content is homepage-gericht. Er zijn geen slots per pagina, dus over-ons, diensten
en FAQ blijven leeg. Ook ontbreekt een dekkingsoverzicht per pagina ("welke tekst is echt
van de klant, welke is neutraal") dat de klant tijdens de questionnaire ziet.

**Wat er moet gebeuren**

- `lib/websites/content/content-slots.ts`: slots groeperen per pagina (home, over-ons,
  diensten, contact, FAQ) met dezelfde open/bekend-regels.
- `content-plan-prompt.ts`: prompt per pagina, met de eis dat elke pagina een eigen
  zoekintentie en eigen kop heeft.
- `app/actions/content-plans.ts` + questionnaire: per pagina laten zien wat nog ontbreekt.

**Verwachte verbetering:** elke pagina heeft eigen, geloofwaardige copy zonder verzonnen feiten.
**Bewijs:** test die per pagina minstens één gevulde sectie en een niet-lege meta-description
eist; plus een claimtest die verzonnen feiten moet weigeren.

---

## 5. Functionaliteit (formulieren, knoppen, links, interacties)

**Status: gedeeltelijk, met twee echte fouten.**

Aanwezig: contactformulier via `{% form 'contact' %}`, zoekformulier, cart, klantaccounts,
mobiel menu met `aria-expanded`, sticky header, reduced-motion.

Fout 1: `newsletter.liquid` gebruikt `{% form 'contact' %}`. Aanmeldingen komen dus in de
contactinbox in plaats van in de klantenlijst van de klant.

Fout 2: `main-product.liquid` heeft geen variantveld. De formulier-tag is
`{% form 'product', product %}` zonder `name="id"` en zonder variantkeuze; toevoegen aan
winkelwagen werkt daardoor niet betrouwbaar zodra een product varianten heeft. Voor een
webshop (vanaf 2.495 euro) is dat blokkerend.

Verder: er is geen geautomatiseerde functionele test die knoppen en links in het
gerenderde thema daadwerkelijk aanklikt.

**Wat er moet gebeuren**

- `newsletter.liquid`: `{% form 'customer' %}` met `contact[tags]=newsletter` en succes-/foutstatus.
- `main-product.liquid`: variantpicker, `name="id"`, voorraadstatus, en een `product-form`
  die zonder JS werkt en met JS sneller wordt.
- Nieuwe testset: `tests/theme-functionality.test.ts` die per template de aanwezigheid van
  verplichte velden, formulieracties en linkdoelen afdwingt.

**Verwachte verbetering:** cart, nieuwsbrief en productpagina werken in één keer goed.
**Bewijs:** thema push naar unpublished winkel en een testaankoop met een product met twee
varianten; nieuwsbriefaanmelding moet als klant met tag verschijnen.

---

## 6. Responsiviteit

**Status: gedeeltelijk.**

Aanwezig: 13 media queries in `theme.css` met breakpoints 600/601/760/900/990, fluid
typografie met mobiele ondergrens, dienstengrid dat onder 600 px stapelt, geen horizontale
overflow gemeten op de homepage.

Ontbreekt: art-direction heeft 0 media queries; er is geen tablet-doel (768-1024) in de
meetlat; responsive gedrag wordt alleen op de homepage gemeten, niet op subpagina's of
product/cart.

**Wat er moet gebeuren**

- `art-direction.css` in de builder: regels per compositie voor ≤760 en 768-1024.
- `scripts/visual/run.ts`: drie viewports (375, 820, 1440) en per template meten, inclusief
  overflow-detectie en minimale aanraakdoelen (44 px).

**Verwachte verbetering:** geen kapotte layouts op tablet, geen afgekapte koppen.
**Bewijs:** meetlatrapport per viewport met 0 overflow en 0 doelen onder 44 px op alle
inhoudelijke pagina's.

---

## 7. Shopify-techniek

**Status: technisch correct, verificatie incompleet.**

Aanwezig: geldige themastructuur, `settings_schema.json` met naamlimiet-bewaking (25 tekens),
zelf gehoste fonts met licenties in het thema, `theme.js` van 2 KB, 42 vertaalsleutels,
`nl.default.json`, en een certificatiegate die READY_FOR_SILVIJN blokkeert zonder
checksum-geverifieerde ZIP.

Ontbreekt: Shopify's eigen Theme Check kon in deze omgeving niet draaien (de CLI vereist
Node 22, de sandbox heeft Node 20). Daarmee is de belangrijkste externe controle nu
onbewijsbaar, terwijl preflight hem als optioneel behandelt. Verder: alleen `nl` als locale,
dus andere markten vallen terug op ontbrekende sleutels; 0 LiquidDoc.

**Wat er moet gebeuren**

- CI-stap (GitHub Actions) die Theme Check op Node 22 draait en bij error-severity faalt,
  zodat de controle niet afhankelijk is van deze sandbox.
- `locales/en.default.json` toevoegen en de 42 sleutels compleet maken.
- Preflight: externe Theme Check verplicht maken voor certificatie (niet optioneel).

**Verwachte verbetering:** importeerbaar thema zonder verrassingen, meetbaar in elke commit.
**Bewijs:** groene CI-run met Theme Check-rapport als artefact, plus een import in de
testwinkel met 0 errors.

---

## 8. Klantbeheer na oplevering

**Status: basaal.**

Aanwezig: 157 instellingen over 26 secties, 12 bloktypes, 20 presets, merchant-switchbare
compositie, kleur- en fontkeuze via settings, en een dashboard waarin jij websites en QC
beheert.

Ontbreekt: de klant beheert in Shopify zelf, en daar is de ervaring mager: geen LiquidDoc of
instructie in de editor, weinig bloktypes, en pagina's bestaan niet tot iemand ze aanmaakt.
Er is geen "wat mag de klant zelf aanpassen"-document en geen bewaking dat een klantwijziging
de merkconsistentie breekt.

**Wat er moet gebeuren**

- LiquidDoc + korte editorinstructie per sectie (in het thema, dus zichtbaar in Shopify).
- Presets voor alle secties, zodat "Sectie toevoegen" werkt.
- `docs/klantbeheer.md`: wat de klant zelf doet, wat via jou loopt, met schermafbeeldingen.

**Verwachte verbetering:** minder "hoe pas ik dit aan"-vragen na oplevering.
**Bewijs:** doorloop in de Theme Editor als klant: elke sectie toevoegen, verwijderen en
herschikken zonder foutmelding.

---

## 9. Betrouwbaarheid en validatie

**Status: sterk, met één blinde vlek.**

Aanwezig: 913 tests groen, typecheck en lint schoon, 10 preflight-groepen bovenop de
validator, deterministische QC, certificatiegate met checksum, en een meetlat die per versie
contrast, typografie, regellengte en beeldgebruik vastlegt.

Blinde vlek: alles wat hierboven "ontbreekt" is niet fout bevonden omdat er niets naar kijkt.
De QC kent geen check op paginavolledigheid, geen check op variantvelden en geen check op
nav-doelen die nergens heen wijzen. Validatie bewijst dus "dit thema is niet kapot", niet
"dit is een complete website".

**Wat er moet gebeuren**

- QC uitbreiden met: elke nav-link heeft een doel, elke pagina heeft ≥3 secties,
  productformulier heeft een variantveld, nieuwsbrief gebruikt het juiste formulier,
  geen plaatsaachtige contactgegevens.
- Per-pagina visuele regressie (screenshots) als artefact bij elke build.

**Verwachte verbetering:** "compleet" wordt een meetbare eigenschap in plaats van een oordeel.
**Bewijs:** een opzettelijk leeg gegenereerde site moet door QC worden afgekeurd.

---

## Nieuwe ontwikkelvolgorde

Deze volgorde vervangt de oude fase-indeling vanaf nu. Elke stap is af te ronden en te
bewijzen zonder dat de volgende nodig is.

**W1 — Meerpagina-fundament.** Pagina's met echte sectiestack, gegenereerd uit het Design
Plan; nav en CTA's alleen naar bestaande doelen. Bewijs: linkintegriteitstest + screenshot per
pagina. Raakt: `theme-builder.ts`, `types.ts` (pageStructure), `main-page`-sectie,
`preflight.ts`.

**W2 — Content per pagina.** ContentPlan-slots per pagina, prompt per zoekintentie, dekking
per pagina zichtbaar in het dashboard en de questionnaire. Bewijs: paginadekkingscheck.

**W3 — Commerce-plumbing.** Variantpicker en `product-form`, cart-afhandeling,
nieuwsbrief via `form 'customer'`, collectiefilters. Bewijs: testaankoop met twee varianten
en een nieuwsbriefaanmelding die als klant verschijnt.

**W4 — Levering in Shopify.** Admin API voor pagina's, menu's en producten, met eerlijke
status als rechten ontbreken. Bewijs: één commando levert een werkende site, incl. navigatie.

**W5 — Designverdieping.** Bloktypes per sectie, presets compleet, art-direction responsive.
Bewijs: variantie-eis in de meetlat tussen twee branches.

**W6 — Klantbeheer.** LiquidDoc, editorinstructie, klantbeheerdocument. Bewijs: editor-doorloop.

**W7 — Bewijsvoering.** Theme Check in CI, per-pagina visuele regressie, QC-checks op
volledigheid. Bewijs: groene CI met artefacten per pagina op drie viewports.

Fase 3 (beeldpipeline) staat gepauzeerd: integratie blijft staan, één FLUX-beeld is gemaakt,
geen verdere generaties tot jij groen licht geeft. Fase 4 is niet gestart.

---

## Wat ik als eerste zou doen

W1, en daarbinnen eerst de linkintegriteit en de paginasecties. Dat is het verschil tussen
"een mooie pagina" en "een website", het kost geen nieuwe externe diensten, en het maakt alle
latere stappen (content, commerce, levering) klein en toetsbaar.
