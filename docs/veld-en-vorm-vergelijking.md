# Veld & Vorm vs benchmark — vergelijking met twee assen

**Datum:** 5 november 2026 · **Engine:** Architectuur A, commit `e026f42`
**Methode:** dezelfde meetlat (`npm run visual`) op twee soorten input:

| meting | input | label |
|---|---|---|
| nulmeting | bevroren benchmarkcase (golden hovenier) | `fase0-baseline` |
| benchmark-nu | dezelfde benchmarkcase, huidige engine | `benchmark-now` |
| Veld & Vorm | echte AI-output (specificatie → design plan → contentplan) | `veld-en-vorm` |

Zo is het verschil te splitsen: **nulmeting → benchmark-nu** verandert alleen de
engine (input identiek), **benchmark-nu → Veld & Vorm** verandert alleen de
bedrijfsinformatie en de daaruit gegenereerde content (engine identiek).

## As 1 — Verschil door de designengine (input gelijk)

| criterium | nulmeting | nu | effect |
|---|---|---|---|
| H1 desktop | 42,2px | 96,9px | schaalbaar, fluïde |
| H1 mobiel | 31,7px | 40px | veilige ondergrens |
| typebereik | 2,8× | 6,1× | echte hiërarchie |
| woorden (home) | 128 | 310 | content- en layoutdiepte |
| beelden / placeholders | 0 / 6 | 2 / 0 | beeldpijplijn actief |
| beeldarea | 0% | 4% | zichtbaar, nog steeds laag |
| regellengte buiten 40-90 | 5 | 1 | leesbaarheid |
| contrastfouten (axe) | 8 | 0 | AA gegarandeerd |

Dit is volledig toe te schrijven aan de engine: zelfde bedrijf, zelfde feiten.

## As 2 — Verschil door bedrijfsinformatie en content (engine gelijk)

| criterium | benchmark-nu | Veld & Vorm | oorzaak |
|---|---|---|---|
| H1 per pagina | 96,9px op alle 5 | 76 / 62 / 55px | design plan kiest per pagina een andere hero-variant |
| woorden home | 310 | 447 | rijker bronmateriaal en diepere contentpass |
| woorden over-ons / diensten | 241 / 386 | 413 / 249 | AI verdeelt diepgang anders over pagina's |
| secties home | 4 | 9 | blueprint met meer sectietypes |
| beelden | 2 | 1 | beeldpipeline staat stil (FAL_KEY/tegoed) |
| beeldarea | 4% | 1% | idem |
| regellengte | 51 | 64 | langere AI-alinea's |
| contrastfouten | 0 | 0 | engine, niet de input |

De benchmark oogt consistenter in koppen omdat zijn design plan bevroren is en
één heromvang kent. Veld & Vorm laat zien wat de engine doet met vrije input:
meer secties, meer tekst, maar ook minder uniforme typografie.

## Eerlijk: wat nog niet goed genoeg is

1. **Beeldgebruik.** 1% tot 3% beeldarea en één echte foto. Zonder FAL-tegoed
   blijft dit een tekstsite; dit is de grootste visuele achterstand.
2. **H1-consistentie.** 76 / 62 / 55px tussen pagina's is geen bewuste keuze
   maar een neveneffect van per-pagina hero-varianten. Moet één schaal worden.
3. **Dunne pagina's.** Contact (85 woorden) en FAQ (122 woorden) blijven onder
   wat een premium site vraagt, ondanks een PASS op de keuring.
4. **Per-pagina SEO.** De contentplan-titels bestaan, maar het thema zet ze niet
   in `<title>`; dat hoort via de Shopify Admin bij handover.
5. **G-content wacht op goedkeuring.** Paginakoppen van diensten/contact/FAQ
   zijn als G geclassificeerd; na goedkeuring verschijnt de eigen copy in plaats
   van de paginatitel-fallback.
