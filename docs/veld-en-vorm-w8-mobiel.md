# Veld & Vorm — W8: mobiele compositie, intro's en responsive QC (6 november 2026)

Commit bij deze ronde: zie `git log -1`. Label `w8final`. 987 tests groen.

## 1. Mobiele diensten: oorzaak en oplossing

De diensten stonden op 390px in twee kolommen van **165px** met items tot 229 tekens.
Oorzaak: `d3-asymmetric_grid` zet zes rasterkolommen op desktop en twee op mobiel;
de tekst erfde die twee kolommen.

Oplossing is nu een leesbaarheidsregel, niet een uitzondering:

- onder 700px: elk itemraster (`.d3-items`, USP-rij, kaarten, formulieren, testimonials)
  valt terug naar één kolom, en `grid-column/grid-row`-spans worden gereset;
- 701-1100px: `repeat(auto-fit, minmax(min(100%, 22rem), 1fr))` met `!important`, dus
  geen enkele compositie houdt zijn smalle desktopkolommen op tablet;
- USP-rij en kaartrasters: minimale kolombreedte 240px in plaats van 220px;
- tekstkolommen krijgen `max-width: none` op mobiel, dus geen geforceerde maat.

Gemeten resultaat op 390px: diensten 1 kolom, breedte 350px in plaats van 2x165px.

## 2. Pagina-intro's

De algemene contactzin ("Wilt u kennismaken ... via telefoon of e-mail") kwam uit
`spec.content.contactIntro` en werd als terugval voor élke subpagina gebruikt. Die
terugval is verwijderd. Een paginakop toont nu uitsluitend de eigen `subheadline`
van die pagina uit het contentplan; ontbreekt die, dan blijft alleen de titel staan.

Stand van deze generatie: Over ons heeft een eigen intro, Diensten/FAQ/Contact
hebben titel-only. Contactgegevens worden niet meer genoemd zolang telefoon en
e-mail niet zijn aangeleverd (nieuwe regel in de provenance-laag).

## 3. Responsive Visual QC

Nieuwe keuringen in `lib/qc/visual-qc.ts`, op 390/768/1440 met echte screenshots:

- `narrow_column` — tekstkolom smaller dan 200px bij tekst vanaf 25 tekens (kritiek onder 480px);
- `desktop_columns_on_mobile` — twee of meer kolommen op 390px, geteld via echte
  elementposities (niet via de CSS-string, dat gaf valse treffers bij `minmax()`);
- `small_text` — letters onder 13px;
- `vertical_emptiness` — sectie waarvan de inhoud minder dan 55% vult;
- `button_ratio` — knop die de kolom vrijwel volledig vult.

Bewijs dat de meter nu wél ziet wat jij zag: op de vorige generatie (`w7final`)
meldt hij 4 kritieke smalle kolommen (165px, 191-229 tekens) op de mobiele
dienstenpagina. Op `w8final`: 0 kritiek, 6 waarschuwingen (193px kolommen op tablet
in twee secties).

## 4. Wat nog open staat

- Per-pagina intro's voor Diensten, FAQ en Contact moeten uit een AI-stap in het
  contentplan komen (`page_intro`), niet uit een terugval.
- De 6 tabletwaarschuwingen (193px kolommen) vragen nog een layoutkeuze per sectie.
- Beeld blijft één foto; `<title>` is nog sitebreed gelijk.
