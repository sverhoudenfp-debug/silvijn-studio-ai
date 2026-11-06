# Veld & Vorm — W7: contentafhankelijke compositie (6 november 2026)

Label `w7final` · 985/985 tests · visuele QC 0 kritiek / 0 waarschuwingen · 0 contrastfouten.

## 1. Wat de engine nu anders doet

De compositie werd gekozen uit het Design Plan, ongeacht de werkelijke inhoud.
`lib/websites/content/content-fit.ts` leidt nu per sectie een inhoudsvorm af
(woorden, aantal items, gemiddelde itemlengte, beschikbaar beeld) en toetst de
gekozen layout daaraan. De regels zijn deterministisch en conservatief:

| Situatie | Keuze |
|---|---|
| Beeldvariant zonder bruikbaar beeld | tekstveilige variant (`image_led` → `asymmetric`) |
| Galerij/projecten zonder beeld | sectie vervalt (zou leeg zijn) |
| Minder dan 45 woorden | compacte dichtheid, lijstvariant waar passend |
| Meer dan 220 woorden | ruimere zetting (airy) + lijstvariant |
| 2 diensten in een raster | `editorial_list` |
| 5+ diensten | `editorial_list` |
| 5+ voordelen | `bento` |
| Lege beeldinstellingen | verwijderd uit het template |

Elke gekozen variant wordt gevalideerd tegen de D3-registry (bestaat de variant,
bij genoeg items, en is beeld aanwezig als de variant dat eist). Een ongeldige
keuze kan dus niet meer in een template belanden.

## 2. Bewijs: de vijf pagina's hebben nu verschillende opbouw

| Pagina | Secties en compositie/dichtheid |
|---|---|
| Home | hero · usp-band · services `featured_service`/balanced · process `numbered_editorial`/compact · benefits `editorial_list`/balanced · about `editorial_split`/balanced · faq · cta `full_statement` · contact `split_form` |
| Over ons | page-header · about `statement`/**airy** · process `horizontal_steps`/compact · cta `full_statement` |
| Diensten | page-header · services `asymmetric_grid`/balanced · benefits `editorial_list`/**compact** · cta `split_cta` |
| FAQ | page-header · faq (accordeon) · cta `floating_card`/compact |
| Contact | page-header · contact `editorial_contact`/compact |

Geen twee pagina's delen dezelfde sectiereeks; de dichtheid wisselt per sectie op
basis van het aantal woorden.

## 3. Metingen

| Meting | W6 | W7 |
|---|---|---|
| Kritieke visuele fouten (3 viewports) | 0 | 0 |
| Waarschuwingen visuele QC | 0 | 0 |
| Contrastfouten | 0 | 0 |
| H1 home | 55,2px / 3 regels / 19 tekens | gelijk |
| Buiten scherm | 0 | 0 |
| Dode interne links | 0 | 0 |
| Beeldarea home | 2% | 2% (geen nieuwe beelden) |

## 4. Eerlijk: wat nog niet af is

1. **Beeld:** nog steeds één echt beeld. Zonder fotografie blijft het ontwerp
   onder zijn plafond; dit is een inhoudelijk gat, niet een engine-gat.
2. **Visuele variatie is nu compositorisch, niet typografisch.** De layouts
   verschillen per pagina, maar de typografische trap (koppen, ritme) is nog
   één systeem. Eén extra display-trap per paginatype is de logische volgende
   stap.
3. **AI-inschatting vooraf:** de fit is deterministisch na compositie. Een
   vooraf-inschatting in het plan zelf (hoeveel ruimte vraagt deze sectie) zou
   de eerste keuze al beter maken in plaats van achteraf bijsturen.
4. **Paginatitels** zijn nog identiek; SEO loopt via de Shopify Admin-koppeling.
5. **Niet in een live Shopify-store** getest; wel door de volledige validatie
   en de D3-audit.
