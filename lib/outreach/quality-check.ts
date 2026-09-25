import type { OutreachDraftCreateInput } from "./repository";

/**
 * Deterministische pre-send quality check (Fase 6). Geen AI, geen loops:
 * een vaste lijst regels. Bij falen blijft de status DRAFT en worden de
 * issues getoond — er wordt NIET automatisch gerepareerd.
 */

export interface QualityCheckResult {
  passed: boolean;
  issues: string[];
}

export interface QualityCheckOptions {
  /**
   * true in AI_MODE=mock: mock-output bevat per definitie TESTDATA-markeringen
   * (Fase 6-eis). In live mode blijven die markeringen uiteraard verboden.
   */
  allowMockMarkers?: boolean;
  /**
   * true voor de eerste (koude) outreachmail: geen links/demo/prijs, kort en
   * persoonlijk, afsluiting alleen met een groetregel (de Gmail-handtekening
   * van het verzendende account wordt bij verzenden toegevoegd).
   */
  firstOutreach?: boolean;
}

/** Patronen die duidelijke ongefundeerde/fake claims markeren. */
const UNVERIFIED_CLAIM_PATTERNS: RegExp[] = [
  /(veel klanten (verliezen|verliest|kwijt))|((verliezen|verliest|verlies) veel klanten)/i,
  /(ik|wij) (hebben|hebben) jullie (gisteren|laatst|vorige week) (bezocht|gebeld)/i,
  /jullie concurrent(en)? (hebben|winnen|lopen) (op|voor)/i,
  /(verdienen|mis) (jullie|u) (maandelijks|elke maand|duizenden)/i,
];

/** Interne/technische info die nooit naar een klant mag. */
const INTERNAL_PATTERNS: RegExp[] = [
  /\bsk-ant-[a-zA-Z0-9-]+/i,
  /\b(api[- ]?key|secret|token)\b\s*[:=]/i,
  /system prompt|systeemprompt|instructies? voor de (ai|agent)/i,
  /cl[-a-z]*-[0-9]/i,
  /prompt|schema|zod-validatie/i,
];

export function checkOutreachQuality(
  draft: {
    subject: string;
    body: string;
    callToAction: string;
  },
  options?: QualityCheckOptions
): QualityCheckResult {
  const issues: string[] = [];
  const { subject, body, callToAction } = draft;

  // Basisvereisten
  if (!subject || subject.trim().length < 5) issues.push("Onderwerpregel ontbreekt of is te kort");
  if (!body || body.trim().length === 0) issues.push("E-mailtekst ontbreekt");
  if (body && body.trim().length < 150) issues.push("E-mailtekst is te kort");
  if (body && body.trim().length > 2500) issues.push("E-mailtekst is te lang");
  if (!callToAction || callToAction.trim().length < 10) issues.push("Call-to-action ontbreekt");

  // Placeholders die per ongeluk kunnen blijven staan
  if (/\{\{[^}]*\}\}|\[\[[^\]]*\]\]|<[a-z_]+>/.test(subject + body)) {
    issues.push("Placeholder-tekst aanwezig (bijv. {{naam}})");
  }

  // Verzonnen contactpersoon: er is geen contactpersoon bekend in de leaddata
  if (/\b(beste|geachte|hoi|dag)\s+(meneer|mevrouw|heer)\s+[A-Z]/i.test(body)) {
    issues.push("Mogelijk verzonnen contactpersoon — er is geen contactpersoon bekend");
  }

  // AI-vermeldingen richting klant
  if (/\b(ai[- ]gegenereerd|als (een )?(ai|kunstmatige intelligentie)|namens de ai|chatgpt|claude)\b/i.test(subject + body)) {
    issues.push("AI-vermelding richting de klant is niet toegestaan");
  }
  // Altijd verboden testtekst
  if (/\b(lorem ipsum|voorbeeldtekst|todo)\b/i.test(subject + body)) {
    issues.push("Test- of mocktekst aangetroffen");
  }
  // Expliciete TESTDATA/mock-markeringen: verboden in live mode;
  // in mock mode is duidelijke testdata per definitie verplicht.
  if (!options?.allowMockMarkers && /\b(testdata|mock)\b/i.test(subject + body)) {
    issues.push("Test- of mocktekst aangetroffen");
  }

  // Interne/technische informatie
  const internalHit = INTERNAL_PATTERNS.find((pattern) => pattern.test(subject + body));
  if (internalHit) issues.push("Interne of technische informatie aangetroffen");

  // Ongefundeerde claims
  const claimHit = UNVERIFIED_CLAIM_PATTERNS.find((pattern) => pattern.test(body));
  if (claimHit) issues.push("Mogelijk ongefundeerde claim — claims moeten uit de leaddata volgen");

  if (options?.firstOutreach) issues.push(...checkFirstOutreach(body));

  return { passed: issues.length === 0, issues };
}

/** Helper voor tests en service: check op basis van create-input. */
export function checkOutreachInputQuality(input: {
  subject: string;
  body: string;
  callToAction: string;
}): QualityCheckResult {
  return checkOutreachQuality(input);
}

export type { OutreachDraftCreateInput };

const URL_PATTERN = /https?:\/\/|www\.|\b[a-z0-9-]+\.(nl|com|be|eu|net|org|shop|store|io)\b/i;
const DEMO_LINK_PATTERN = /\b(demo|preview|voorbeeld)[- ]?(link|url|website|site|pagina)\b.*?(bekijk|bijgevoegd|hieronder|hierbij|zie)|(bekijk|zie|hieronder|hierbij|bijgevoegd).*?\b(demo|preview|voorbeeld)[- ]?(link|url|website|site|pagina)\b/i;
// "zonder kosten"/"gratis" is precies de gewenste formulering; alleen echte prijsindicaties zijn verboden.
const PRICE_PATTERN = /€|\beur(o)?\b|\bprijs\b|\bprijzen\b|\btarie(f|ven)\b|\bkorting\b|\bofferte\b|(?<!zonder |geen )\bkosten\b|\bkost\b/i;
const CLOSING_PATTERN = /groet(en)?[,.!]?$|hartelijk[,.!]?$|vriendelijke groet[,.!]?$/i;
const CONTACT_BLOCK_PATTERN = /(\+31|06[- ]?\d{8}|\b0\d{1,3}[- ]?\d{6,8}\b|@)/;

/** Deterministische regels voor de eerste (koude) outreachmail. */
export function checkFirstOutreach(body: string): string[] {
  const issues: string[] = [];
  const text = body.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words > 160) issues.push("Eerste mail is te lang (maximaal 160 woorden; doel is een reactie, geen uitleg)");
  if (URL_PATTERN.test(text)) issues.push("Eerste mail bevat een URL of link — geen demo-, preview- of websitelinks in de eerste mail");
  if (DEMO_LINK_PATTERN.test(text)) issues.push("Eerste mail verwijst naar een meegestuurde demo of preview — alleen het vrijblijvende aanbod is toegestaan");
  if (PRICE_PATTERN.test(text)) issues.push("Eerste mail noemt prijs of kosten — niet toegestaan");
  if (!/\bdemo\b|\bvoorbeeld(website|site)?\b/i.test(text)) {
    issues.push("Eerste mail mist de natuurlijke uitnodiging om vrijblijvend een gratis demo/voorbeeld te laten maken");
  }
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  if (!CLOSING_PATTERN.test(last)) {
    issues.push("Eerste mail moet eindigen met alleen een groetregel — geen naam, bedrijfsnaam of contactgegevens (Gmail-handtekening volgt automatisch)");
  }
  if (CONTACT_BLOCK_PATTERN.test(text)) issues.push("Eerste mail bevat contactgegevens (telefoon/e-mail) — die komen uit de Gmail-handtekening");
  return issues;
}
