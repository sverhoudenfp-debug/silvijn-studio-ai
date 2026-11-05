# Veld & Vorm — vergelijking en kwaliteitsoordeel (W4, 5 november 2026)

Gemeten met de meetlat (`scripts/visual/run.ts --source veld`), de structuurcontrole
(`scripts/visual/check-site.ts`) en de geometrieprobe (`scripts/visual/probe-layout.ts`).
Label van deze ronde: `w4final`.

## 1. Wat er in deze ronde is veranderd

| # | Wijziging | Bewijs |
|---|---|---|
| 1 | Contactgegevens per case; geen residu van de vorige testcase | `identity_isolation`-check, 14 regressietests |
| 2 | Harde poort op vreemde bedrijfsidentiteit (naam, e-mail, telefoon, domein) | preflight + certificering |
| 3 | Nieuwe designsysteemlaag: vier hero-composities, compacte header, sectieritme | `assets/design-system.css` |
| 4 | Hero met bewuste tekst/beeldverhouding en vaste beeldverhoudingen | 58/42 redactioneel, 62/38 asymmetrisch, band bij klassiek/beeldgericht |
| 5 | Kop nooit meer in een te smalle kolom | 19 tekens per regel, 3 regels (was 11 tekens, 5 regels op tablet) |
| 6 | Merknaam op één regel op mobiel | merklijnen 1 op 390/768/1440 |
| 7 | Elke afbeelding heeft een alt-tekst | structuurcontrole: geen bevindingen |

## 2. Nulmeting, vorige ronde en nu

| Meting | Nulmeting (fase 0) | W3 (voor deze ronde) | W4 (nu) |
|---|---|---|---|
| H1 desktop | 42,2px | 76px (per pagina 76/62/55) | 55,2px home, 54,7-64px subpagina's |
| H1 mobiel | 32px | 34px | 32,5px |
| Regels per H1 (desktop) | 4-5 | 3-4, deels 11 tekens/regel | 3 regels, 19 tekens/regel |
| Contrastfouten | 8 | 0 | 0 |
| Woorden home | 128 | 447 | 447 |
| Pagina's | 1 | 5 | 5 |
| Beeldarea home | 0% | 1-3% | 1% |
| Afbeeldingen zonder alt | n.v.t. | 1 (over-ons) | 0 |
| Buiten scherm (mobiel/desktop) | n.v.t. | 0/0 | 0/0 |
| Interne dode links | n.v.t. | 0 | 0 |

## 3. Benchmarkvergelijking, gesplitst naar oorzaak

De benchmark is de bestaande referentie (Van Dijk Hoveniers) plus de nulmeting van
de engine. Onderscheid dat ertoe doet:

### Verschillen door de **designengine** (generiek, geldt voor elke klant)
- **Typografie:** H1 van 42,2px naar 55,2px op desktop met 19 tekens per regel en
  3 regels; mobiel 32,5px. De kop is groot maar breekt niet meer in losse woorden.
- **Compositie:** vier hero-varianten met vaste verhoudingen in plaats van één
  gecentreerde kolom; per pagina wisselend sectieritme (8 hoogteklassen op home).
- **Contrast:** 8 fouten naar 0, structureel via het OKLCH-systeem.
- **Header:** merknaam op één regel, compacte actie, 66px hoog op alle viewports.

### Verschillen door de **bedrijfsinformatie** (per klant, niet overdraagbaar)
- **Omvang:** 447 woorden op home tegen 128 in de nulmeting; 5 pagina's met
  eigen H1 en eigen inhoud.
- **Branche-inhoud:** diensten, werkwijze, FAQ-paren en contactgegevens van
  Veld & Vorm. Deze rijkdom komt uit de aangeleverde feiten, niet uit de engine.
- **Toon:** de copy volgt de positionering van dit bedrijf; een andere klant levert
  een ander verhaal bij dezelfde vormgeving.

Kort: de engine bepaalt *hoe* het eruitziet, de bedrijfsinformatie bepaalt *hoeveel*
er te zien is. De sprong in contrast, kopmaat en compositie is engine-winst; de
sprong in woorden en pagina's is informatiewinst.

## 4. Wat nog niet goed genoeg is

1. **Beeld:** 1 echt beeld op de hele site, beeldarea 1%. De beeldpipeline staat
   gepauzeerd (opdracht Silvijn), dus de site leunt op abstracte placeholders.
   Zonder echte fotografie blijft het ontwerp onder zijn plafond.
2. **Contactpagina:** 84 woorden. Functioneel, maar dun voor een pagina die
   vertrouwen moet geven.
3. **FAQ:** 223 woorden; de tweekoloms opbouw staat, de inhoudelijke diepte is
   nog beperkt tot de aangeleverde paren.
4. **Paginatitels:** alle vijf pagina's delen dezelfde `<title>`. SEO/meta hoort
   via de Shopify Admin-koppeling (W4-restpunt), niet in het thema.
5. **Themavariatie:** de engine kiest de hero uit het design plan; bij een zwak
   plan valt hij terug op `focused`. Sturing op bedrijfsprofiel kan scherper.
6. **Echte Shopify-rendering:** gemeten op de Liquid-preview, niet in een live
   Shopify-store. De theme push naar unpublished is de volgende verificatiestap.

## 5. Verdict

Technisch groen: 959/959 tests, 0 contrastfouten, 0 structurele fouten, 0 dode
links, geen identiteitslek, deploy `b68033a` succesvol. Visueel is de basis op
orde (typografie, ritme, compositie); het resterende verschil met de benchmark zit
vooral in beeld en contentdiepte, niet meer in de engine.
