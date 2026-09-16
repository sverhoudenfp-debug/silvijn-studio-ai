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
