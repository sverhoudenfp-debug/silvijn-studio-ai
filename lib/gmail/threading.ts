import "server-only";

/**
 * Reply-threading (fix open punt Fase C): bepaalt welke
 * In-Reply-To / References / threadId een uitgaand antwoord moet
 * meekrijgen zodat Gmail het als onderdeel van de oorspronkelijke
 * e-mailthread levert in plaats van als losse nieuwe mail.
 *
 * Pure, deterministische logica — de database-lookups gebeuren in
 * lib/gmail/send.ts; deze module is volledig zonder side-effects en
 * daarmee regressietestbaar.
 */

export interface InboundThreadReference {
  /** Gmail-threadId van de klantmail (bericht-groepering in Gmail). */
  readonly providerThreadId: string | null;
  /** RFC822 Message-ID-header van de klantmail (In-Reply-To-doel). */
  readonly providerRfcMessageId: string | null;
  /** References-header van de klantmail (voorgaande keten). */
  readonly providerReferences: string | null;
}

export interface ReplyThreadInput {
  /** Meest recente bevestigde Gmail-reactie van de klant in het gesprek. */
  readonly latestInbound: InboundThreadReference | null;
  /** Onze eigen al verzonden Message-IDs in dit gesprek, oud → nieuw. */
  readonly sentMessageIds: readonly string[];
}

export interface ReplyThreadHeaders {
  readonly inReplyTo: string | null;
  readonly references: string | null;
  readonly threadId: string | null;
}

/** Referentie-ID's uit een References/In-Reply-To-header (whitespace-gescheiden). */
export function splitReferenceHeader(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * Bouwt de thread-headers voor het antwoord:
 *
 *   In-Reply-To  = Message-ID van de klantmail die we beantwoorden.
 *   References   = References-keten van de klantmail + onze eigen
 *                  verzonden Message-IDs + de Message-ID van de klantmail,
 *                  zonder duplicaten, volgorde behouden (oud → nieuw).
 *   threadId     = Gmail-threadId van de klantmail; Gmail groepeert het
 *                  antwoord hiermee in dezelfde conversatie.
 *
 * Zonder klantmail-referenties (initiele outreach, of een ingest zonder
 * thread-bewijs) zijn alle drie null: het bericht start terecht een
 * nieuwe thread, exact zoals voorheen.
 */
export function buildReplyThreadHeaders(input: ReplyThreadInput): ReplyThreadHeaders {
  const inbound = input.latestInbound;
  if (!inbound) return { inReplyTo: null, references: null, threadId: null };

  const inReplyTo = inbound.providerRfcMessageId?.trim() ?? null;

  const chain: string[] = [
    ...splitReferenceHeader(inbound.providerReferences),
    ...input.sentMessageIds.map((id) => id.trim()).filter((id) => id.length > 0),
  ];
  if (inReplyTo) chain.push(inReplyTo);

  // Duplicaten eruit, volgorde behouden: de eerste positie van een
  // Message-ID is de oudste verwijzing en bepaalt de keten-volgorde.
  const seen = new Set<string>();
  const references = chain.filter((id) => {
    const key = id.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    inReplyTo,
    references: references.length > 0 ? references.join(" ") : null,
    threadId: inbound.providerThreadId?.trim() || null,
  };
}
