/**
 * VELD & VORM — officiële testonderneming vanaf W3 (5 november 2026).
 *
 * Alle gegevens hieronder zijn door Silvijn aangeleverde FICTIEVE testgegevens.
 * Ze staan hier als bron, niet als content: de AI-generatie leest ze en schrijft
 * zelf de website. Er wordt niets aanvullends verzonnen.
 */

export const veldEnVormBrief = {
  businessName: "Veld & Vorm",
  industry: "Hoveniersbedrijf en tuinontwerp",
  city: "Utrecht",
  province: "Utrecht",
  founded: 2018,
  teamSize: 4,
  // W5 (6 november 2026): deze gegevens zijn NIET door Silvijn aangeleverd.
  // Ze stonden hier als testwaarde en belandden daardoor op de site. Ontbrekend
  // betekent ontbrekend: de site toont dan alleen het contactformulier.
  phone: null,
  email: null,
  website: null,
  websiteStatus: "no_website" as const,
  serviceArea: ["Utrecht", "Zeist", "De Bilt", "Houten", "Nieuwegein", "Maarssen"],
  audience: "Particuliere huiseigenaren",
  positioning: "Hoogwaardige, praktische en natuurlijke tuinen",
  promise: "Tuinen met karakter. Ontworpen voor het dagelijks leven.",
  services: [
    {
      title: "Tuinontwerp",
      description:
        "Persoonlijke ontwerpen die aansluiten bij de woning, de wensen en de beschikbare ruimte.",
    },
    {
      title: "Tuinaanleg",
      description:
        "Complete aanleg inclusief bestrating, terrassen, borders en schuttingen.",
    },
    {
      title: "Beplanting",
      description:
        "Zorgvuldig samengestelde beplantingsplannen met aandacht voor de seizoenen.",
    },
    {
      title: "Tuinonderhoud",
      description: "Periodiek onderhoud en seizoensgebonden werkzaamheden.",
    },
  ],
  differentiators: [
    "Eén vast aanspreekpunt.",
    "Persoonlijk tuinontwerp.",
    "Aandacht voor praktisch gebruik.",
    "Bewuste materiaalkeuze en waterbeheer.",
    "Tuinen die gedurende verschillende seizoenen aantrekkelijk blijven.",
  ],
  process: [
    "Kennismakingsgesprek.",
    "Bezoek aan de tuin.",
    "Ontwerp en offerte.",
    "Planning en uitvoering.",
    "Oplevering en eventueel vervolgonderhoud.",
  ],
  identity: "Modern, natuurlijk, hoogwaardig, persoonlijk en toegankelijk. Geen overdreven luxe taal of goedkope verkooppraatjes.",
} as const;

/** Notitities zoals een menselijke kwalificatie ze in het dashboard achterlaat. */
export const veldEnVormNotes: string[] = [
  `Bedrijf: ${veldEnVormBrief.businessName} (${veldEnVormBrief.industry}), gevestigd in ${veldEnVormBrief.city}.`,
  `Opgericht in ${veldEnVormBrief.founded}, team van ${veldEnVormBrief.teamSize} medewerkers.`,
  `Werkgebied: ${veldEnVormBrief.serviceArea.join(", ")}.`,
  `Doelgroep: ${veldEnVormBrief.audience}.`,
  `Positionering: ${veldEnVormBrief.positioning}.`,
  `Merkbelofte: "${veldEnVormBrief.promise}"`,
  `Diensten: ${veldEnVormBrief.services.map((service) => `${service.title} — ${service.description}`).join(" ")}`,
  `Onderscheidend: ${veldEnVormBrief.differentiators.join(" ")}`,
  `Werkwijze: ${veldEnVormBrief.process.join(" ")}`,
  `Merkidentiteit: ${veldEnVormBrief.identity}`,
  "Er is nog geen website; alle bovenstaande feiten zijn de enige toegestane bedrijfsfeiten.",
];
