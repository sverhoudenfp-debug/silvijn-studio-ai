# Veld & Vorm — W9: beeldpipeline en beeldintegratie (6 november 2026)

Label `w9final` · 987 tests · visuele QC 0 kritiek / 3 waarschuwingen · 0 contrastfouten.

## 1. fal.ai — configuratie

| Controle | Uitkomst |
|---|---|
| Code gebruikt `FAL_KEY` uit de omgeving | ja, `providerConfigFromEnv` |
| Endpoint | `https://fal.run/fal-ai/flux-2-pro` (FLUX.2 [pro]) |
| Key in sandbox | aanwezig, werkt (testgeneratie 11,3 s) |
| Key in Vercel-productie | **niet vast te stellen**: CLI niet ingelogd, geen token beschikbaar |
| Benodigde actie | `FAL_KEY` toevoegen in Vercel → Settings → Environment Variables (Production) + redeploy |
| Opslag en koppeling | beelden als thema-asset in de ZIP; `meta.json` met licentie, prompt, seed, alt |

Zonder `FAL_KEY` in productie blijft het placeholderspad actief; dat is de eerlijke fallback.

## 2. Gegenereerde beelden

Acht beelden, één fotografische stijl, geen herkenbare personen, geen verzonnen projecten:

| Slot | Onderwerp | Formaat | Gewicht |
|---|---|---|---|
| hero | natuurlijke tuin, terras, late middag | 1024×576 | 164 kB |
| about | detail beplanting en materiaal | 1024×768 | 94 kB |
| services_1 | ontwerpschetsen en monsters | 1024×768 | 113 kB |
| services_2 | aanleg: bestrating en borders | 1024×768 | 118 kB |
| services_3 | beplantingsborder | 1024×768 | 97 kB |
| services_4 | onderhoud: haag en pad | 1024×768 | 102 kB |
| gallery_1 | terrasdetail | 1024×768 | 213 kB |
| gallery_2 | borders langs een pad | 1024×768 | 192 kB |

Totaal circa 1,1 MB na optimalisatie (sharp, JPEG q82). **Verbruik:** circa $0,30-0,40
van het budget van $1 (8 beelden op 1024px).

**Daadwerkelijk gebruikt:** 6 van 8. Hero (home), vier dienstbeelden (home en
dienstenpagina), about (Over ons). `gallery_1` en `gallery_2` zijn nog niet
gebruikt: er staat geen galerijsectie in het blueprint voor deze case.

## 3. Integratie in het ontwerp

- D3-items renderen nu ook thema-assets (`block.settings.image_asset`), niet alleen
  Shopify-afbeeldingen. Zonder die tak bleef elk gegenereerd beeld ongebruikt.
- De compositielaag rendert `image_asset` op sectieniveau (hero, over-ons).
- Beeldplan meerpaginig: hero alleen op de homepage, about op de pagina met het
  meeste verhaalgewicht, dienstbeelden bij de diensten op elke pagina.
- Content-fit: diensten met beeld kiezen redactionele rijen; over-ons met beeld
  kiest `image_led` in plaats van een tekstblok zonder media.
- Item met beeld en tekst stapelt op tablet (`max-width: 1100px`), zodat de
  tekstkolom niet naar 193px krimpt.

Beeldarea: home 5 beelden, diensten 15% van de pagina, over ons 10%.

## 4. Pagina-intro's

Drie intro's gegenereerd met de Anthropic-API op basis van de briefing, als
`subheadline`-unit in het contentplan (geen volledige hergeneratie):

- **Diensten:** "Bij Veld & Vorm vormen tuinontwerp, tuinaanleg, beplanting en tuinonderhoud samen één geheel..."
- **FAQ:** "Hieronder vindt u antwoorden op veelgestelde vragen over tuinontwerp, aanleg, beplanting en onderhoud..."
- **Contact:** "Neem contact op met Veld & Vorm voor tuinontwerp, tuinaanleg, beplanting of onderhoud in Utrecht en omgeving..."

Over ons hield zijn eigen intro. Geen intro noemt telefoon of e-mail, en er staat
geen `tel:`- of `mailto:`-link in de uitvoer.

## 5. Wat nog open staat

1. `gallery_1` en `gallery_2` zijn ongebruikt; een kleine galerij op Over ons zou
   ze rechtvaardigen, maar vraagt een blueprint-wijziging.
2. Resolutie is 1024px breed; voor een 1440px hero is dat voldoende maar niet
   scherp op hoge dichtheid. Hoger genereren kan later tegen extra budget.
3. Drie `small_text`-waarschuwingen: de hero-eyebrow staat op 12px.
4. Productieconfiguratie van `FAL_KEY` in Vercel is niet verifieerbaar zonder token.
