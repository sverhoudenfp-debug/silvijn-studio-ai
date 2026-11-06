/**
 * CONTACT-PROVENANCE (W5, 6 november 2026).
 *
 * Aanleiding: op de Veld & Vorm-site stonden een telefoonnummer en e-mailadres
 * die niet in de briefing van Silvijn zaten. Ze kwamen uit het testbriefing-
 * bestand van de meetcase en uit AI-copy die ze vervolgens overnam.
 *
 * Regel die hier wordt afgedwongen:
 * - Contactgegevens komen UITSLUITEND uit de aangeleverde lead-/briefingcontext.
 * - Is een gegeven niet aangeleverd, dan verschijnt het nergens: niet op de
 *   homepage, niet op de contactpagina, niet in de footer, niet in metadata.
 * - AI-copy mag nooit contactgegevens bevatten. Staat er toch een, dan wordt de
 *   betreffende zin verwijderd (nooit herschreven, nooit aangevuld) en het
 *   verwijderde fragment wordt gerapporteerd.
 *
 * De functies zijn puur en deterministisch: dezelfde input geeft dezelfde
 * output, in generatie, QC en tests.
 */

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_PATTERN = /(?:\+31|0031|0)[\s().-]?\d[\d\s().-]{7,12}\d/g;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[a-z0-9.-]+\.[a-z]{2,}\S*/gi;

export interface ContactPolicy {
  /** Toegestaan e-mailadres (exact), of null als er niets is aangeleverd. */
  allowedEmail: string | null;
  /** Toegestaan telefoonnummer (genormaliseerd, laatste 9 cijfers), of null. */
  allowedPhone: string | null;
  /** Toegestane website-URL, of null. */
  allowedWebsite?: string | null;
}

export interface SanitizedText {
  text: string;
  /** Verwijderde fragmenten (voor rapportage/audit; nooit stilzwijgend). */
  removed: string[];
}

function digitsOf(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

/**
 * Splits tekst in zinnen. Bewust op "punt gevolgd door witruimte en een
 * hoofdletter", zodat punten ín een e-mailadres of URL de zin niet opknippen
 * (W5-bug: een adres werd daardoor niet herkend en bleef staan).
 */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9"'“(])/g);
}

/**
 * Verwijdert contactgegevens die niet zijn aangeleverd uit vrije tekst.
 *
 * Een zin met een niet-toegestaan e-mailadres, telefoonnummer of URL vervalt
 * volledig: half een zin overhouden levert kromme copy op, en de AI mag het
 * ontbrekende gegeven niet zelf aanvullen.
 */
export function sanitizeContactClaims(input: string, policy: ContactPolicy): SanitizedText {
  const allowedEmail = policy.allowedEmail?.trim().toLowerCase() ?? null;
  const allowedPhone = policy.allowedPhone ? digitsOf(policy.allowedPhone) : null;
  const allowedWebsite = policy.allowedWebsite?.trim().toLowerCase() ?? null;

  // W8: "neem contact op via telefoon of e-mail" is fout zodra die gegevens
  // ontbreken — de bezoeker krijgt een kanaal dat niet bestaat.
  const channelUnavailable = allowedPhone === null || allowedEmail === null;
  const mentionsUnavailableChannel = (sentence: string): boolean =>
    (allowedPhone === null && /\b(telefoon|telefonisch|bel ons)\b/i.test(sentence)) ||
    (allowedEmail === null && /\b(e-?mail|mail ons)\b/i.test(sentence));

  const removed: string[] = [];
  const kept: string[] = [];

  for (const sentence of sentences(input)) {
    const emails = [...sentence.matchAll(EMAIL_PATTERN)].map((match) => match[0].toLowerCase());
    const phones = [...sentence.matchAll(PHONE_PATTERN)].map((match) => digitsOf(match[0]));
    const urls = [...sentence.matchAll(URL_PATTERN)].map((match) => match[0].toLowerCase());

    const foreignEmail = emails.some((email) => email !== allowedEmail);
    const foreignPhone = phones.some((phone) => phone !== null && phone !== allowedPhone);
    const foreignUrl = urls.some((url) => {
      if (!allowedWebsite) return true;
      return !url.includes(allowedWebsite.replace(/^https?:\/\//, "").replace(/^www\./, ""));
    });

    // Geen enkel contactgegeven aangeleverd? Dan is élk adres in de copy
    // (= e-mail, telefoon, URL) een niet-onderbouwde toevoeging.
    const anyContactWithoutSource =
      (allowedEmail === null && emails.length > 0) ||
      (allowedPhone === null && phones.length > 0);

    if (foreignEmail || foreignPhone || foreignUrl || anyContactWithoutSource || (channelUnavailable && mentionsUnavailableChannel(sentence))) {
      removed.push(sentence.trim());
      // Behoud de witruimte tussen de overgebleven zinnen.
      if (sentence.endsWith("\n\n")) kept.push("\n\n");
      continue;
    }
    kept.push(sentence);
  }

  const text = kept.join("").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { text, removed };
}

/**
 * Scant een gerenderd oppervlak (homepage, contactpagina, footer, metadata) op
 * contactgegevens die niet zijn aangeleverd.
 */
export interface SurfaceContactFinding {
  surface: string;
  kind: "email" | "phone" | "url";
  value: string;
}

export function findUnprovenContact(
  text: string,
  policy: ContactPolicy,
  surface: string
): SurfaceContactFinding[] {
  const findings: SurfaceContactFinding[] = [];
  const allowedEmail = policy.allowedEmail?.trim().toLowerCase() ?? null;
  const allowedPhone = policy.allowedPhone ? digitsOf(policy.allowedPhone) : null;

  for (const match of text.matchAll(EMAIL_PATTERN)) {
    const email = match[0].toLowerCase();
    if (email !== allowedEmail) findings.push({ surface, kind: "email", value: email });
  }
  for (const match of text.matchAll(PHONE_PATTERN)) {
    const phone = digitsOf(match[0]);
    if (phone === null) continue;
    if (phone !== allowedPhone) findings.push({ surface, kind: "phone", value: match[0].trim() });
  }
  return findings;
}
