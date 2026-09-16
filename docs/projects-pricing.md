# Projects + Pricing Engine — Silvijn Studio AI (Fase 8)

## Architectuur

```
Lead (qualified) → [Create Project] (expliciete user action)
      → ProjectService.createFromLead()
            ├─ LeadRepository + SalesInteractionRepository  (initiële requirements,
            │    deterministisch uit de laatste kwalificatie — geen AI)
      → Requirements (mens + optionele AI-assistentie)
      → [Calculate Price] → PricingEngine.calculatePriceIndication()   (NOOIT AI)
            ├─ PricingConfiguration (AgencyConfiguration — nu LEEG)
            └─ uitlegbare line items → PriceIndication (met pricingVersion)
      → menselijke goedkeuring (approve/reject) — pas dan bindend
```

De AI start nooit een project, berekent nooit een prijs en zet nooit
approved/in_progress/completed. "Send to Silvijn" is intern escaleren;
klantcommunicatie, offertes en betalingen bestaan niet in Fase 8.

## Project-model

`Project`: id, leadId, name, status, projectType, description, requirements,
estimatedPrice, priceStatus, currency, timeline, notes, timestamps.
Statusovergangen (alleen via expliciete menselijke acties):

```
quotation_pending → price_ready → awaiting_approval → approved → in_progress → ready_for_review → completed
        ↘ cancelled (altijd mogelijk, behalve na completed) ↙
```

Ongeldige sprongen (bijv. quotation_pending → completed) worden geweigerd.
Één actief project per lead; aanmaken alleen bij leadStatus
qualified/interested/contacted.

## Requirements

`ProjectRequirements`: websiteType, numberOfPages, designLevel, responsive,
cms, ecommerce, customFunctionality, integrations, seo, copywriting,
photography, hosting, maintenance, deadline, existingWebsite,
existingBranding, contentAvailable, specialRequirements. Alles nullable:
onbekend = null, NOOIT gokken. AI-assistentie ("AI: requirements voorstellen",
agent `pricing`) vult alléén nog onbekende velden aan en overschrijft nooit
bestaande waarden; 1 gecontroleerde AI-call, limiet
MAX_PRICING_ANALYSES_PER_RUN (default 5).

## Pricing engine

Deterministische pure functie — geen AI-call nodig om te rekenen:

```
BASISPAKET (uit configuratie)
+ EXTRA PAGINA'S (extraPagePrice uit configuratie)
+ ADD-ONS (seo/copywriting/photography/hosting/onderhoud/cms/ecommerce)
= PRIJSINDICATIE (line items met uitleg per regel)
```

Structurele regels (bedragloos): e-commerce → webshop-pakket indien
geconfigureerd; ontbrekende vereiste informatie → MISSING_INFORMATION zonder
bedrag. Bedrijven van grenzen: minimumPrice/maximumPrice/
humanApprovalThreshold → REQUIRES_HUMAN met reden; custom functionaliteit of
integraties → altijd menselijke beoordeling. btw (vatRate) en prijsrange
(priceRangeDeviation) alleen zodra geconfigureerd.

## Pricing configuration

Alle commerciële waarden komen uit `AgencyConfiguration.pricingConfiguration`
(packages, addOns, extraPagePrice, minimum/maximum, thresholds, vatRate,
pricingRules, customProjectRules, discount/payment/revision/maintenance/
hostingRules, pricingVersion). **Nu leeg**: `getPricingConfiguration()`
levert een lege configuratie → elke berekening geeft CONFIGURATION_MISSING
met escalatie — er wordt NOOIT een (fallback-)bedrag verzonnen. De waarden
worden later via de Master Configuration ingevuld; oude indicaties blijven
via pricingVersion herleidbaar.

## Price status

not_calculated · calculating · ready · missing_information ·
configuration_missing · requires_human · approved (mens) · rejected (mens).
READY vereist complete requirements én complete configuratie.

## Human approval

Elke indicatie is gemarkeerd als **PRICE INDICATION / AI CALCULATED** — geen
definitieve offerte. Goedkeuren/afwijzen is een menselijke actie die gelogd
wordt (price_approved/price_rejected). Een AI-berekende indicatie wordt pas
bindend na menselijke goedkeuring; automatisch naar een klant sturen bestaat
niet.

## READY FOR SILVIJN

Automatische escalatie bij: ontbrekende pricing configuration, prijs onder
minimum of boven maximum, boven goedkeuringsdrempel, custom functionaliteit,
onduidelijke/onvolledige requirements. Resultaat: priceStatus requires_human
of configuration_missing + human_escalation-activity met reden.

## Database

Migratie `0005_projects_pricing.sql`: `projects` (FK → leads, status- en
price_status-checks, requirements jsonb) + `price_indications` (FK → projects,
line_items jsonb, pricing_version, alle bedragen numeric(12,2), RLS aan zonder
publiek beleid — server-side only). Elke berekening is een NIEUWE indicatie;
historie wordt nooit overschreven.

## AI vs deterministisch

AI (agent `pricing`, tier balanced, override PRICING_AI_TIER): requirements
interpreteren, ontbrekende informatie identificeren, complexiteit inschatten.
PricingEngine: de échte berekening — deterministisch, versioneerd,
uitlegbaar, volledig werkend zonder Anthropic in mock mode.

## Mock mode

Projecten aanmaken, requirements invullen, AI-voorstel en prijsberekening
werken volledig zonder API-calls. Engine-tests gebruiken een expliciete
TEST-configuratie (TESTDATA) — de app-configuratie blijft leeg.

## Environment variables (namen, zie .env.example)

`PRICING_AI_TIER` · `MAX_PRICING_ANALYSES_PER_RUN` — naast de bestaande AI-variabelen.
