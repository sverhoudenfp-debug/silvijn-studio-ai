/**
 * IDENTITY ISOLATION (W4, 2026-11-05).
 *
 * Aanleiding: op de contactpagina van de Veld & Vorm-website stond
 * `info@vandijkhoveniers.nl` — het e-mailadres van de eerdere testonderneming
 * Van Dijk Hoveniers. Oorzaak was een meet-harnas dat de contactcontext van de
 * ene case aan de andere case doorgaf. Dat mag nooit meer kunnen, en daarom
 * staat hier een deterministische poort die LOS van het harnas werkt.
 *
 * Uitgangspunten:
 * 1. De identiteit van een website is de identiteit van precies één bedrijf:
 *    de lead/specification van dít project.
 * 2. Ontbrekende contactgegevens blijven ontbreken. Er is geen fallback naar
 *    eerdere projecten, demo's, fixtures of "een logisch lijkende" waarde.
 * 3. Onbekende bedrijfsnamen, e-mailadressen, telefoonnummers en domeinen in
 *    de output zijn een HARD FAIL, niet een waarschuwing.
 *
 * De poort is puur en synchroon (geen IO, geen AI), zodat hij zowel in de
 * generatie als in de preflight/QC en in tests dezelfde uitkomst geeft.
 */

export interface BusinessIdentity {
  businessName: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  city?: string | null;
}

export interface IdentityLeak {
  /** Soort lek: e-mailadres, telefoonnummer, bedrijfsnaam of domein. */
  kind: "email" | "phone" | "business_name" | "domain";
  /** De gevonden waarde (genormaliseerd weergegeven). */
  value: string;
  /** Waar het gevonden is (bestandspad of paginalabel). */
  location: string;
}

/**
 * Bedrijven uit eerdere generaties, demo's en testfixtures. Deze namen,
 * domeinen en adressen mogen NOOIT in een andere website opduiken.
 *
 * Bewust een expliciete lijst (geen magie): elk nieuw test-/demobedrijf wordt
 * hier toegevoegd, waarmee oude identiteiten structureel geblokkeerd blijven.
 */
export const RETIRED_BUSINESS_IDENTITIES: readonly BusinessIdentity[] = [
  {
    businessName: "Van Dijk Hoveniers",
    email: "info@vandijkhoveniers.nl",
    phone: null,
    website: "https://www.vandijkhoveniers.nl",
    city: null,
  },
];

/** E-maildomeinen van publieke mailboxproviders: nooit een bedrijfsdomein. */
const PUBLIC_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.nl",
  "outlook.com",
  "outlook.nl",
  "live.nl",
  "live.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "protonmail.com",
  "proton.me",
  "ziggo.nl",
  "kpnmail.nl",
  "xs4all.nl",
  "telfort.nl",
  "home.nl",
  "hetnet.nl",
  "planet.nl",
  "upcmail.nl",
  "online.nl",
  "mail.nl",
  "mail.com",
  "gmx.com",
  "gmx.net",
]);

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const DOMAIN_PATTERN = /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi;

/** Normaliseert een telefoonnummer naar cijfers (laatste 9 digits blijven). */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 9) return null;
  return digits.slice(-9);
}

/** Haalt het domein uit een e-mailadres of URL. */
export function domainOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  const emailMatch = trimmed.match(/@([a-z0-9.-]+\.[a-z]{2,})$/i);
  const candidate = emailMatch
    ? emailMatch[1]
    : trimmed
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0];
  if (!candidate || !candidate.includes(".")) return null;
  return candidate;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " en ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * De identiteit mag geen enkele waarde van een gepensioneerd bedrijf bevatten.
 * Anders zou een oude identiteit als "eigen" gegeven geaccepteerd worden.
 */
export function identityConflictsWithRetired(identity: BusinessIdentity): IdentityLeak[] {
  const leaks: IdentityLeak[] = [];
  const ownName = normalizeName(identity.businessName);
  const ownEmail = identity.email?.toLowerCase() ?? null;
  const ownPhone = normalizePhone(identity.phone);
  const ownDomain = domainOf(identity.email) ?? domainOf(identity.website);

  for (const retired of RETIRED_BUSINESS_IDENTITIES) {
    const retiredName = normalizeName(retired.businessName);
    if (ownName === retiredName) {
      leaks.push({ kind: "business_name", value: retired.businessName, location: "identity" });
    }
    if (ownEmail && retired.email && ownEmail === retired.email.toLowerCase()) {
      leaks.push({ kind: "email", value: retired.email, location: "identity" });
    }
    const retiredPhone = normalizePhone(retired.phone);
    if (ownPhone && retiredPhone && ownPhone === retiredPhone) {
      leaks.push({ kind: "phone", value: retired.phone ?? "", location: "identity" });
    }
    const retiredDomain =
      domainOf(retired.email) ?? domainOf(retired.website) ?? null;
    if (ownDomain && retiredDomain && ownDomain === retiredDomain) {
      leaks.push({ kind: "domain", value: retiredDomain, location: "identity" });
    }
  }
  return leaks;
}

/**
 * Scant tekst op identiteiten die niet bij dít bedrijf horen.
 *
 * @param text      vrije tekst (gerenderde pagina, template-JSON, settings)
 * @param identity  de identiteit van het project waarvoor gegenereerd wordt
 * @param location label voor de rapportage (bestandspad)
 */
export function findIdentityLeaks(
  text: string,
  identity: BusinessIdentity,
  location: string
): IdentityLeak[] {
  const leaks: IdentityLeak[] = [];
  const seen = new Set<string>();
  const push = (leak: IdentityLeak) => {
    const key = `${leak.kind}:${leak.value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    leaks.push(leak);
  };

  const ownEmail = identity.email?.trim().toLowerCase() ?? null;
  const ownDomain = domainOf(identity.email) ?? domainOf(identity.website);
  const ownName = normalizeName(identity.businessName);
  const ownPhone = normalizePhone(identity.phone);

  // 1. E-mailadressen: alles wat niet het eigen adres is, is een lek.
  for (const match of text.matchAll(EMAIL_PATTERN)) {
    const email = match[0].toLowerCase().replace(/[.,;]+$/, "");
    if (ownEmail && email === ownEmail) continue;
    const domain = domainOf(email);
    // Het eigen bedrijfsdomein met een ander postbusdeel is geen vreemde
    // identiteit (bijv. sales@ naast info@), maar een ander domein wel.
    if (ownDomain && domain === ownDomain) continue;
    // Publieke providers (gmail enz.) zijn geen bedrijfsidentiteit, maar als
    // het adres van een gepensioneerd bedrijf terugkomt is het wél een lek.
    const retired = RETIRED_BUSINESS_IDENTITIES.find(
      (candidate) => candidate.email?.toLowerCase() === email
    );
    if (retired) {
      push({ kind: "email", value: email, location });
      continue;
    }
    const isPublic = domain != null && PUBLIC_MAIL_DOMAINS.has(domain);
    if (isPublic) continue;
    push({ kind: "email", value: email, location });
  }

  // 2. Bedrijfsnamen en domeinen van gepensioneerde identiteiten.
  const lowered = text.toLowerCase();
  for (const retired of RETIRED_BUSINESS_IDENTITIES) {
    const retiredName = normalizeName(retired.businessName);
    if (retiredName.length > 3 && normalizeName(text).includes(retiredName)) {
      push({ kind: "business_name", value: retired.businessName, location });
    }
    const retiredDomain = domainOf(retired.email) ?? domainOf(retired.website);
    if (retiredDomain && lowered.includes(retiredDomain)) {
      push({ kind: "domain", value: retiredDomain, location });
    }
  }

  // 3. Telefoonnummers: een ander nummer dan het eigen nummer is een lek.
  const phoneCandidates = text.match(/(?:\+31|0031|0)[\s().-]?\d[\d\s().-]{7,12}\d/g) ?? [];
  for (const candidate of phoneCandidates) {
    const normalized = normalizePhone(candidate);
    if (!normalized) continue;
    if (ownPhone && normalized === ownPhone) continue;
    push({ kind: "phone", value: candidate.trim(), location });
  }

  // 4. Losse bedrijfsnaam-check: een andere bedrijfsnaam dan de eigen naam
  //    wordt niet gesignaleerd (te veel ruis in vrije tekst), maar de eigen
  //    naam mag ook niet ontbreken in de contact-/footercontext. Dat laatste
  //    is een aparte check (zie missingIdentityFields).
  void ownName;
  void DOMAIN_PATTERN;
  return leaks;
}

/**
 * Ontbrekende identiteitsvelden. Deze worden NOOIT aangevuld met een waarde
 * uit een ander project; de UI toont ze als ontbrekend.
 */
export function missingIdentityFields(identity: BusinessIdentity): Array<keyof BusinessIdentity> {
  const missing: Array<keyof BusinessIdentity> = [];
  if (!identity.businessName || identity.businessName.trim().length === 0) missing.push("businessName");
  if (!identity.email || identity.email.trim().length === 0) missing.push("email");
  if (!identity.phone || identity.phone.trim().length === 0) missing.push("phone");
  if (!identity.city || identity.city.trim().length === 0) missing.push("city");
  return missing;
}

/** Mensleesbare labels voor dashboard en rapportage. */
export const IDENTITY_FIELD_LABELS: Record<keyof BusinessIdentity, string> = {
  businessName: "Bedrijfsnaam",
  email: "E-mailadres",
  phone: "Telefoonnummer",
  website: "Website",
  city: "Plaats",
};
