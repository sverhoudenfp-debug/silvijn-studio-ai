/**
 * Contactverrijking (2026-10-01) — stap 2 van de discovery-flow:
 * voor een lead zonder e-mailadres GECONTROLEERD zoeken naar een openbaar
 * zakelijk e-mailadres. De regels hier zijn deterministisch en conservatief:
 *
 *   - een e-mailadres wordt ALLEEN geaccepteerd wanneer het letterlijk op
 *     een openbare bronpagina staat (nooit verzinnen, nooit afleiden);
 *   - de bron moet met voldoende zekerheid bij het bedrijf horen:
 *       1. own_page_slug — de URL (domein/pad) bevat de bedrijfsnaam
 *          (eigen webpresence, bijv. facebook.com/<bedrijfsnaam>), óf
 *       2. phone_cross_check — de bron bevat de exacte bedrijfsnaam ÉN
 *          het telefoonnummer van de lead (Google Places), met het adres
 *          in de buurt van naam of nummer, óf
 *       3. second_source — twee onafhankelijke domeinen tonen hetzelfde
 *          adres in directe context van de bedrijfsnaam;
 *   - generieke wegwerp-accounts (noreply@, webmaster@, privacy@, …) en
 *     namen zonder bewijs worden altijd geweigerd.
 *
 * De module is puur: geen netwerk, geen database, geen AI. De provider
 * (lib/discovery/contact-enrichment/provider.ts) levert alleen bronteksten.
 */

export interface EnrichmentTarget {
  businessName: string;
  city: string | null;
  phone: string | null;
  address: string | null;
  postalCode: string | null;
}

export interface SourceDocument {
  url: string;
  /** Zichtbare tekst van de bronpagina of zoeksnippet. */
  text: string;
}

export type AcceptanceRule = "own_page_slug" | "phone_cross_check" | "second_source";

export interface DocumentEvidence {
  email: string;
  url: string;
  domain: string;
  nameInUrl: boolean;
  nameInText: boolean;
  phoneInText: boolean;
  addressInText: boolean;
  nearName: boolean;
  nearPhone: boolean;
  nearAddress: boolean;
  sourceKind: "official_or_social" | "directory_or_aggregator" | "other";
}

export interface AcceptanceDecision {
  accepted: boolean;
  rule: AcceptanceRule | null;
  reason: string;
}

const NEAR_MATCH_DISTANCE = 300;
/** Korte/generieke namen krijgen geen slug-regel: te veel valse treffers. */
const MIN_NAME_SLUG_LENGTH = 8;
const MIN_NAME_LENGTH = 4;
const MIN_ADDRESS_LENGTH = 6;

const KNOWN_SOCIAL_HOSTS = new Set(["facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com"]);
const KNOWN_DIRECTORY_HOSTS = new Set(["cylex.nl", "drimble.nl", "oozo.nl", "mkb-bedrijvengids.nl", "besteautopoetser.nl", "123auto.nl"]);
const DIRECTORY_HOST_MARKERS = ["gids", "bedrijvengids", "directory", "bedrijven", "bedrijfsgids", "telefoongids", "reviews", "vergelijk", "zoekbedrijf"];

const REJECTED_LOCAL_PARTS = [
  "noreply",
  "no-reply",
  "no_reply",
  "donotreply",
  "do-not-reply",
  "webmaster",
  "postmaster",
  "abuse",
  "privacy",
  "example",
  "test",
  "admin",
];

/** Gratis/webmail-domeinen: legitiem voor kleine bedrijven, maar alleen met
 *  extra bewijs (die eis staat al in de acceptatieregels); deze lijst dient
 *  voor rangschikking en eerlijke rapportage. */
const FREEMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.nl",
  "outlook.com",
  "outlook.nl",
  "live.com",
  "live.nl",
  "msn.com",
  "ziggo.nl",
  "kpnmail.nl",
  "planet.nl",
  "hetnet.nl",
  "home.nl",
  "upcmail.nl",
  "solcon.nl",
  "telenet.be",
  "zeelandnet.nl",
];

const EMAIL_PATTERN = /[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}/g;

function emailDomain(email: string): string {
  return (email.split("@")[1] ?? "").toLowerCase().replace(/^www\./, "");
}

function rootDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join(".") : host.toLowerCase();
}

function sourceKind(url: string): "official_or_social" | "directory_or_aggregator" | "other" {
  const host = rootDomain(domainOf(url));
  if (KNOWN_SOCIAL_HOSTS.has(host)) return "official_or_social";
  if (KNOWN_DIRECTORY_HOSTS.has(host) || DIRECTORY_HOST_MARKERS.some((marker) => host.includes(marker))) return "directory_or_aggregator";
  return "other";
}

function addressMatches(target: EnrichmentTarget, text: string): boolean {
  const normalizedText = normalizeForMatch(text);
  const postal = normalizeForMatch(target.postalCode ?? "");
  if (postal.length >= 6 && normalizedText.includes(postal)) return true;
  const address = (target.address ?? "").trim();
  if (address.length < MIN_ADDRESS_LENGTH) return false;
  const normalizedAddress = normalizeForMatch(address);
  const streetNumber = normalizedAddress.match(/[a-z]+\d+[a-z]?/);
  return Boolean((streetNumber?.[0] && normalizedText.includes(streetNumber[0])) || normalizedText.includes(normalizedAddress));
}

export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function nameSlug(businessName: string): string {
  return normalizeForMatch(businessName);
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function phoneSuffix(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : digits.length > 0 ? digits : null;
}

export function isFreemailDomain(email: string): boolean {
  const domain = email.split("@")[1] ?? "";
  return FREEMAIL_DOMAINS.includes(domain);
}

export function isRejectedLocalPart(email: string): boolean {
  const local = (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return REJECTED_LOCAL_PARTS.includes(local);
}

/** Alle e-mailadressen die letterlijk in de tekst staan (klein, uniek). */
export function extractEmails(text: string): string[] {
  const matches = text.toLowerCase().match(EMAIL_PATTERN) ?? [];
  const out: string[] = [];
  for (const match of matches) {
    const email = match.replace(/[.,;:)>]+$/, "");
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

/** Afstand tussen twee posities (of de rand van een woord) binnen de venstergrootte. */
function withinDistance(text: string, needle: string, anchorIndex: number, distance: number): boolean {
  if (!needle || anchorIndex < 0) return false;
  let idx = text.indexOf(needle);
  while (idx !== -1) {
    const end = idx + needle.length;
    if (Math.abs(idx - anchorIndex) <= distance || Math.abs(end - anchorIndex) <= distance) return true;
    idx = text.indexOf(needle, idx + 1);
  }
  return false;
}

/** Telefoonnummer-flexibele regex: cijfers met optionele scheidingstekens. */
function phonePattern(digits: string): RegExp {
  return new RegExp(digits.split("").join("[\\s().-]{0,2}"), "g");
}

/**
 * Evalueert één brondocument: welke e-mailadressen staan er letterlijk op en
 * welk bewijs (naam/telefoon/proximity) is per adres zichtbaar? Beschrijvend.
 */
export function evaluateDocument(target: EnrichmentTarget, doc: SourceDocument): DocumentEvidence[] {
  const rawName = target.businessName.trim().toLowerCase();
  const slug = nameSlug(target.businessName);
  const normalizedUrl = normalizeForMatch(doc.url);
  const lowerText = doc.text.toLowerCase();
  const phone = phoneSuffix(target.phone);
  const phoneRe = phone ? phonePattern(phone) : null;
  const kind = sourceKind(doc.url);
  const addressInText = addressMatches(target, lowerText);

  const phoneHits: { index: number; length: number }[] = [];
  if (phoneRe) {
    for (const m of lowerText.matchAll(phoneRe)) {
      phoneHits.push({ index: m.index ?? 0, length: m[0].length });
    }
  }

  const evidence: DocumentEvidence[] = [];
  for (const email of extractEmails(doc.text)) {
    const emailIndex = lowerText.indexOf(email);
    evidence.push({
      email,
      url: doc.url,
      domain: domainOf(doc.url),
      nameInUrl: slug.length >= MIN_NAME_SLUG_LENGTH && normalizedUrl.includes(slug),
      nameInText: rawName.length >= MIN_NAME_LENGTH && lowerText.includes(rawName),
      phoneInText: phoneHits.length > 0,
      addressInText,
      nearName: withinDistance(lowerText, rawName, emailIndex, NEAR_MATCH_DISTANCE),
      nearPhone: phoneHits.some(
        (hit) => Math.abs(hit.index - emailIndex) <= NEAR_MATCH_DISTANCE || Math.abs(hit.index + hit.length - emailIndex) <= NEAR_MATCH_DISTANCE
      ),
      nearAddress:
        addressInText &&
        (withinDistance(lowerText, normalizeForMatch(target.address ?? ""), emailIndex, NEAR_MATCH_DISTANCE) ||
          (target.postalCode ? withinDistance(lowerText, normalizeForMatch(target.postalCode), emailIndex, NEAR_MATCH_DISTANCE) : false)),
      sourceKind: kind,
    });
  }
  return evidence.filter((e) => !isRejectedLocalPart(e.email));
}

/**
 * Deterministische acceptatiebeslissing over één kandidaat-e-mail, over alle
 * brondocumenten heen. Conservatief: twijfel betekent afwijzen.
 */
export function decideAcceptance(
  target: EnrichmentTarget,
  email: string,
  evidence: DocumentEvidence[]
): AcceptanceDecision {
  const slug = nameSlug(target.businessName);
  if (target.businessName.trim().length < MIN_NAME_LENGTH) {
    return { accepted: false, rule: null, reason: "bedrijfsnaam te generiek om te verifiëren" };
  }
  if (evidence.length === 0) {
    return { accepted: false, rule: null, reason: "geen brondocument met dit adres" };
  }

  // Regel 1 — eigen/sociale pagina: directory-URL's zijn geen eigen pagina's.
  if (slug.length >= MIN_NAME_SLUG_LENGTH) {
    const ownPage = evidence.find((e) => e.nameInUrl && e.nameInText && (e.sourceKind === "official_or_social" || rootDomain(e.domain).includes(slug)));
    if (ownPage) {
      const sourceDomain = rootDomain(ownPage.domain);
      const candidateDomain = emailDomain(ownPage.email);
      const looksLikeOwnDomain = candidateDomain === sourceDomain || candidateDomain.endsWith("." + sourceDomain);
      if (looksLikeOwnDomain || ownPage.sourceKind === "official_or_social") {
        return { accepted: true, rule: "own_page_slug", reason: `eigen/sociale pagina: ${ownPage.domain}` };
      }
    }
  }

  // Regel 2 — naam + telefoon + adres moeten op dezelfde bron staan.
  // Een directory mag niet zijn eigen algemene mailbox aan een bedrijf koppelen.
  const phoneMatch = evidence.find(
    (e) =>
      e.nameInText &&
      e.phoneInText &&
      e.addressInText &&
      (e.nearName || e.nearPhone || e.nearAddress) &&
      !(e.sourceKind === "directory_or_aggregator" && emailDomain(e.email) === rootDomain(e.domain))
  );
  if (phoneMatch) {
    return { accepted: true, rule: "phone_cross_check", reason: `naam + telefoon + adres bevestigd op ${phoneMatch.domain}` };
  }

  // Regel 3 — twee onafhankelijke domeinen moeten hetzelfde e-mailadres én hetzelfde adres bevestigen.
  const corroborating = evidence.filter(
    (e) =>
      e.nameInText &&
      e.addressInText &&
      (e.nearName || e.nearAddress) &&
      !(e.sourceKind === "directory_or_aggregator" && emailDomain(e.email) === rootDomain(e.domain))
  );
  const distinctDomains = new Set(corroborating.map((e) => rootDomain(e.domain)));
  if (distinctDomains.size >= 2) {
    return { accepted: true, rule: "second_source", reason: `e-mailadres + bedrijfsadres onafhankelijk bevestigd door ${distinctDomains.size} bronnen` };
  }

  return {
    accepted: false,
    rule: null,
    reason: evidence.some((e) => e.nameInText)
      ? "adres gevonden bij de bedrijfsnaam, maar zonder voldoende zekerheid (geen telefoon- of tweede bron)"
      : "geen bron verbindt dit adres met de bedrijfsnaam",
  };
}

/** Rangschikking van geaccepteerde kandidaten: eigen domein eerst, daarna bewijs, daarna alfabet. */
export function rankAcceptedCandidates(
  accepted: { email: string; rule: AcceptanceRule }[]
): { email: string; rule: AcceptanceRule }[] {
  const rulePriority: Record<AcceptanceRule, number> = {
    own_page_slug: 0,
    phone_cross_check: 1,
    second_source: 2,
  };
  return [...accepted].sort(
    (a, b) =>
      Number(isFreemailDomain(a.email)) - Number(isFreemailDomain(b.email)) ||
      rulePriority[a.rule] - rulePriority[b.rule] ||
      a.email.localeCompare(b.email)
  );
}
