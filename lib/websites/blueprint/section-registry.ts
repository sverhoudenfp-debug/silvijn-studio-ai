/**
 * SECTION-REGISTRY (Fase A+B, 2026-09-19) — de gesloten, canonieke catalogus
 * van blueprint-secties voor de machine-uitvoerbare Website Blueprint v2.
 *
 * ARCHITECTUUR: één centrale registry is de enige bron van waarheid voor:
 * - de Zod-validatie van blueprint-sectie-instanties (lib/websites/blueprint/blueprint.ts);
 * - het AI-JSON-contract in de designplanning-prompt (buildBlueprintSectionContract);
 * - de LATERE deterministische uitvoering door de Shopify theme-builder
 *   (elke entry beschrijft layouts/blocks/mediasloten zodanig dat een
 *   blueprint-instantie rechtstreeks naar een theme-sectie-preset vertaalbaar
 *   is — de compositie zelf bouwen we in een latere fase, NIET nu).
 *
 * HARD REGELS:
 * - GESLOTEN catalogus: de AI kiest uitsluitend uit deze types/layouts/blocks;
 *   elke afwijking faalt de Zod-validatie. Nieuwe sectietypes = één entry
 *   hier (plus eventueel een renderer in de theme-builder, later).
 * - De registry bevat GEEN ontwerp, content of bedrijfslogica van externe
 *   referentiethema's (Horizon/Bluestone zijn uitsluitend technische
 *   inspiratie voor composable sections/blocks — niets overgenomen).
 * - Header en footer zijn bewust GEEN blueprint-secties: het zijn
 *   layout-onderdelen die de theme-builder altijd levert.
 */

export const BLUEPRINT_SECTION_TYPES = [
  "hero",
  "usp_band",
  "stats",
  "services",
  "about",
  "process",
  "gallery",
  "projects",
  "testimonials",
  "team",
  "benefits",
  "faq",
  "rates",
  "newsletter",
  "booking",
  "cta",
  "contact",
  "rich_text",
] as const;

export type BlueprintSectionType = (typeof BLUEPRINT_SECTION_TYPES)[number];

export const BLUEPRINT_BACKGROUNDS = ["default", "surface", "accent_band", "image"] as const;
export type BlueprintBackground = (typeof BLUEPRINT_BACKGROUNDS)[number];

export const BLUEPRINT_MOTION = ["none", "fade_up", "stagger"] as const;
export type BlueprintMotion = (typeof BLUEPRINT_MOTION)[number];

export const BLUEPRINT_MEDIA_ROLES = ["image", "image_background"] as const;
export type BlueprintMediaRole = (typeof BLUEPRINT_MEDIA_ROLES)[number];

export const BLUEPRINT_MEDIA_RATIOS = ["wide", "landscape_4_3", "square", "portrait_3_4", "tall"] as const;
export type BlueprintMediaRatio = (typeof BLUEPRINT_MEDIA_RATIOS)[number];

export interface BlueprintLayoutDefinition {
  /** Machine-key (snake_case) — later de theme-preset-key. */
  key: string;
  /** Korte NL-omschrijving voor het AI-contract. */
  description: string;
}

export interface BlueprintBlockDefinition {
  /** Machine-key (snake_case) van het bloktype binnen deze sectie. */
  key: string;
  /** Korte NL-omschrijving voor het AI-contract. */
  description: string;
  /** Minimaal aantal blokken (alleen relevant als requiredKind). */
  min: number;
  /** Maximaal aantal blokken van dit type. */
  max: number;
  /** true = minimaal `min` blokken van dit type verplicht in elke instantie. */
  requiredKind: boolean;
}

export interface BlueprintSectionDefinition {
  type: BlueprintSectionType;
  /** Nederlands label (mens-leesbaar, voor UI en logs). */
  label: string;
  /** Doel van de sectie — voor het AI-contract. */
  purpose: string;
  /** Beschikbare layoutvarianten (minimaal 1; key = later theme-preset). */
  layouts: BlueprintLayoutDefinition[];
  /** Standaardlayout bij geen expliciete keuze (moet in layouts voorkomen). */
  defaultLayout: string;
  /** Toegestane bloktypes binnen deze sectie (leeg = geen blokken). */
  blocks: BlueprintBlockDefinition[];
  /** Of een CTA-configuratie op instantieniveau ondersteund is. */
  supportsCta: boolean;
  /** Toegestane media-rollen voor deze sectie. */
  mediaRoles: BlueprintMediaRole[];
  /** Korte NL-compositiehint voor het AI-contract. */
  compositionHint: string;
}

function layout(key: string, description: string): BlueprintLayoutDefinition {
  return { key, description };
}

export const BLUEPRINT_SECTION_REGISTRY: Record<BlueprintSectionType, BlueprintSectionDefinition> = {
  hero: {
    type: "hero",
    label: "Hero",
    purpose: "Bovenaan de homepage: primaire boodschap, positiebepaling en de belangrijkste CTA.",
    layouts: [
      layout("split", "Tekst links, beeld/media rechts — evenwichtig en informatief."),
      layout("centered", "Gecentreerde boodschap op volle breedte — rustig en zelfverzekerd."),
      layout("focused", "Compacte, gefocuste boodschap met veel witruimte — directief."),
      layout("band", "Lage, brede band met korte claim — snel en zakelijk."),
      layout("minimal", "Zeer sober: alleen kernzin en CTA — stil."),
    ],
    defaultLayout: "split",
    blocks: [],
    supportsCta: true,
    mediaRoles: ["image", "image_background"],
    compositionHint: "Altijd als EERSTE sectie van de homepage; maximaal één per pagina.",
  },
  usp_band: {
    type: "usp_band",
    label: "USP-band",
    purpose: "Compacte rij met unieke verkoopargumenten — direct vertrouwen wekken onder de hero.",
    layouts: [
      layout("row", "Horizontale rij labels — smal en scanbaar."),
      layout("grid", "Tegelgrid met korte toelichting per USP."),
    ],
    defaultLayout: "row",
    blocks: [{ key: "usp", description: "Eén verkoopargument: korte label + optionele toelichting (hint).", min: 2, max: 6, requiredKind: true }],
    supportsCta: false,
    mediaRoles: [],
    compositionHint: "Alleen USP's die uit echte input volgen (requirements/questionnaire/lead-notities); anders niet plannen.",
  },
  stats: {
    type: "stats",
    label: "Statistiekenrij",
    purpose: "Genummerde bedrijfsfeiten als sociale bewijskracht (aantal opdrachten, jaren ervaring, waardering).",
    layouts: [
      layout("row", "Rij grote cijfers met label eronder."),
      layout("grid", "Tegels met cijfer + korte toelichting."),
    ],
    defaultLayout: "row",
    blocks: [{ key: "stat", description: "Eén statistiek: label + waarde — ALLEEN uit echte input.", min: 2, max: 4, requiredKind: true }],
    supportsCta: false,
    mediaRoles: [],
    compositionHint: "NOOIT cijfers verzinnen; ontbreken echte cijfers, plan deze sectie dan niet.",
  },
  services: {
    type: "services",
    label: "Diensten",
    purpose: "Het aanbod van het bedrijf — per dienst een blok met titel en korte omschrijving.",
    layouts: [
      layout("grid", "Responsief tegelgrid (2-3 per rij)."),
      layout("cards", "Kaarten met ruimte voor beeld boven de tekst."),
      layout("alternating", "Afwisselend links/rechts per dienst — rustiger ritme."),
      layout("list", "Compacte lijst met titel + één regel tekst."),
    ],
    defaultLayout: "grid",
    blocks: [{ key: "service", description: "Eén dienst: korte titel (hint) + optionele toelichting.", min: 2, max: 8, requiredKind: true }],
    supportsCta: true,
    mediaRoles: ["image"],
    compositionHint: "Aantal dienstblokken volgt het echte aanbod uit de input — nooit opvullen om het grid vol te maken.",
  },
  about: {
    type: "about",
    label: "Over het bedrijf",
    purpose: "Verhaal en positioning van het bedrijf, met optioneel portret- of sfeerbeeld.",
    layouts: [
      layout("split", "Tekst + beeld naast elkaar."),
      layout("story", "Breed tekstblok, vertellend."),
      layout("quote", "Kernzin als grote quote met korte intro."),
      layout("timeline", "Mijlpalen — alleen met echte jaartallen."),
    ],
    defaultLayout: "split",
    blocks: [],
    supportsCta: false,
    mediaRoles: ["image"],
    compositionHint: "Optioneel per website; alleen als er echt verhaalmateriaal is.",
  },
  process: {
    type: "process",
    label: "Werkwijze",
    purpose: "Stappen van de werkwijze/aanpak — verwachtingen scheppen en expertise tonen.",
    layouts: [
      layout("steps", "Verticale stappen met nummering."),
      layout("numbered_row", "Horizontale rij genummerde stappen (3-5)."),
    ],
    defaultLayout: "steps",
    blocks: [{ key: "step", description: "Eén werkwijzestap: korte titel (hint) + optionele toelichting.", min: 2, max: 6, requiredKind: true }],
    supportsCta: false,
    mediaRoles: [],
    compositionHint: "Sterk voor dienstverleners; stappen moeten uit echte input volgen.",
  },
  gallery: {
    type: "gallery",
    label: "Galerij",
    purpose: "Beeldimpressie (werk, sfeer, locatie) — beeldsloten die de merchant zelf vult.",
    layouts: [
      layout("grid", "Responsief beeldgrid."),
      layout("full_width", "Grote beelden op volle breedte."),
    ],
    defaultLayout: "grid",
    blocks: [{ key: "image", description: "Eén beeldslot: optionele alt/caption-hint.", min: 2, max: 8, requiredKind: true }],
    supportsCta: false,
    mediaRoles: ["image"],
    compositionHint: "Beeldsloten blijven leeg voor de merchant (image_picker); verzin nooit foto's.",
  },
  projects: {
    type: "projects",
    label: "Projecten/portfolio",
    purpose: "Concrete opdrachten of projectcases met titel en korte omschrijving.",
    layouts: [
      layout("grid", "Portfolio-tegelgrid."),
      layout("feature_row", "Eén uitgelicht project + rij kleinere projecten."),
    ],
    defaultLayout: "grid",
    blocks: [{ key: "project", description: "Eén project: korte titel (hint) + optionele omschrijving.", min: 2, max: 6, requiredKind: true }],
    supportsCta: true,
    mediaRoles: ["image"],
    compositionHint: "Alleen plannen als er echte projecten/cases bekend zijn; anders weglaten (geen fabricatie).",
  },
  testimonials: {
    type: "testimonials",
    label: "Klantuitingen",
    purpose: "Echte klantquotes als sociale bewijskracht.",
    layouts: [
      layout("band", "Band met uitgelichte quote(s)."),
      layout("carousel", "Rotatie van quotes."),
      layout("grid", "Grid van quotes."),
    ],
    defaultLayout: "band",
    blocks: [{ key: "testimonial", description: "Eén echte klantuitspraak (quote-hint) — auteur ALLEEN als die echt bekend is.", min: 1, max: 5, requiredKind: true }],
    supportsCta: false,
    mediaRoles: [],
    compositionHint: "NOOIT reviews of namen verzinnen; ontbreken echte uitspraken, dan deze sectie niet plannen.",
  },
  team: {
    type: "team",
    label: "Team",
    purpose: "Medewerkers/deskundigen met naam, rol en optioneel portretslot.",
    layouts: [
      layout("grid", "Portretgrid met naam + rol."),
      layout("row", "Compacte rij (naam + rol)."),
    ],
    defaultLayout: "grid",
    blocks: [{ key: "member", description: "Eén medewerker: naam + rol (hint) — ALLEEN als beide echt bekend zijn.", min: 1, max: 6, requiredKind: true }],
    supportsCta: false,
    mediaRoles: ["image"],
    compositionHint: "NOOIT medewerkers verzinnen; ontbreekt echte teaminformatie, dan niet plannen.",
  },
  benefits: {
    type: "benefits",
    label: "Voordelen",
    purpose: "Waarom klanten voor dit bedrijf kiezen — voordelen van de dienstverlening.",
    layouts: [
      layout("grid", "Tegelgrid met korte voordelen."),
      layout("checklist", "Afgevinkte lijst — compact en scanbaar."),
      layout("split", "Introtekst + voordelenlijst naast elkaar."),
    ],
    defaultLayout: "grid",
    blocks: [{ key: "benefit", description: "Eén voordeel: korte zin (hint).", min: 2, max: 6, requiredKind: true }],
    supportsCta: false,
    mediaRoles: [],
    compositionHint: "Voordelen moeten uit echte input volgen (vraag-aanleiding, questionnaire).",
  },
  faq: {
    type: "faq",
    label: "Veelgestelde vragen",
    purpose: "Antwoorden op terugkerende klantvragen — twijfel wegnemen en SEO-ruimte.",
    layouts: [
      layout("accordion", "Uitklapbaar per vraag (standaard dicht)."),
      layout("list", "Vraag + antwoord direct onder elkaar."),
    ],
    defaultLayout: "accordion",
    blocks: [{ key: "faq", description: "Eén vraag-en-antwoordpaar (hints) — antwoorden verzinnen NOOIT feiten.", min: 2, max: 8, requiredKind: true }],
    supportsCta: false,
    mediaRoles: [],
    compositionHint: "Alleen plannen bij echte, algemene branche-/bedrijfsvragen die uit de input volgen.",
  },
  rates: {
    type: "rates",
    label: "Tarieven",
    purpose: "Transparante tarieventabel of -kaarten — ALLEEN met echte, vermelde tarieven.",
    layouts: [
      layout("table", "Tabel met dienst + tarief."),
      layout("cards", "Kaart per dienst met tarief."),
    ],
    defaultLayout: "table",
    blocks: [{ key: "rate_item", description: "Eén tariefitem: dienst (hint) + tarief — ALLEEN als het tarief echt bekend is.", min: 1, max: 8, requiredKind: true }],
    supportsCta: false,
    mediaRoles: [],
    compositionHint: "NOOIT prijzen of ranges verzinnen; ontbreken echte tarieven, dan NIET plannen.",
  },
  newsletter: {
    type: "newsletter",
    label: "Nieuwsbrief-aanmelding",
    purpose: "E-mailaanmelding voor nieuws/updates — eigen kanaal opbouwen.",
    layouts: [
      layout("band", "Compacte band met veld + knop."),
      layout("split", "Uitleg + aanmeldveld naast elkaar."),
    ],
    defaultLayout: "band",
    blocks: [],
    supportsCta: false,
    mediaRoles: [],
    compositionHint: "Alleen plannen als een nieuwsbrief expliciet gewenst is (requirements/questionnaire).",
  },
  booking: {
    type: "booking",
    label: "Afspraak/boeking-uitnodiging",
    purpose: "Branche-specifieke conversiesectie: direct een afspraak of boeking aanvragen.",
    layouts: [
      layout("band", "Volledige brede uitnodiging met knop."),
      layout("split", "Uitleg + knop naast elkaar."),
    ],
    defaultLayout: "band",
    blocks: [],
    supportsCta: true,
    mediaRoles: [],
    compositionHint: "Sterk voor afspraakgebonden branches (salon, praktijk, dienst op locatie); CTA-label uit echte input.",
  },
  cta: {
    type: "cta",
    label: "CTA-sectie",
    purpose: "Zelfstandige conversiesectie tussen contentblokken — bezoekers op het juiste moment activeren.",
    layouts: [
      layout("band", "Volledige brede band met grote knop."),
      layout("split", "Boodschap + knop naast elkaar."),
      layout("closing", "Afsluitende CTA onderaan een pagina."),
    ],
    defaultLayout: "band",
    blocks: [],
    supportsCta: true,
    mediaRoles: [],
    compositionHint: "CTA-configuratie (label + doel) verplicht op elke cta-instantie; maximaal 2 cta-secties per pagina.",
  },
  contact: {
    type: "contact",
    label: "Contact",
    purpose: "Echte contactgegevens en (indien gepland) contactformulier — de harde conversieplek.",
    layouts: [
      layout("split", "Gegevens + formulier naast elkaar."),
      layout("full", "Volledige sectie met gegevens en formulier."),
      layout("minimal", "Alleen de kerngegevens compact."),
    ],
    defaultLayout: "split",
    blocks: [],
    supportsCta: false,
    mediaRoles: [],
    compositionHint: "Contactgegevens worden DETERMINISTISCH door de generator ingevoegd (nooit AI-verzonnen); minimaal één contact- of booking-sectie op de homepage.",
  },
  rich_text: {
    type: "rich_text",
    label: "Vrij tekstblok",
    purpose: "Redactionele inhoud tussen secties in — uitleg, verhaal of branche-informatie.",
    layouts: [
      layout("article", "Breed leesbaar tekstblok."),
      layout("columns", "Meerkoloms tekst."),
    ],
    defaultLayout: "article",
    blocks: [{ key: "paragraph", description: "Eén tekstblok met korte inhoudshint.", min: 1, max: 4, requiredKind: true }],
    supportsCta: false,
    mediaRoles: ["image"],
    compositionHint: "Kan meerdere keren per pagina; hints uit echte input, geen verzonnen content.",
  },
};

/** Consistentie-assertie van de registry zelf (fail-fast bij typos). */
export function assertBlueprintRegistryInvariants(): void {
  for (const type of BLUEPRINT_SECTION_TYPES) {
    const def = BLUEPRINT_SECTION_REGISTRY[type];
    if (!def || def.type !== type) {
      throw new Error(`SECTION-REGISTRY inconsistent: ontbrekende/afwijkende entry voor "${type}".`);
    }
    if (def.layouts.length === 0) throw new Error(`SECTION-REGISTRY: "${type}" heeft geen layouts.`);
    if (!def.layouts.some((l) => l.key === def.defaultLayout)) {
      throw new Error(`SECTION-REGISTRY: defaultLayout "${def.defaultLayout}" bestaat niet bij "${type}".`);
    }
    for (const block of def.blocks) {
      if (block.requiredKind && block.min < 1) {
        throw new Error(`SECTION-REGISTRY: verplicht blok "${block.key}" bij "${type}" moet minimaal 1 zijn.`);
      }
      if (block.max < block.min) {
        throw new Error(`SECTION-REGISTRY: blok "${block.key}" bij "${type}" heeft max < min.`);
      }
    }
  }
}

/** True als de layout onder dit sectietype bestaat. */
export function isBlueprintLayout(type: BlueprintSectionType, layoutKey: string): boolean {
  return BLUEPRINT_SECTION_REGISTRY[type]?.layouts.some((l) => l.key === layoutKey) ?? false;
}

/** Toegestane blokkeys voor een sectietype (leeg = geen blokken). */
export function blueprintBlockKeys(type: BlueprintSectionType): Set<string> {
  return new Set((BLUEPRINT_SECTION_REGISTRY[type]?.blocks ?? []).map((b) => b.key));
}

/**
 * Bouwt het machine-leesbare NL-contract van de registry voor de
 * designplanning-prompt. Één bron van waarheid: schema én prompt volgen
 * dezezelfde registry, dus AI-output en validatie kunnen niet divergeren.
 */
export function buildBlueprintSectionContract(): string {
  const lines: string[] = [
    "SECTION-REGISTRY (gesloten catalogus — uitsluitend deze types/layouts/blokkeys gebruiken):",
  ];
  for (const type of BLUEPRINT_SECTION_TYPES) {
    const def = BLUEPRINT_SECTION_REGISTRY[type];
    const layouts = def.layouts.map((l) => l.key).join("|");
    const blocks = def.blocks.length
      ? def.blocks.map((b) => `${b.key} (min ${b.requiredKind ? b.min : 0}, max ${b.max})`).join(", ")
      : "geen blokken";
    const media = def.mediaRoles.length ? def.mediaRoles.join("|") : "geen media";
    lines.push(
      `- ${type} (${def.label}): layouts ${layouts}; blokken: ${blocks}; media: ${media}; CTA ${def.supportsCta ? "ondersteund" : "niet"} — ${def.purpose} ${def.compositionHint}`
    );
  }
  return lines.join("\n");
}
