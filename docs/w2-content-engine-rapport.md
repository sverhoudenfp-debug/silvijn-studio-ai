# W2 — Content Engine: rapport en vergelijking

Datum: 5 november 2026
Commits: `0840a12` (content engine) + `ff95dc5` (owner-guard)
Architectuur: A (eigen engine) — geen themawijziging, geen nieuwe afbeeldingen, geen fal.ai-tegoed gebruikt.

## Wat er nu staat

De generator vult de vaststaande sectie-architectuur met teksten die per pagina
een eigen inhoudelijke opdracht hebben. Elke tekstunit draagt een claimcategorie:

| categorie | betekenis | regel |
|---|---|---|
| F | bedrijfsfeit | moet bronbewijs hebben, anders blokkerend |
| C | klant levert aan | blijft leeg met expliciete instructie |
| G | branchetekst | geen cijfers, prijzen, garanties, certificeringen, beoordelingen of uitspraken over het eigen bedrijf |

G-tekst verschijnt pas in het thema nadat een mens die in het dashboard heeft
goedgekeurd (`plan.approvals.gContent`). De leveringspoort leest die
goedkeuring; zonder goedkeuring blijft G buiten het gegenereerde thema.

## Meetbare vergelijking (hovenierscase, 5 pagina's)

| pagina | woorden oud (W1) | woorden nieuw (W2) | H1 | contrastfouten |
|---|---|---|---|---|
| home | 130 | 310 | 96,9px | 0 |
| over-ons | 69 | 241 | 96,9px | 0 |
| diensten | 114 | 386 | 96,9px | 0 |
| faq | 67 | 215 | 96,9px | 0 |
| contact | 64 | 88 | 96,9px | 0 |

De contentkeuring over het referentieplan: 1.017 woorden, 41 F-units,
0 C-units, 5 G-units, drie volledig beantwoorde FAQ-vragen, 0 blokkerende
bevindingen, 0 waarschuwingen.

Reproduceerbaar met:

```
npm run visual -- --label w2content      # metrics + screenshots per pagina
npx tsx --test tests/w2-content-engine.test.ts
```

## Wat is aangepast

| bestand | wijziging |
|---|---|
| `lib/websites/content/claims.ts` | F/C/G-model, normalisatie van oude units, blokkades |
| `lib/websites/content/content-quality.ts` | diepgang per pagina, FAQ-paren op volgorde, placeholders, herhaling, CTA-dichtheid |
| `lib/websites/content/page-briefs.ts` | inhoudelijke opdracht per paginatype + zes brancheprofielen |
| `lib/websites/content/content-plan-service.ts` | weigert oplevering bij blokkades; `approveGContent` |
| `lib/websites/theme-zip/blueprint-composition.ts` | diensten leest kop en intro uit het plan |
| `lib/websites/theme-zip/theme-builder.ts` | dienstenkaart zonder beeld wordt tekstkaart, geen grijs vlak |
| `components/projects/content-plan-section.tsx` | F/C/G-badges, keuringssamenvatting, goedkeuringsknop |
| `app/actions/content-plans.ts` | `approveGContentAction` (owner-guard, getypeerde foutroute) |
| `tests/fixtures/golden-content.ts` | referentiecontent hovenierscase |
| `tests/w2-content-engine.test.ts` | 11 regressietests op claims, G-poort, keuring, brancheprofielen |

## Bewijs dat de G-poort werkt

Zonder goedkeuring bevat `templates/page.faq.json` de G-antwoorden niet; met
goedkeuring wel. Dat is een test, geen aanname
(`W2: plan zonder goedgekeurde G-content levert geen G-tekst aan het thema`).

## Wat nog open staat

1. Echte AI-run op de hovenierscase met de nieuwe prompt (tot nu toe de
   referentiecontent als ijkpunt; de AI-prompt is gebouwd en getest op contract).
2. Beeldmateriaal: alleen hero en over-ons hebben een beeld. Dienstenkaarten
   zijn nu tekstkaarten; met eigen FLUX-beelden worden het kaarten met foto.
3. Shopify-paginaobjecten en menu's (W4): de templates bestaan, maar de
   pagina's moeten nog via de Admin API in de winkel worden aangemaakt.
4. Klantbeheer (W5): secties zijn merchant-bewerkbaar, maar er zijn nog geen
   LiquidDoc-blokken en geen vertaalsleutels voor de editor.
