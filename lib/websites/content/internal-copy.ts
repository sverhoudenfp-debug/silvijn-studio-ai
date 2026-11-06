/**
 * INTERNE COPY-GUARD (W6, 6 november 2026).
 *
 * Aanleiding: op de Veld & Vorm-site stonden teksten als
 * "Verhaal en werkwijze van Veld & Vorm tonen" en "Het volledige
 * dienstenaanbod toelichten". Dat zijn INTERNE planningsinstructies (het doel
 * van een pagina), geen bezoekerscopy. Ze kwamen uit `page.purpose` in het
 * blueprint en belandden via de paginakop in de gerenderde site.
 *
 * Deze module herkent zulke teksten deterministisch, zodat de generator ze kan
 * blokkeren vóór het renderen en de preflight ze als fout kan melden als ze er
 * toch in sluipen.
 */

/**
 * Signalen van interne/plannings- of technische copy.
 *
 * Bewust smal gehouden: alleen formuleringen die in bezoekerscopy nooit
 * voorkomen, zoals een doe-woord aan het eind van een frase ("... tonen",
 * "... toelichten") of expliciete systeemtaal.
 */
const INTERNAL_PATTERNS: { id: string; pattern: RegExp; reason: string }[] = [
  {
    id: "planning_verb_infinitive",
    // "Verhaal en werkwijze tonen", "Diensten toelichten", "Contact opnemen mogelijk maken"
    pattern:
      /\b(tonen|toelichten|benadrukken|communiceren|vergroten|versterken|positioneren|uitleggen|overtuigen|informeren|presenteren|begeleiden naar|mogelijk maken)\s*[.!]?$/i,
    reason: "eindigt op een planningswerkwoord (interne opdracht, geen bezoekerscopy)",
  },
  {
    id: "internal_audience",
    pattern: /\b(de bezoeker|de gebruiker|de lezer|de klant moet|bezoekers moeten)\b/i,
    reason: "spreekt over de bezoeker in plaats van tegen de bezoeker",
  },
  {
    id: "page_function",
    pattern:
      /\b(doel van deze pagina|functie van deze pagina|deze pagina (toont|legt|geeft)|sectie (toont|legt)|blok (toont|legt)|de template|placeholder|lorem ipsum|tbd|todo|nader te bepalen)\b/i,
    reason: "beschrijft de pagina zelf in plaats van de inhoud",
  },
  {
    id: "technical_jargon",
    pattern:
      /\b(hero|cta-blok|conversiesectie|above the fold|usp-blok|layout|component|sectietype|wireframe|mock ?up)\b/i,
    reason: "technisch ontwerpjargon dat niet op een website hoort",
  },
  {
    id: "keyword_stuffing_note",
    pattern: /\b(seo-?tekst|keyword|meta ?description|alt-?tekst)\b/i,
    reason: "interne SEO-instructie in plaats van copy",
  },
];

export interface InternalCopyFinding {
  patternId: string;
  reason: string;
  excerpt: string;
}

/** Kort een fragment in voor rapportage. */
function excerpt(value: string, match: RegExpMatchArray): string {
  const start = Math.max(0, (match.index ?? 0) - 30);
  const end = Math.min(value.length, (match.index ?? 0) + match[0].length + 30);
  return value.slice(start, end).replace(/\s+/g, " ").trim();
}

/** Vindt interne/plannings- of technische formuleringen in vrije tekst. */
export function findInternalCopy(text: string): InternalCopyFinding[] {
  const findings: InternalCopyFinding[] = [];
  const trimmed = text.trim();
  if (trimmed.length === 0) return findings;
  for (const rule of INTERNAL_PATTERNS) {
    const match = trimmed.match(rule.pattern);
    if (match) findings.push({ patternId: rule.id, reason: rule.reason, excerpt: excerpt(trimmed, match) });
  }
  return findings;
}

/** True als de tekst (een deel van) een interne instructie bevat. */
export function isInternalCopy(text: string): boolean {
  return findInternalCopy(text).length > 0;
}

/**
 * Filtert interne instructies uit een lijst kandidaten en geeft de eerste
 * bruikbare, bezoekersgerichte tekst terug (of null).
 */
export function pickVisitorCopy(candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const value = candidate.trim();
    if (value.length === 0) continue;
    if (isInternalCopy(value)) continue;
    return value;
  }
  return null;
}
