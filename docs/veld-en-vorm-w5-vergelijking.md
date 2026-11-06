# Veld & Vorm — W5 vergelijking en eindcontrole (6 november 2026)

Commit `cb9ff17` · Vercel deploy **success** · 969/969 tests · label `w5final`.

## 1. Contactgegevens en herkomst

| Controle | W4 | W5 |
|---|---|---|
| E-mailadres in de output | `info@veldenvorm.nl` op contact + footer | **geen enkel adres** op alle vijf pagina's |
| Telefoonnummer in de output | `030 123 45 67` (ook `tel:`-link) | **geen enkel nummer** |
| Bron van de gegevens | testbriefing, overgenomen door AI-copy | niet aangeleverd → niet gepubliceerd |
| Poort | alleen identiteitsvergelijking | `contact-provenance`: zinnen met niet-aangeleverde gegevens verdwijnen + laatste poort over alle JSON/Liquid |
| Metadata | idem lek | schoon |

De briefing van Veld & Vorm bevat nu `phone: null` en `email: null`. Ontbrekend
betekent ontbrekend: de contactpagina biedt alleen het formulier, het dashboard
toont "Ontbreekt". Zodra Silvijn echte gegevens aanlevert, verschijnen ze op alle
oppervlakken (home, contact, footer, metadata) vanuit één bron.

## 2. Intro's per paginatype

Elke subpagina begon met dezelfde hero en twee CTA-knoppen. Nu:

| Pagina | Intro | CTA's |
|---|---|---|
| Home | volledige hero met zijbeeld | 2 (primair + secundair) |
| Over ons | paginakop met eigen kop en intro | 1 |
| Diensten | paginakop, diensten centraal | 1 |
| FAQ | rustige paginakop | 1 |
| Contact | praktische paginakop | 1 |

## 3. Layoutbalans en beelden

- **Beeldkader:** de lege strook onder de hero-foto kwam van een specificiteits-
  conflict (`height: auto` won van de beeldregel). Het beeld vult nu het kader:
  gemeten 354×443 in een container van 356×445.
- **Contentmax:** 78rem voor composities, geen halflege rasterkolommen meer bij
  drie items in een driekoloms raster.
- **Header:** CTA van 250px naar 92px (78px op mobiel), merknaam op één regel,
  headerhoogte 66px op alle viewports.

## 4. Contentconsistentie

- Deterministische dedupe van blokteksten binnen een pagina (zelfde USP of zin
  in twee secties → tweede verdwijnt).
- Gemeten op de verse generatie: **0 dubbele h3-teksten** op alle pagina's.
- Woorden: home 413, over-ons 396, diensten 219, faq 203, contact 62. De daling
  ten opzichte van W4 komt volledig uit verwijderde contactzinnen.

## 5. Responsive en toegankelijkheid

| Meting | Waarde |
|---|---|
| H1 home | 55,2px desktop · 39,9px tablet · 32,5px mobiel |
| Regels per H1 | 3, met 19 tekens per regel |
| Merklijnen | 1 op 390/768/1440 |
| Buiten scherm | 0 mobiel, 0 desktop |
| Contrastfouten | 0 op alle pagina's |
| Afbeeldingen zonder alt | 0 |
| Dode interne links | 0 |

## 6. Nog open

1. **Beeld:** 1 echt beeld, 2% beeldarea; pipeline staat gepauzeerd. Grootste
   visuele beperking.
2. **Contactpagina 62 woorden, FAQ 203 woorden:** inhoudelijk dun, wacht op
   questionnaire-antwoorden van de klant.
3. **Paginatitels:** alle vijf pagina's delen dezelfde `<title>`; per-pagina SEO
   hoort via de Shopify Admin-koppeling.
4. **Live Shopify-rendering:** gemeten op de Liquid-preview, nog niet in een
   unpublished theme push.
