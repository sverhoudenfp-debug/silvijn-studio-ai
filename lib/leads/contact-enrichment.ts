/**
 * Contactverrijking (2026-10-01) — stap 2 van de discovery-flow:
 * voor een lead zonder e-mailadres GECONTROLEERD zoeken naar een openbaar
 * zakelijk e-mailadres. De regels hier zijn deterministisch en conservatief:
 *
 *   - een e-mailadres wordt ALLEEN geaccepteerd wanneer het letterlijk op
 *     een openbare bronpagina staat (nooit verzinnen, nooit afleiden);
 *   - de bron moet daadwerkelijk aan het bedrijf gekoppeld kunnen worden:
 *       1. own_page_slug (aangescherpt 2026-10-06) — ALLEEN via een officieel
 *          social-profiel of de eigen bedrijfswebsite, mét kruiscontrole
 *          (telefoon, vestigingsplaats of bij de naam horend e-maildomein);
 *          een naam in een URL is op zichzelf nooit voldoende, óf
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
  nearName: boolean;
  nearPhone: boolean;
  /** Vestigingsplaats van de lead staat op de bronpagina (kruiscontrole-signaal). */
  cityInText: boolean;
}

export interface AcceptanceDecision {
  accepted: boolean;
  rule: AcceptanceRule | null;
  reason: string;
  /**
   * Aantoonbaar eigen bedrijfswebsite (route B): de pagina waarop het adres
   * werd aangetroffen staat op het eigen e-maildomein én is live bevraagd.
   * Null bij social-route, directory-/platformbronnen of afwijzing — nooit
   * een site die niet als de officiele website van de lead bewezen is.
   */
  websiteUrl?: string | null;
}

const NEAR_MATCH_DISTANCE = 300;
/** Korte/generieke namen krijgen geen slug-regel: te veel valse treffers. */
const MIN_NAME_SLUG_LENGTH = 8;
const MIN_NAME_LENGTH = 4;

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

/**
 * DIRECTORY-/PLATFORM-DOMEINEN (2026-10-06): e-mailadressen op deze domeinen
 * zijn eigendom van het platform (de gids), níet van het vermelde bedrijf.
 * Ze mogen NOOIT als zakelijk bedrijfs-e-mailadres worden geaccepteerd, hoe
 * sterk het omringende bewijs (naam/telefoon/adres) ook is. De gids zelf mag
 * wél als BRON dienen: een OOZO-profiel met de juiste naam + telefoon die
 * een écht bedrijfsadres (info@<bedrijf>.nl) vermeldt, is gewoon verifieer-
 *baar via de bestaande regels. Alleen het platform-eigen postvak is verboden.
 * Onderhoud: voeg alleen domeinen toe die daadwerkelijk als directory of
 * platform voor bedrijfsvermeldingen fungeren.
 */
export const DIRECTORY_PLATFORM_DOMAINS: readonly string[] = [
  "oozo.nl",
  "klusgo.nl",
  "degemeentegids.nl",
  "besteautopoetser.nl",
  "cylex.nl",
  "drimble.nl",
  "mkb-bedrijvengids.nl",
  "123auto.nl",
];

/**
 * PLATFORM-BRONDOMEINEN (2026-10-06): profielpagina's op deze domeinen zijn
 * nooit de "eigen pagina" van het bedrijf — een URL met de bedrijfsnaam op
 * zo'n platform (bijv. rocketreach.co/<naam>-email_123) zegt niets over
 * eigendom. own_page_slug geldt er dus niet; de pagina mag wél als BRON
 * dienen voor de telefoon-kruischeck of tweede bron (regel 4 van de fix).
 */
export const PLATFORM_SOURCE_DOMAINS: readonly string[] = [...DIRECTORY_PLATFORM_DOMAINS, "rocketreach.co"];

/** True wanneer de bron-URL op een bekend directory-/platformdomein staat. */
export function isPlatformSourceUrl(url: string): boolean {
  return PLATFORM_SOURCE_DOMAINS.includes(domainOf(url));
}

/**
 * SOCIAL-BRONDOMEINEN (2026-10-06, own_page_slug-aanscherping): domeinen
 * waarop een OFFICIEEL bedrijfsprofiel mogelijk is. Ook hier geldt: alleen
 * de bedrijfsnaam in de URL is niet voldoende — er is altijd een
 * kruiscontrole nodig (telefoon, bedrijfsdomein of vestigingsplaats).
 */
export const SOCIAL_PLATFORM_DOMAINS: readonly string[] = [
  "facebook.com",
  "m.facebook.com",
  "instagram.com",
  "linkedin.com",
];

/** True wanneer de bron-URL een social-profielpagina is (Facebook e.d.). */
export function isSocialSourceUrl(url: string): boolean {
  return SOCIAL_PLATFORM_DOMAINS.includes(domainOf(url));
}

/**
 * GENERIEKE BRANCHE-TERMEN (2026-10-06): een bedrijfsnaam die (na weghalen
 * van de vestigingsplaats) uitsluitend uit branche-termen bestaat, is te
 * generiek voor een naam-overeenkomst — te veel valse treffers
 * ("Hovenier Gouda", "Tuinonderhoud"). Voor zulke namen eist own_page_slug
 * een telefoon-kruischeck.
 */
const GENERIC_INDUSTRY_SLUGS: readonly string[] = [
  "schilder",
  "schilders",
  "schilderwerk",
  "schilderwerken",
  "schildersbedrijf",
  "schildersvandaag",
  "hovenier",
  "hoveniers",
  "hoveniersbedrijf",
  "tuinonderhoud",
  "tuinman",
  "tuintechniek",
  "stukadoor",
  "stukadoors",
  "stukadoorsbedrijf",
  "dakdekker",
  "dakdekkers",
  "loodgieter",
  "loodgieters",
  "klusbedrijf",
  "klusjesman",
  "klussers",
  "timmerman",
  "timmerwerken",
  "installatiebedrijf",
  "schoonmaakbedrijf",
  "reparatiebedrijf",
  "grasmaaier",
];

/** Vestigings-plaatsen waarvan de ccTLD zonder telefoon-check acceptabel is. */
const ALLOWED_COUNTRY_TLDS: readonly string[] = ["nl", "eu", "be"];

/** Domein van een e-mailadres (klein, zonder www). */
export function emailDomainOf(email: string): string {
  return (email.split("@")[1] ?? "").toLowerCase().replace(/^www\./, "");
}

/** Hostname zonder TLD, genormaliseerd ("acvandijk.nl" -> "acvandijk"). */
export function domainSlugOf(domain: string): string {
  const host = domain.toLowerCase().replace(/^www\./, "");
  const labels = host.split(".");
  if (labels.length <= 1) return normalizeForMatch(host);
  return normalizeForMatch(labels.slice(0, -1).join(""));
}

/**
 * Het kenmerkende deel van een bedrijfsnaam: alles wat overblijft na het
 * weghalen van de vestigingsplaats en generieke branche-termen. Voor
 * "Schildersbedrijf A.C van Dijk" is dat "acvandijk"; voor "Hovenier Gouda"
 * blijft er niets over (generiek).
 */
export function distinctiveBusinessSlug(businessName: string, city: string | null): string {
  let slug = nameSlug(businessName);
  const citySlug = city ? nameSlug(city) : "";
  if (citySlug.length >= 4 && slug.includes(citySlug)) {
    slug = slug.split(citySlug).join("");
  }
  // Branche-termen langst-eerst verwijderen, herhalend tot stabiel: deels-
  // verwijdering mag geen betekenisloze fragmenten laten ("sbedrijf") die
  // alsnog als kenmerkend door de domein-correspondentie heen glippen.
  const sorted = [...GENERIC_INDUSTRY_SLUGS].sort((a, b) => b.length - a.length);
  let changed = true;
  while (changed) {
    changed = false;
    for (const term of sorted) {
      if (slug.includes(term)) {
        slug = slug.split(term).join("");
        changed = true;
      }
    }
  }
  return slug;
}

/** True wanneer de naam te generiek is voor een naam-overeenkomst alléén. */
export function isGenericBusinessName(businessName: string, city: string | null): boolean {
  return distinctiveBusinessSlug(businessName, city).length < 6;
}

/**
 * True wanneer het e-maildomein bij de bedrijfsnaam hoort (bijv.
 * info@acvandijk.nl bij "Schildersbedrijf A.C van Dijk"). Alleen het
 * kenmerkende deel van de naam telt: branche-termen + plaats doen dat niet.
 */
export function emailDomainCorrespondsToBusiness(email: string, target: EnrichmentTarget): boolean {
  const domainSlug = domainSlugOf(emailDomainOf(email));
  if (domainSlug.length < 8) return false;
  const distinctive = distinctiveBusinessSlug(target.businessName, target.city);
  if (distinctive.length < 6) return false;
  return domainSlug.includes(distinctive) || distinctive.includes(domainSlug);
}

/**
 * Buitenlandse ccTLD (niet NL/EU/BE) voor een Nederlands bedrijfsdoel:
 * alleen te accepteren mét telefoon-kruischeck op de bron.
 */
export function isForeignCountryEmailDomain(email: string): boolean {
  const tld = emailDomainOf(email).split(".").pop() ?? "";
  return /^[a-z]{2}$/.test(tld) && !ALLOWED_COUNTRY_TLDS.includes(tld);
}

/** True wanneer het e-maildomein eigendom is van een directory/platform. */
export function isDirectoryPlatformEmail(email: string): boolean {
  const domain = (email.split("@")[1] ?? "").toLowerCase().replace(/^www\./, "");
  return DIRECTORY_PLATFORM_DOMAINS.includes(domain);
}

const EMAIL_PATTERN = /[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}/g;

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
  const city = target.city ? target.city.trim().toLowerCase() : "";

  const phoneHits: { index: number; length: number }[] = [];
  if (phoneRe) {
    for (const m of lowerText.matchAll(phoneRe)) {
      phoneHits.push({ index: m.index ?? 0, length: m[0].length });
    }
  }

  const evidence: DocumentEvidence[] = [];
  for (const email of extractEmails(doc.text)) {
    // Gemaskeerde weergaven (a***@domein.nl) zijn geen letterlijke, bruikbare
    // adressen — data-brokers tonen ze zo; opslaan levert onbezorgbare mail.
    if (email.includes("*")) continue;
    const emailIndex = lowerText.indexOf(email);
    evidence.push({
      email,
      url: doc.url,
      domain: domainOf(doc.url),
      nameInUrl: slug.length >= MIN_NAME_SLUG_LENGTH && normalizedUrl.includes(slug),
      nameInText: rawName.length >= MIN_NAME_LENGTH && lowerText.includes(rawName),
      phoneInText: phoneHits.length > 0,
      nearName: withinDistance(lowerText, rawName, emailIndex, NEAR_MATCH_DISTANCE),
      cityInText: city.length >= 3 && lowerText.includes(city),
      nearPhone: phoneHits.some(
        (hit) => Math.abs(hit.index - emailIndex) <= NEAR_MATCH_DISTANCE || Math.abs(hit.index + hit.length - emailIndex) <= NEAR_MATCH_DISTANCE
      ),
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
  // HARD RULE (2026-10-06): een e-mailadres op een directory-/platformdomein
  // is nooit het zakelijke adres van het bedrijf — op geen enkele route.
  // Vooraf en onvoorwaardelijk, zodat geen enkele verificatieregel eronder
  // kan doorglippen.
  if (isDirectoryPlatformEmail(email)) {
    return {
      accepted: false,
      rule: null,
      reason: "directory-/platform-e-mailadres: dit postvak is van de gids, niet van het bedrijf",
    };
  }
  if (target.businessName.trim().length < MIN_NAME_LENGTH) {
    return { accepted: false, rule: null, reason: "bedrijfsnaam te generiek om te verifiëren" };
  }
  if (evidence.length === 0) {
    return { accepted: false, rule: null, reason: "geen brondocument met dit adres" };
  }

  // Regel 1 — EIGEN PAGINA (aangescherpt 2026-10-06, goedgekeurd door Silvijn):
  // een URL met de bedrijfsnaam is alléén NOOIT voldoende. De bron moet
  // daadwerkelijk aan het bedrijf gekoppeld kunnen worden, via precies één
  // van twee routes:
  //   A. OFFICIEEL SOCIAL-PROFIEL (facebook.com/<bedrijf>, …): naam in URL
  //      én op de pagina, plus een kruiscontrole: lead-telefoon op de pagina,
  //      het e-maildomein dat bij de bedrijfsnaam hoort, óf (bij freemail)
  //      de vestigingsplaats op het profiel.
  //   B. EIGEN WEBSITE: het adres staat op het bedrijfsdomein zelf
  //      (e-maildomein == brondomein), het domein hoort bij het kenmerkende
  //      deel van de bedrijfsnaam, de naam staat op de pagina én er is een
  //      locatie-/telefoon-anker. Derden-pagina's (magazines, concurrenten,
  //      directories, platforms) kunnen nooit als eigen website gelden.
  // Extra garde over beide routes heen: een buitenlandse ccTLD (niet
  // nl/eu/be) vraagt altijd een telefoon-kruischeck; een generieke naam
  // (alleen branche-termen, bijv. "Hovenier Gouda") vraagt dat óók.
  // Beleid: recall laten liggen boven false positives.
  if (slug.length >= MIN_NAME_SLUG_LENGTH) {
    const genericName = isGenericBusinessName(target.businessName, target.city);

    // Route A — officieel social-profiel.
    const social = evidence.find((e) => {
      if (!isSocialSourceUrl(e.url)) return false;
      if (!e.nameInUrl || !(e.nameInText || e.nearName)) return false;
      if (isForeignCountryEmailDomain(e.email) && !e.phoneInText) return false;
      if (genericName && !e.phoneInText) return false;
      const domainCorresponds = emailDomainCorrespondsToBusiness(e.email, target);
      if (domainCorresponds || e.phoneInText) return true;
      // Freemail op een officieel profiel met de vestigingsplaats als anker:
      return e.cityInText && isFreemailDomain(e.email);
    });

    // Route B — eigen website (adres gehost op het bedrijfsdomein zelf).
    const ownSite = evidence.find((e) => {
      if (isPlatformSourceUrl(e.url) || isSocialSourceUrl(e.url)) return false;
      if (emailDomainOf(e.email) !== e.domain) return false;
      if (!emailDomainCorrespondsToBusiness(e.email, target)) return false;
      if (!(e.nameInText || e.nearName)) return false;
      if (isForeignCountryEmailDomain(e.email) && !e.phoneInText) return false;
      if (genericName && !e.phoneInText) return false;
      // Waar beschikbaar: telefoon- of vestigingsplaats-kruiscontrole.
      const hasAnchor = Boolean(target.phone || target.city);
      if (hasAnchor && !(e.phoneInText || e.cityInText)) return false;
      return true;
    });

    if (social) return { accepted: true, rule: "own_page_slug", reason: `officieel social-profiel: ${social.domain}` };
    if (ownSite) {
      return {
        accepted: true,
        rule: "own_page_slug",
        reason: `eigen bedrijfswebsite: ${ownSite.domain}`,
        websiteUrl: ownSite.url,
      };
    }
  }

  // Regel 2 — telefoon-kruischeck: exacte bedrijfsnaam + het telefoonnummer
  // van de lead op dezelfde bron, adres in de buurt van naam of nummer.
  const phoneMatch = evidence.find((e) => e.nameInText && e.phoneInText && (e.nearName || e.nearPhone));
  if (phoneMatch) {
    return { accepted: true, rule: "phone_cross_check", reason: `naam en telefoonnummer bevestigd op ${phoneMatch.domain}` };
  }

  // Regel 3 — twee onafhankelijke bronnen noemen hetzelfde adres bij de naam.
  const corroborating = evidence.filter((e) => e.nameInText && (e.nearName || e.nearPhone));
  const distinctDomains = new Set(corroborating.map((e) => e.domain));
  if (distinctDomains.size >= 2) {
    return { accepted: true, rule: "second_source", reason: `onafhankelijk bevestigd door ${distinctDomains.size} bronnen` };
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
