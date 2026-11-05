import type { WebsiteBlueprint } from "../blueprint/blueprint";

/**
 * PAGE BRIEFS + BRANCHEPROFIELEN (W2, 2026-11-05).
 *
 * Elke pagina heeft een eigen inhoudelijke FUNCTIE. Zonder die functie
 * schrijft een model op iedere pagina hetzelfde verhaal met een andere kop.
 * Daarom krijgt de contentpass per pagina een expliciete opdracht (wat deze
 * pagina moet doen, welke elementen erin horen, wat er NIET op hoort) en per
 * branche een profiel (doelgroep, toon, invalshoeken, vraagthema's).
 *
 * Alles hier is deterministisch en puur: het stuurt de AI, het beoordeelt
 * niets. De beoordeling zit in content-quality.ts.
 */

export interface PageContentBrief {
  /** Interne rol van de pagina — gebruikt in de prompt en in de QA. */
  role: string;
  /** Eén zin: waar is deze pagina voor. */
  purpose: string;
  /** Verplichte inhoudelijke elementen (menselijk leesbaar, promptvriendelijk). */
  elements: readonly string[];
  /** Wat deze pagina NIET moet doen (voorkomt herhaling tussen pagina's). */
  avoid: readonly string[];
  /** Ondergrens voor tekstuele diepgang in woorden (QA-vloer, geen doel). */
  minWords: number;
}

const HOME: PageContentBrief = {
  role: "home",
  purpose: "In één scherm duidelijk maken wie het bedrijf is, wat het levert en wat de bezoeker nu moet doen.",
  elements: [
    "Positionering in de eerste alinea: wat het bedrijf doet, voor wie en waarmee het zich onderscheidt — zonder superlatieven.",
    "Overzicht van de belangrijkste diensten, elk met een zin die uitlegt wat de klant ervan merkt.",
    "Redenen om voor dit bedrijf te kiezen, gekoppeld aan de dagelijkse praktijk van de klant (geen holle beloftes).",
    "Werkwijze in stappen: van eerste contact tot oplevering, met wat de klant zelf moet doen.",
    "Vertrouwensinformatie die echt bekend is (werkgebied, aanspreekpunt, manier van werken).",
    "Eén duidelijke vervolgstap, consistent met het conversiedoel.",
  ],
  avoid: [
    "Het volledige over-ons-verhaal herhalen.",
    "Alle diensten uitputtend beschrijven (dat doet de dienstenpagina).",
    "Na iedere sectie opnieuw om contact vragen.",
  ],
  minWords: 220,
};

const ABOUT: PageContentBrief = {
  role: "over-ons",
  purpose: "De bezoeker het gevoel geven dat er echte mensen achter het bedrijf staan en dat de werkwijze past.",
  elements: [
    "Een doorlopend verhaal over het bedrijf: ontstaan, manier van werken en wat het bedrijf belangrijk vindt.",
    "Missie of visie wanneer die uit de bronnen volgt; anders concreet gedrag beschrijven in plaats van een slogan.",
    "Wie de klant tegenover zich krijgt: rollen en aanspreekpunten voor zover bekend.",
    "Hoe het bedrijf met verwachtingen, planning en afstemming omgaat.",
    "Wat de klant van de samenwerking mag verwachten, zonder garanties of cijfers te verzinnen.",
  ],
  avoid: [
    "De dienstenlijst nogmaals opsommen.",
    "De homepage-introductie herhalen.",
    "Algemene marketingzinnen over passie en vakmanschap zonder concreet voorbeeld.",
  ],
  minWords: 170,
};

const SERVICES: PageContentBrief = {
  role: "diensten",
  purpose: "Per dienst uitleggen wat het inhoudt, voor wie het bedoeld is en wat de klant ervan merkt.",
  elements: [
    "Korte introductie die de samenhang van het aanbod uitlegt.",
    "Per dienst een eigen alinea: wat het is, wanneer het nodig is en hoe het in de praktijk verloopt.",
    "Voordelen of mogelijkheden die bij de dienst horen (materiaal, fasering, seizoen), zonder beloftes.",
    "Een logische volgende stap voor wie een dienst wil.",
  ],
  avoid: [
    "Dezelfde dienstomschrijving als op de homepage gebruiken.",
    "Alle diensten in één lange alinea proppen.",
    "Prijzen of levertijden noemen die niet in de bronnen staan.",
  ],
  minWords: 190,
};

const FAQ: PageContentBrief = {
  role: "faq",
  purpose: "Echte vragen van klanten volledig beantwoorden, zodat de bezoeker zonder navragen verder kan.",
  elements: [
    "Vragen die klanten in deze branche echt stellen (prijs, doorlooptijd, werkgebied, onderhoud, afspraken).",
    "Een volledig antwoord per vraag: twee tot vier zinnen, concreet, in dezelfde toon als de site.",
    "Antwoorden die verwijzen naar wat het bedrijf doet zonder nieuwe feiten te claimen.",
    "Geen enkele lege of open accordion: elke vraag heeft een antwoord.",
  ],
  avoid: [
    "Vragen die al in een andere FAQ-sectie beantwoord zijn.",
    "Antwoorden die alleen uit een doorverwijzing bestaan.",
    "Verzonnen prijzen, levertijden of garanties.",
  ],
  minWords: 160,
};

const CONTACT: PageContentBrief = {
  role: "contact",
  purpose: "De bezoeker zonder twijfel een bericht laten sturen.",
  elements: [
    "Korte introductie: wat er gebeurt na het versturen van het formulier en binnen welke termijn het bedrijf reageert (voor zover bekend).",
    "Contactgegevens die echt bekend zijn.",
    "Werkgebied of vestigingsplaats, zodat de bezoeker weet of het bedrijf passend is.",
  ],
  avoid: [
    "Verkoopteksten of herhaling van de homepage.",
    "Verzonnen openingstijden of reactietermijnen.",
    "Opvulsecties die niets toevoegen aan het contactmoment.",
  ],
  minWords: 40,
};

const GENERIC: PageContentBrief = {
  role: "pagina",
  purpose: "Deze pagina informeert over één onderwerp binnen de site.",
  elements: [
    "Een inleiding die het onderwerp van de pagina afbakent.",
    "Kopjes met uitleg per deelonderwerp.",
    "Een concrete volgende stap die logisch bij het onderwerp past.",
  ],
  avoid: ["Herhaling van de homepage-introductie."],
  minWords: 120,
};

const BY_KEY: Record<string, PageContentBrief> = {
  home: HOME,
  index: HOME,
  "over-ons": ABOUT,
  over: ABOUT,
  about: ABOUT,
  "over-het-bedrijf": ABOUT,
  diensten: SERVICES,
  services: SERVICES,
  "onze-diensten": SERVICES,
  faq: FAQ,
  "veelgestelde-vragen": FAQ,
  contact: CONTACT,
  contactpagina: CONTACT,
};

/** Brief voor een paginasleutel (valt terug op titel, dan op generiek). */
export function pageBriefFor(key: string, title?: string | null): PageContentBrief {
  const normalized = key.toLowerCase().trim();
  if (BY_KEY[normalized]) return BY_KEY[normalized];
  if (title) {
    const byTitle = BY_KEY[title.toLowerCase().trim()];
    if (byTitle) return byTitle;
  }
  for (const [needle, brief] of Object.entries(BY_KEY)) {
    if (normalized.includes(needle)) return brief;
  }
  return GENERIC;
}

// ---------------------------------------------------------------------------
// Brancheprofielen
// ---------------------------------------------------------------------------

export interface IndustryProfile {
  key: string;
  label: string;
  /** Woorden die de branche typeren (gebruikt in prompt én in de kwaliteitscheck). */
  vocabulary: readonly string[];
  audience: string;
  tone: string;
  /** Invalshoeken die in deze branche echt spelen. */
  angles: readonly string[];
  /** Vraagthema's die klanten in deze branche stellen. */
  faqThemes: readonly string[];
  /** Wat in deze branche bijna altijd verzonnen wordt — expliciet verboden. */
  temptations: readonly string[];
}

export const INDUSTRY_PROFILES: readonly IndustryProfile[] = [
  {
    key: "hovenier",
    label: "hoveniersbedrijf / groen",
    vocabulary: ["tuin", "beplanting", "onderhoud", "seizoen", "grond", "bestrating", "snoeien", "aanleg"],
    audience: "huiseigenaren en soms kleine bedrijven met een tuin die onderhouden of opnieuw ingericht moet worden",
    tone: "nuchter en vakmatig, met aandacht voor seizoen en onderhoud op lange termijn",
    angles: [
      "de tuin als plek die met de seizoenen verandert",
      "ontwerp en uitvoering in één hand, zodat er niets tussen wal en schip valt",
      "onderhoud na de aanleg, zodat de tuin blijft zoals hij bedoeld is",
    ],
    faqThemes: ["kosten en offerte", "doorlooptijd van aanleg", "werkgebied", "onderhoudsfrequentie", "seizoen en planning"],
    temptations: ["aantal aangelegde tuinen", "jaren ervaring", "certificeringen", "garanties op beplanting"],
  },
  {
    key: "horeca",
    label: "restaurant / horeca",
    vocabulary: ["gerechten", "menu", "seizoen", "reserveren", "keuken", "wijn", "producten", "gasten"],
    audience: "gasten die een plek zoeken om te eten, te vieren of te vergaderen",
    tone: "warm en gastvrij, concreet over wat er op tafel komt",
    angles: [
      "het menu en de herkomst van producten",
      "de sfeer en het ritme van een avond",
      "reserveren, groepen en dieetwensen",
    ],
    faqThemes: ["reserveren", "groepen", "dieetwensen en allergieën", "parkeren", "menuwijzigingen"],
    temptations: ["aantal gasten per jaar", "prijzen van gerechten", "awards en vermeldingen", "chef-ervaring"],
  },
  {
    key: "architect",
    label: "architectuur- of ontwerpbureau",
    vocabulary: ["ontwerp", "schets", "vergunning", "bouwkundig", "ruimte", "materiaal", "project", "realisatie"],
    audience: "particulieren en opdrachtgevers met een bouw- of verbouwvraag",
    tone: "precies en beschouwend, met nadruk op keuzes en proces",
    angles: [
      "van eerste schets tot vergunning en uitvoering",
      "hoe keuzes in materiaal en licht het dagelijks gebruik bepalen",
      "samenwerken met aannemer en adviseurs",
    ],
    faqThemes: ["kosten en honorarium", "vergunningen", "doorlooptijd", "proces en fasen", "wijzigingen tijdens de bouw"],
    temptations: ["aantal opgeleverde projecten", "publicaties", "prijzen", "vierkante meters"],
  },
  {
    key: "bouw",
    label: "bouw- of klusbedrijf",
    vocabulary: ["verbouw", "renovatie", "ruwbouw", "afbouw", "constructie", "oplevering", "planning", "materiaal"],
    audience: "huiseigenaren en opdrachtgevers met een verbouwing of nieuwbouw",
    tone: "direct en praktisch, met oog voor planning en overlast",
    angles: [
      "heldere afspraken over planning, meerwerk en oplevering",
      "één aanspreekpunt tijdens de hele klus",
      "wat er vooraf moet worden beslist",
    ],
    faqThemes: ["offertes en meerwerk", "planning en overlast", "vergunningen", "oplevering en garantie", "werkgebied"],
    temptations: ["aantal projecten", "jaren ervaring", "certificeringen", "vaste prijzen"],
  },
  {
    key: "zorg",
    label: "zorg- of behandelpraktijk",
    vocabulary: ["behandeling", "intake", "klachten", "verwijzing", "afspraak", "herstel", "begeleiding"],
    audience: "mensen die zorg of begeleiding zoeken en eerst willen weten wat hen te wachten staat",
    tone: "rustig en helder, zonder medische beloftes",
    angles: ["wat een intake inhoudt", "hoe een traject verloopt", "wat iemand zelf kan voorbereiden"],
    faqThemes: ["verwijzing en vergoeding", "wachtlijst", "privacy", "afspraken wijzigen", "eerste bezoek"],
    temptations: ["succespercentages", "aantal patiënten", "keurmerken", "wachtlijstduur"],
  },
  {
    key: "zakelijk",
    label: "zakelijke dienstverlening",
    vocabulary: ["advies", "traject", "opdrachtgever", "resultaat", "samenwerking", "plan", "uitvoering"],
    audience: "bedrijven die een specialist inschakelen voor een concreet vraagstuk",
    tone: "zakelijk en concreet, zonder jargon",
    angles: ["hoe een traject start en verloopt", "wat de opdrachtgever zelf doet", "wanneer het resultaat goed genoeg is"],
    faqThemes: ["tarieven en offerte", "doorlooptijd", "samenwerking", "vertrouwelijkheid", "opzegging"],
    temptations: ["aantal klanten", "omzetcijfers", "certificeringen", "succesverhalen met cijfers"],
  },
];

export const GENERIC_INDUSTRY: IndustryProfile = {
  key: "algemeen",
  label: "algemeen bedrijf",
  vocabulary: ["dienst", "aanpak", "klant", "werk", "afspraak", "kwaliteit"],
  audience: "klanten die een betrouwbare uitvoerder zoeken",
  tone: "helder en professioneel, zonder holle marketingtaal",
  angles: ["wat het bedrijf doet en voor wie", "hoe een opdracht verloopt", "wat de klant mag verwachten"],
  faqThemes: ["offerte en prijs", "doorlooptijd", "werkgebied", "afspraken", "nazorg"],
  temptations: ["jaren ervaring", "aantallen klanten", "certificeringen", "garanties"],
};

const INDUSTRY_MATCHERS: readonly { key: string; pattern: RegExp }[] = [
  { key: "hovenier", pattern: /hovenier|tuin|groen|landschap|boomverzorging|beplanting/i },
  { key: "horeca", pattern: /restaurant|horeca|brasserie|caf[eé]|bistro|eetcaf[eé]|bar\b|keuken/i },
  { key: "architect", pattern: /architect|ontwerpbureau|interieur|stedenbouw|bouwkunde/i },
  { key: "bouw", pattern: /bouw|aannemer|klus|renovatie|verbouw|installatie|schildersbedrijf/i },
  { key: "zorg", pattern: /zorg|praktijk|fysio|psycho|kliniek|begeleiding|therapie/i },
  { key: "zakelijk", pattern: /advies|consult|bureau|marketing|accountant|juridisch|notaris/i },
];

/** Detecteert het brancheprofiel uit vrije tekst (branche, beschrijving, diensten). */
export function detectIndustryProfile(input: {
  industry?: string | null;
  description?: string | null;
  serviceTitles?: readonly string[];
}): IndustryProfile {
  const haystack = [input.industry ?? "", input.description ?? "", ...(input.serviceTitles ?? [])].join(" ");
  for (const matcher of INDUSTRY_MATCHERS) {
    if (matcher.pattern.test(haystack)) {
      const profile = INDUSTRY_PROFILES.find((entry) => entry.key === matcher.key);
      if (profile) return profile;
    }
  }
  return GENERIC_INDUSTRY;
}

// ---------------------------------------------------------------------------
// Promptregels
// ---------------------------------------------------------------------------

/** Per pagina de inhoudelijke opdracht, klaar voor de prompt. */
export function buildPageBriefLines(blueprint: WebsiteBlueprint): string[] {
  const lines: string[] = ["PAGINA-OPDRACHTEN (iedere pagina heeft een eigen functie — herhaal geen tekst tussen pagina's):"];
  for (const page of blueprint.pages) {
    const brief = pageBriefFor(page.key, page.title);
    lines.push(
      `OPDRACHT ${page.key} — rol: ${brief.role}. Doel: ${brief.purpose}`,
      `  Verplicht aanwezig: ${brief.elements.join(" | ")}`,
      `  Vermijden: ${brief.avoid.join(" | ")}`,
      `  Diepgang: minimaal ${brief.minWords} woorden aan lopende tekst op deze pagina (ondergrens, geen doel op zich).`
    );
  }
  return lines;
}

/** Brancheprofiel als promptregels. */
export function buildIndustryProfileLines(profile: IndustryProfile): string[] {
  return [
    `BRANCHEPROFIEL: ${profile.label}`,
    `Doelgroep: ${profile.audience}`,
    `Toon: ${profile.tone}`,
    `Invalshoeken die in deze branche spelen: ${profile.angles.join(" | ")}`,
    `Vraagthema's voor de FAQ: ${profile.faqThemes.join(" | ")}`,
    `Verleidingen die je moet weerstaan (nooit invullen zonder bron): ${profile.temptations.join(" | ")}`,
    `Branchewoordenschat (gebruik waar passend, niet als buzzwords): ${profile.vocabulary.join(", ")}`,
  ];
}
