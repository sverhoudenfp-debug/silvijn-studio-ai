# Verbeterplan visuele kwaliteit — Architectuur A

**Status:** vastgesteld 5 november 2026. Architectuur A (eigen engine) blijft de basis.
Dit document vervangt eerdere versies van het verbeterplan en legt de besluiten,
de meetlat en de fasering vast.

## 1. Uitgangspunt

De generator is technisch solide (validatie, thema-opbouw, Shopify CLI-push) maar
visueel zwak. De oorzaak is niet de architectuur: het is de **designlaag** en de
**content- en beeldlaag**. Daarom wordt A niet vervangen, maar versterkt.

Meetbaar bewijs uit de nulmeting: H1 96,9px op desktop maar 0% beeldarea, 6
placeholders, één vaste sectiemaat en 8 contrastfouten.

## 2. Besluiten (5 november 2026)

| # | Besluit | Gevolg voor de bouw |
|---|---|---|
| 1 | Beeldpipeline is **provider-onafhankelijk**; Pexels is geen voorwaarde | Eén interface, meerdere bronnen achter een poort |
| 2 | **Geen herkenbare personen** zonder aantoonbare toestemming | Team, over ons en realisaties standaard mensvrij; sfeerbeelden van gebouw, tuin, materiaal en werk mogen |
| 3 | **G-content** (algemene, branchegerichte tekst) is toegestaan | Herkenbaar in het dashboard, feiten onderbouwd, nooit automatisch live, geen opvulling |
| 4 | Beeldkwaliteit gaat **vóór** kosten | Modelkeuze op kwaliteit; kosten zijn verwaarloosbaar |
| 5 | Typografie volledig responsief | Desktopmaten zijn richtlijnen; mobiel heeft een eigen veilige ondergrens |
| 6 | Contrastproblemen worden **in de fase zelf** opgelost | Geen contrastschuld doorschuiven naar later |
| 7 | Iedere fase moet aantoonbaar beter zijn | Vaste meetlat, screenshots desktop en mobiel per fase |

## 3. Beeldproviders — onderzoek

### AI-generatie

| Model | Prijs | Commercieel | Geschikt |
|---|---|---|---|
| **FLUX.2 [pro]** (fal.ai) | $0,03 eerste MP, $0,015 per extra MP | ja | **Voorkeur**: architectuur, interieur, materiaal, natuurlijk licht |
| FLUX 1.1 [pro] | $0,04/MP | ja | Terugvaloptie, iets minder sterk |
| Ideogram v3 / Recraft v3 | $0,03–0,04 per beeld | ja | Typografie/design, minder fotorealistisch |
| Stable Diffusion 3.5 Large | $0,065/MP | ja, met omzetdrempel $1M | Ongeschikt als standaard voor een bureau |
| gpt-image-2 (OpenAI) | $0,041–0,165 per beeld | niet geverifieerd | Niet gebruiken zonder licentietoets |

Reken voor 8 beelden per site op **$0,25–$0,65**. Dat is geen reden om kwaliteit
in te leveren.

Belangrijk technisch detail: **FLUX.2 kent geen negative prompt**. "Geen mensen"
werkt averechts. De prompt beschrijft daarom een lege, doorleefde scène
("unpopulated scene: no people, no faces, empty of figures") en stuurt op
brandpuntsafstand, licht en textuur.

### Stock

| Bron | Commercieel | Automatisering | Oordeel |
|---|---|---|---|
| **Shutterstock** | Platform License dekt levering aan klanten expliciet | 1000 req/min | Beste juridische basis, sales-cyclus nodig |
| **Pixabay** | Content License, geen attributieplicht | 100 req/min, 24u-cache, geen massadownloads | Gratis aanvulling, geen hoofdpad |
| **Openverse (alleen CC0)** | CC0 is veilig | OAuth, aggregator | Gratis vulling; kwaliteit wisselvallig |
| Freepik / Magnific | licentie per download | dagcap | Mogelijk, later |
| Adobe Stock | Standard volstaat | geen self-serve toegang | Nu niet haalbaar |
| Unsplash | — | **non-automated clausule** | Ongeschikt voor volledige automatisering |
| Pexels | — | uitgeefpauze bevestigd | Uitgesloten tot nader order |

### Conclusie

- **Hoofdpad:** FLUX.2 [pro] via fal.ai (API-key, geen OAuth, queue-endpoints).
- **Aanvulling:** Pixabay (gecachet, binnen volume) en Openverse CC0.
- **Later:** Shutterstock Platform License zodra volume en marge dat rechtvaardigen.
- **Nooit:** Unsplash in een geautomatiseerde keten; Pexels tot de pauze voorbij is.

## 4. Wat er gebouwd is

### Fase 0 — meetlat

`npm run visual -- --label <fase>` bouwt de gouden hoveniersfixture, rendert de
pagina's, meet desktop en mobiel en schrijft screenshots plus een rapport. Vaste
criteria: H1, mobiele H1, typebereik, woorden, sectiehoogte-variatie, paginahoogte,
regellengte, beeldarea, echte beelden versus placeholders, aantal tekstkleuren en
axe-contrastfouten.

### Fase 1 — Design Intelligence

- OKLCH-kleursysteem met AA-garantie per vlak (surface, accentband, accent).
- Fluid typografie met veilige mobiele ondergrens (40px) en dynamische
  desktop bovengrens (96,9px).
- Acht stijlgidsen met harde getallen voor typografie en layout.
- Resultaat: 8 contrastfouten → 0; H1 42,2px → 96,9px; regellengte 61 tekens.

### Fase 2 — Layout en compositie

- Secties krijgen hun compositie op **positie** (`nth-of-type`): drie
  splitsingsverhoudingen, drie sectieritmes, uitgelichte eerste kaart, verticale
  verspringing.
- Gevonden en gefixt: alle layoutregels hingen aan `.main-content`, terwijl de
  wrapper `main#main-content` is — die CSS deed nooit iets.
- Alles schermgebonden (≥601px, ≥900px), dus mobiel blijft stapelen.
- 6 regressietests.

### Fase 3 — Beeldpipeline (in uitvoering)

- `lib/websites/media/image-source.ts`: één interface, drie bronnen, harde poorten.
  Geen commercieel recht → geweigerd. Attributieplicht zonder vermelding →
  geweigerd. Herkenbaar persoon in hero/team/realisaties zonder toestemming →
  geweigerd. Geen bron → geen beeld (placeholder blijft), nooit een verzonnen foto.
- Beelden stromen als themabron (`assets/`) naar de homepage; subpagina's houden
  hun eigen hero.
- Live bewezen met twee CC0-foto's: beeldarea 0% → 4-5%, echte beelden 0 → 2.

## 5. Nog te doen

| Fase | Werk | Blokkade |
|---|---|---|
| 3b | fal.ai-key + eerste echte FLUX.2-serie, kwaliteitsoordeel per branche | key en tegoed |
| 3c | Beeldarea omhoog: hero-varianten met volledige bleed, services-kaarten en galerij vullen | ontwerpkeuze |
| 4 | Content Engine: G-content met feitenregister en dashboardmarkering | — |
| 5 | Visuele QC: beeldrelevantie, personencheck, contrast als poort | — |
| 6 | Meten over meerdere branches, niet alleen de hovenier | — |

## 6. Regels die niet meebewegen

- Architectuur A blijft; geen thema-migratie.
- Bestaande functionaliteit en validatie blijven intact; elke wijziging met tests.
- Geen publicatie zonder menselijke goedkeuring; G-content nooit automatisch live.
- Geen secrets in code; keys via omgevingsvariabelen.
- Bij iedere fase: dezelfde fixture, dezelfde meetlat, screenshots naast elkaar.
