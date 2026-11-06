# Opleveringsroute en Shopify-audit (W10, 6 november 2026)

Benchmark: Veld & Vorm. Label `w10final`. 988 tests + 7 nieuwe Admin API-tests,
0 kritieke visuele meldingen, 0 contrastfouten, 0 structurele fouten.

## 1. Wat volledig werkt

| Onderdeel | Bewijs |
|---|---|
| Themabouw (ZIP, 73+ bestanden, secties, templates, settings) | buildtests + theme-check, 0 errors |
| Liquid-preview per pagina (5 pagina's) | gerenderd in Chromium, 1440/768/390 |
| Pagina-eigen SEO-titels en meta-omschrijvingen | uniek per pagina, gecontroleerd in de HTML |
| Canonical, Open Graph, LocalBusiness-structured data | in `meta-tags`-snippet, alleen met bekende gegevens |
| Contactformulier | `{% form 'contact' %}` (Shopify-native, verstuurt naar de winkelmail) |
| Navigatie en mobiel menu | header met nav-blokken, toggle in `theme.js`; in Chromium getest |
| Thema-editor-instellingen | 5 groepen: Kleuren, Typografie, Layout, Bedrijfsgegevens + per sectie blokken |
| Klantisolatie en identiteitscontrole | preflight blokkeert vreemde bedrijfsnaam/e-mail/telefoon/domein |

## 2. Wat gedeeltelijk werkt

**Theme Access-route.** Er is een `SHOPIFY_THEME_ACCESS_TOKEN` in de sandboxomgeving,
maar geen code die hem gebruikt. Pushen gebeurt nu met de Shopify CLI
(`shopify theme push --unpublished`), handmatig. Dat werkt, maar is geen
geautomatiseerde route en is in deze ronde niet uitgevoerd (geen winkel gekoppeld).

**Navigatie.** De header werkt met nav-blokken per template: de klant kan labels en
links in de theme editor aanpassen. Er is nog geen koppeling met een Shopify
linklist (`main-menu`), dus een pagina die later in Shopify wordt aangemaakt komt
niet automatisch in het menu.

**Afbeeldingen in productie.** De pipeline werkt en de bestanden zitten in het thema.
De preview gebruikt inline data-URI's; in Shopify worden het `asset_url`-verwijzingen.
Dat pad is in deze ronde niet in een echte winkel gecontroleerd.

**FAL_KEY.** De code leest `FAL_KEY`; in de sandbox werkt de key (beeld in 11,3 s).
Of hij in Vercel-productie staat is niet vast te stellen: de CLI is daar niet
ingelogd en er is geen token. Zonder de variabele blijft productie placeholders
gebruiken.

## 3. Wat ontbrak en nu is gebouwd

**Admin API-opleveringslaag** (`lib/shopify/admin.ts`, Admin GraphQL 2024-10):

- pagina's aanmaken of bijwerken op handle (idempotent, geen duplicaten);
- het juiste paginatemplate koppelen (`templateSuffix`);
- SEO per pagina als metavelden `global.title_tag` en `global.description_tag`;
- `main-menu` bijwerken met de gegenereerde navigatie;
- thema publiceren, maar uitsluitend met expliciete menselijke bevestiging
  (zonder bevestiging: `PUBLISH_REQUIRES_HUMAN`, geen API-call);
- tokens komen uit de omgeving en verschijnen nooit in foutmeldingen of logs;
- zonder configuratie: `BLOCKED_EXTERNAL_CONFIGURATION`.

**Opleveringsscript** (`scripts/shopify/deliver-site.ts`) met droogloop als default:

```
npx tsx scripts/shopify/deliver-site.ts --from visual-output/w10final/site.json
npx tsx scripts/shopify/deliver-site.ts --from ... --apply
npx tsx scripts/shopify/deliver-site.ts --from ... --apply --publish \
  --theme-id gid://shopify/OnlineStoreTheme/... --confirm-publish "silvijn"
```

De harness schrijft nu `site.json`: merk, vier subpagina's met SEO en vijf
navigatie-items. Droogloop bevestigd: "geen wijzigingen doorgevoerd".

## 4. Wat nog ontbreekt

1. **Echte winkeltest.** Geen Shopify-testwinkel met Admin API-token in deze
   omgeving, dus push, pagina's, menu en publicatie zijn niet live uitgevoerd.
2. **Koppeling naar de database.** Het opleveringsscript leest een exportbestand,
   geen website-record. Aan elkaar knopen kan later zonder de architectuur te wijzigen.
3. **Collecties, producten en blogartikelen** worden niet aangemaakt.
4. **Metavelden voor eigen teksten per sectie** bestaan nog niet; aanpassen gaat via
   de theme editor.
5. **Hero-eyebrow** staat op 12px: drie `small_text`-waarschuwingen, geen fout.

## 5. Wat Silvijn zelf moet doen

1. In Vercel (Production): `FAL_KEY` toevoegen en redeployen.
2. Voor de winkeltest: `SHOPIFY_SHOP_DOMAIN` en `SHOPIFY_ADMIN_ACCESS_TOKEN`
   toevoegen (custom app met `write_content`, `write_online_store_navigation`,
   `write_themes`). Theme Access-tokens werken alleen voor de CLI, niet voor de
   Admin API.
3. Een testwinkel noemen (of bevestigen welke winkel gebruikt mag worden), zodat ik
   de route één keer echt kan doorlopen.
4. Publicatie blijft jouw handeling: het script publiceert alleen met
   `--confirm-publish`.

## 6. Risico's

- **Thema-overschrijving:** `themePublish` maakt één thema actief. Een push naar een
  unpublished thema raakt bestaande thema's niet, maar publiceren wel. Daarom is
  publiceren een expliciete, menselijke stap met thema-id.
- **Admin API-scopes:** zonder `write_content` faalt paginabeheer; dat wordt per
  pagina gerapporteerd, niet stil genegeerd.
- **Navigatie zonder linklist:** menu-aanpassingen in Shopify zelf overschrijven het
  nav-blok in het thema niet; twee bronnen naast elkaar vraagt later een keuze.
- **Beeldresolutie:** 1024px is krap voor 1440px-retina.
- **Ongebruikte beelden:** `gallery_1` en `gallery_2` staan in het thema zonder
  galerijsectie.
