import { contentPlanSchema } from "../../lib/websites/content/content-plan";

/**
 * GOLDEN CONTENT (W2) — de hovenierscase als vaste contentpraktijktest.
 *
 * Dit is géén generatoroutput maar de handgeschreven referentie: wat een
 * goede contentpass voor deze klant moet opleveren. De meetlat
 * (content-quality.ts) en de thema-compositie worden ermee getest, zodat
 * "de content is compleet" een controleerbaar feit is en geen indruk.
 *
 * Categorieën: F = bedrijfsfeit uit de specificatie, C = klant levert aan,
 * G = branchetekst zonder bedrijfsclaims (hier goedgekeurd, zoals de studio
 * dat in het dashboard doet).
 */

const F = (path: string, kind: string, text: string, evidence: string[]) => ({
  path,
  kind,
  status: "generated" as const,
  claim: "F" as const,
  text,
  evidence,
  sourceOrigin: "lead" as const,
  instruction: null,
});

const G = (path: string, kind: string, text: string) => ({
  path,
  kind,
  status: "generated" as const,
  claim: "G" as const,
  text,
  evidence: [] as string[],
  sourceOrigin: null,
  instruction: null,
});

export const goldenContentPlan = contentPlanSchema.parse({
  version: 1,
  designPlanId: "golden-design-plan",
  sourceFingerprint: "golden-hovenier-w2",
  approvals: { gContent: { approvedAt: "2026-11-05T18:00:00.000Z", approvedBy: "silvijn@silvijnstudio.com" } },
  pages: [
    {
      key: "home",
      seo: {
        title: "Van Dijk Hoveniers — tuinontwerp, aanleg en onderhoud in Utrecht",
        metaDescription:
          "Hoveniersbedrijf in Utrecht voor tuinontwerp, aanleg en onderhoud. Eén vast team van ontwerp tot de laatste snoeironde.",
      },
      units: [
        F("home/0", "headline", "Een tuin die over tien jaar nog klopt", ["Een tuin die over tien jaar nog klopt"]),
        F("home/0", "subheadline", "Ontwerp, aanleg en onderhoud door één team, zodat je niet tussen partijen hoeft te schakelen.", [
          "Ontwerp, aanleg en onderhoud door één team.",
        ]),
        F("home/0", "cta_label", "Plan een gesprek", ["Plan een gesprek"]),

        F("home/1", "heading", "Wat we voor je tuin doen", ["Tuinontwerp", "Aanleg", "Onderhoud", "Beplanting"]),
        F("home/1", "subheading", "Vier werkzaamheden die in elkaar doorlopen: wat je vandaag laat ontwerpen, wordt morgen aangelegd en daarna bijgehouden.", [
          "Van eerste schets tot de laatste snoeironde.",
        ]),
        F("home/1", "item_title", "Tuinontwerp", ["Tuinontwerp"]),
        F("home/1", "item_body", "Een plan op schaal met beplanting die past bij de grond, het licht en hoe je de tuin echt gebruikt. Je ziet vooraf waar terrassen, borders en looppaden komen.", [
          "Een plan op schaal met beplanting die past bij grond, licht en gebruik.",
        ]),
        F("home/1", "item_title", "Aanleg", ["Aanleg"]),
        F("home/1", "item_body", "Bestrating, schuttingen en beplanting, uitgevoerd door vaste mensen. Dezelfde ploeg die je tuin ontwierp, zet hem ook aan, dus er gaat geen uitleg verloren.", [
          "Bestrating, schuttingen en beplanting, uitgevoerd door vaste mensen.",
        ]),
        F("home/1", "item_title", "Onderhoud", ["Onderhoud"]),
        F("home/1", "item_body", "Vast onderhoud per seizoen, zodat de tuin blijft zoals hij bedoeld is. Snoeien, borders bijhouden en de bestrating netjes, op een ritme dat bij de tuin past.", [
          "Vast onderhoud per seizoen, zodat de tuin blijft zoals hij bedoeld is.",
        ]),
        F("home/1", "item_title", "Beplanting", ["Beplanting"]),
        F("home/1", "item_body", "Sortiment gekozen op bodem en standplaats, met planten die het hier volhouden. Geen rij plaatjes die na een winter weer vervangen moet worden.", [
          "Sortiment gekozen op bodem en standplaats.",
        ]),

        F("home/2", "heading", "Eén aanspreekpunt van schets tot snoeironde", ["Wij zijn een hoveniersbedrijf uit Utrecht met een vast team van vier mensen."]),
        F(
          "home/2",
          "body",
          "We werken met een vast team van vier mensen, dus je weet wie er in je tuin staat. Het ontwerp begint met een opname ter plekke: grond, licht, afwatering en de plekken waar je echt zit. Die keuzes komen terug in het plan op schaal, zodat je vooraf kunt zien wat er gebeurt. Bij de aanleg houden we dezelfde volgorde aan, en na oplevering nemen we het onderhoud over als je dat wilt. Zo blijft de tuin de tuin die je hebt afgesproken.",
          ["Wij zijn een hoveniersbedrijf uit Utrecht met een vast team van vier mensen."]
        ),

        F("home/3", "cta_label", "Neem contact op", ["Plan een gesprek"]),
        F("home/3", "body", "Vertel in een paar regels wat je zoekt en hoe je tuin er nu bij ligt. Dan plannen we een opname in Utrecht of omgeving.", [
          "Vertel kort wat je zoekt.",
        ]),
      ],
    },
    {
      key: "over-ons",
      seo: {
        title: "Over Van Dijk Hoveniers — vast team in Utrecht",
        metaDescription: "Wie er achter Van Dijk Hoveniers zit, hoe we werken en wat je van een samenwerking kunt verwachten.",
      },
      units: [
        F("over-ons/0", "heading", "Een hoveniersbedrijf met vier vaste handen", ["Wij zijn een hoveniersbedrijf uit Utrecht met een vast team van vier mensen."]),
        F(
          "over-ons/0",
          "body",
          "Van Dijk Hoveniers is een hoveniersbedrijf uit Utrecht met een vast team van vier mensen. Dat is bewust klein gehouden: de mensen die je tuin ontwerpen, staan ook bij de aanleg en komen later terug voor het onderhoud. Daardoor hoeft niemand opnieuw uit te leggen wat de bedoeling was.\n\nWe beginnen altijd met een opname in de tuin zelf. Grondsoort, stand van de zon, afwatering en de manier waarop je de tuin gebruikt bepalen meer dan een stijl op een moodboard. Wat we zien, vertalen we naar een plan op schaal met beplanting die past bij de standplaats. Je kunt dat plan rustig nalezen en erop reageren voordat er iets wordt besteld of aangelegd.\n\nBij de uitvoering werken we met dezelfde vaste mensen en met materiaal dat we zelf kennen. Tijdens de aanleg spreken we één aanspreekpunt af, zodat vragen niet via drie verschillende lijnen hoeven te lopen. Na oplevering leggen we vast hoe de tuin onderhouden moet worden en welke seizoenen aandacht vragen. Wie daarna wil dat wij het onderhoud doen, kan dat per seizoen afspreken; wie het zelf wil bijhouden, krijgt de uitleg mee.",
          [
            "Wij zijn een hoveniersbedrijf uit Utrecht met een vast team van vier mensen.",
            "Van eerste schets tot de laatste snoeironde.",
            "Een plan op schaal met beplanting die past bij grond, licht en gebruik.",
          ]
        ),
      ],
    },
    {
      key: "diensten",
      seo: {
        title: "Diensten — tuinontwerp, aanleg, onderhoud en beplanting",
        metaDescription:
          "Wat tuinontwerp, aanleg, onderhoud en beplanting bij Van Dijk Hoveniers inhouden en wanneer je welke dienst nodig hebt.",
      },
      units: [
        F("diensten/0", "heading", "Vier diensten, één doorlopende lijn", ["Tuinontwerp", "Aanleg", "Onderhoud", "Beplanting"]),
        F("diensten/0", "subheading", "Je kunt losse werkzaamheden afnemen, maar de meeste tuinen worden mooier als ontwerp, aanleg en onderhoud bij dezelfde partij blijven.", [
          "Van eerste schets tot de laatste snoeironde.",
        ]),
        F("diensten/0", "item_title", "Tuinontwerp", ["Tuinontwerp"]),
        F(
          "diensten/0",
          "item_body",
          "Bij een ontwerp meten we de tuin in en kijken we hoe de zon loopt, waar water blijft staan en waar je wilt zitten. Dat vertalen we naar een plan op schaal met vaste onderdelen: bestrating, borders, grensafscheiding en de plekken waar je iets wilt bergen. De beplanting kiezen we op bodem en standplaats, niet op hoe hij er in de eerste zomer uitziet.",
          ["Een plan op schaal met beplanting die past bij grond, licht en gebruik."]
        ),
        F("diensten/0", "item_title", "Aanleg", ["Aanleg"]),
        F(
          "diensten/0",
          "item_body",
          "De aanleg volgt het plan, met dezelfde vaste mensen die ook bij de opname waren. We regelen het grondwerk, de bestrating, de schuttingen en het planten in een logische volgorde, zodat je tuin niet onnodig lang een bouwplaats blijft. Aan het eind lopen we samen de tuin door en spreken we af wat er de eerste maanden nodig is.",
          ["Bestrating, schuttingen en beplanting, uitgevoerd door vaste mensen."]
        ),
        F("diensten/0", "item_title", "Onderhoud", ["Onderhoud"]),
        F(
          "diensten/0",
          "item_body",
          "Onderhoud plannen we per seizoen: snoeien wanneer de plant het verdraagt, borders bijhouden voordat het onkruid zaad zet en bestrating netjes houden. Je kunt kiezen voor een vast ritme of voor losse beurten na een drukke periode. Bij de eerste beurt bepalen we samen wat de tuin nodig heeft.",
          ["Vast onderhoud per seizoen, zodat de tuin blijft zoals hij bedoeld is."]
        ),
        F("diensten/0", "item_title", "Beplanting", ["Beplanting"]),
        F(
          "diensten/0",
          "item_body",
          "Soms is er geen nieuw ontwerp nodig, maar moet de beplanting opnieuw worden opgebouwd. We kijken welke planten het hier al goed doen, wat de bodem aankan en hoe lang je bereid bent te wachten tot iets volgroeid is. Daarna leveren en planten we het sortiment en leggen we uit hoe je het de eerste jaren bijhoudt.",
          ["Sortiment gekozen op bodem en standplaats."]
        ),

        F("diensten/1", "item_text", "Eén vaste ploeg die je tuin kent, dus geen wisselende mensen met een nieuwe uitleg.", ["uitgevoerd door vaste mensen."]),
        F("diensten/1", "item_text", "Eigen materiaal en eigen gereedschap, zodat er niet hoeft te worden gewacht op verhuur.", ["Bestrating, schuttingen en beplanting, uitgevoerd door vaste mensen."]),
        F("diensten/1", "item_text", "Onderhoud op een ritme dat bij de tuin past: vaker in het groeiseizoen, rustig in de winter.", ["Vast onderhoud per seizoen, zodat de tuin blijft zoals hij bedoeld is."]),

        F("diensten/2", "cta_label", "Vraag een tuinplan aan", ["Plan een gesprek"]),
        F("diensten/2", "body", "Wil je weten wat er voor jouw tuin nodig is? We komen langs, meten op en vertellen wat we zien voordat er een plan wordt gemaakt.", [
          "Vertel kort wat je zoekt.",
        ]),
      ],
    },
    {
      key: "faq",
      seo: {
        title: "Veelgestelde vragen over tuinontwerp, aanleg en onderhoud",
        metaDescription: "Antwoorden op de vragen die klanten ons het vaakst stellen over ontwerp, aanleg, onderhoud en werkgebied.",
      },
      units: [
        F("faq/0", "faq_question", "Wat kost een tuinontwerp?", ["Plan een gesprek"]),
        G(
          "faq/0",
          "faq_answer",
          "Dat hangt af van de omvang van de tuin en hoeveel detail je wilt vastleggen. Een kleinere stadstuin vraagt ander werk dan een grote tuin met hoogteverschillen. We bespreken tijdens de opname wat er nodig is, zodat je weet waar je aan toe bent voordat we beginnen."
        ),
        F("faq/0", "faq_question", "Werken jullie in heel Utrecht?", ["Wij zijn een hoveniersbedrijf uit Utrecht"]),
        G(
          "faq/0",
          "faq_answer",
          "We werken vanuit Utrecht en komen in de omliggende plaatsen. Bij een tuin verder weg bespreken we vooraf of de reistijd praktisch is. Zo weet je meteen of het traject haalbaar is."
        ),
        F("faq/0", "faq_question", "Hoe lang duurt een aanleg?", ["Dat hangt af van de omvang; na de opname weten we dat."]),
        G(
          "faq/0",
          "faq_answer",
          "De duur volgt uit wat er moet gebeuren: grondwerk en bestrating kosten meer tijd dan alleen beplanten. Na de opname hoor je welke volgorde we aanhouden en wanneer we denken te starten. Bij groter werk spreken we tussenstappen af, zodat je weet wanneer er iemand komt."
        ),

        G("faq/1", "cta_label", "Stel je vraag"),
        G("faq/1", "body", "Staat jouw vraag er niet bij? Stuur hem door, dan beantwoorden we hem persoonlijk en nemen we hem op in deze lijst."),
      ],
    },
    {
      key: "contact",
      seo: {
        title: "Contact — Van Dijk Hoveniers in Utrecht",
        metaDescription: "Neem contact op met Van Dijk Hoveniers voor tuinontwerp, aanleg of onderhoud in Utrecht.",
      },
      units: [
        F("contact/0", "heading", "Vertel wat je van je tuin wilt", ["Vertel kort wat je zoekt."]),
        F(
          "contact/0",
          "subheading",
          "Vul hieronder in hoe je tuin er nu bij ligt en wat je zoekt. We nemen daarna contact op om een opname in Utrecht of omgeving te plannen.",
          ["Vertel kort wat je zoekt."]
        ),
        F("contact/0", "cta_label", "Verstuur bericht", ["Plan een gesprek"]),
        F("contact/0", "microcopy", "Vul je naam, e-mailadres en bericht in. Je gegevens gebruiken we alleen om je vraag te beantwoorden.", [
          "Wij zijn een hoveniersbedrijf uit Utrecht",
        ]),
      ],
    },
  ],
  missingInformation: [
    "Prijzen en tarieven (door de studio vastgesteld, nooit in branchetekst)",
    "Openingstijden en reactietermijn van het bedrijf",
  ],
});

export type GoldenContentPlan = typeof goldenContentPlan;
