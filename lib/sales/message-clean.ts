/**
 * Weergave-schoonmaker voor e-mailberichten in de conversation-thread.
 *
 * Gmail-antwoorden bevatten vaak de volledige gequoteerde historie
 * ("Op wo 28 sep 2026 10:15 schreef X <y@z>:" + het hele eerdere
 * bericht) en/of een lange handtekening. Voor de chat-achtige
 * thread-weergave is de NIEUWE tekst het bericht; de historie staat
 * al als aparte berichten in dezelfde thread.
 *
 * Deze module is puur en wordt uitsluitend voor weergave gebruikt:
 * de opgeslagen berichtinhoud (database) blijft ongewijzigd.
 */

/** Standaard scheidingsteken voor handtekeningen (RFC 3676, "-- "). */
const SIGNATURE_DELIMITER = "--";

/** Nederlandse en Engelse Gmail-quote-headers ("Op ... schreef ...:" / "On ... wrote:"). */
const QUOTE_HEADER_PATTERNS: RegExp[] = [
  /^op\s.+\s(schreef|verzond|schreef:)\b/i,
  /^on\s.+\swrote\s*:$/i,
  /^on\s.+\swrote$/i,
  /^van:\s.+\sverzonden:\s.+/i,
];

export function isQuoteHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  return QUOTE_HEADER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Verwijdert gequoteerde historie en handtekening uit een bericht voor
 * weergave. Conservatief: zonder herkenbaar patroon verandert er niets.
 */
export function cleanMessageForDisplay(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");

  const kept: string[] = [];
  let inQuotedBlock = false;
  let signatureSeen = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Standaard handtekeningscheider ("-- " / "--"): alles daaronder is
    // handtekening. Regel met alleen "--" of "-- " plus een volgende
    // naamregel; Gmail-scheiding met spaties ("-- ") ook.
    if (trimmed === SIGNATURE_DELIMITER || trimmed === "-- ") {
      signatureSeen = true;
      continue;
    }

    // Quote-header ("Op ... schreef X:"): alles daaronder is gequoteerde
    // historie totdat er een niet-gequoteerde regel volgt die niet met
    // ">" begint én niet leeg is. In de praktijk staat de historie altijd
    // onderaan; zodra er tekst van het bericht zelf stopt, stoppen we.
    if (isQuoteHeaderLine(line)) {
      inQuotedBlock = true;
      continue;
    }

    if (inQuotedBlock) {
      // Binnen het gequoteerde blok: "> "-regels en lege regels overslaan.
      // Niet-gequoteerde tekst NA een quote-header is vrijwel altijd
      // nog steeds de gequoteerde historie (Gmail quoteert zonder ">").
      continue;
    }

    if (signatureSeen) continue;

    // Inline gequoteerde regels ("> tekst") buiten een quote-blok zijn ook
    // historie en worden niet getoond als aparte regels.
    if (trimmed.startsWith(">")) continue;

    kept.push(line);
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Korte voorvertoning voor inbox-lijsten: één regel, zonder quotes. */
export function messagePreview(body: string, maxLength = 90): string {
  const cleaned = cleanMessageForDisplay(body).replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1)}…`;
}
