/**
 * Deterministische pre-send quality check voor sales-antwoorden (Fase 7).
 * Geen AI, geen repair-loops: vaste regels. Bij falen blijft de interactie
 * DRAFT en worden de issues bewaard en getoond.
 */

export interface SalesQualityCheckResult {
  passed: boolean;
  issues: string[];
}

export interface SalesQualityCheckOptions {
  /**
   * true in AI_MODE=mock: mock-output bevat per definitie TESTDATA-markeringen.
   * In live mode blijven die markeringen verboden.
   */
  allowMockMarkers?: boolean;
}

/** Verboden toezeggingen in een antwoord-concept. */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /€\s?\d+|\b\d+\s?euro\b/i,
  /\bkorting\b/i,
  /\bgarantie\b|\bgaranderen\b|\bwaarborg\b/i,
  /\bbelo(o|f)(ft|ven)?\b/i,
  /\bzeker (meer )?(klanten|omzet|aanvragen)\b/i,
  /\bcontract\b|\bovereenkomst\b|\balgemene voorwaarden\b/i,
  /\bjuridisch\b|\baansprakelijk\b/i,
  /namens Silvijn (persoonlijk )?(bevestigd|toegezegd)/i,
  /\bdeadline\b.*\bbinnen \d+/i,
];

const INTERNAL_PATTERNS: RegExp[] = [
  /\bsk-ant-[a-zA-Z0-9-]+/i,
  /\b(api[- ]?key|secret|token)\b\s*[:=]/i,
  /system prompt|systeemprompt|instructies? voor de (ai|agent)/i,
  /zod-schema|prompt-template/i,
];

export function checkSalesResponseQuality(
  draft: { response: string; suggestedNextAction: string },
  options?: SalesQualityCheckOptions
): SalesQualityCheckResult {
  const issues: string[] = [];
  const text = `${draft.response} ${draft.suggestedNextAction}`;

  if (!draft.response || draft.response.trim().length < 50) {
    issues.push("Antwoord ontbreekt of is te kort");
  }
  if (draft.response && draft.response.trim().length > 2500) {
    issues.push("Antwoord is te lang");
  }
  if (!draft.suggestedNextAction || draft.suggestedNextAction.trim().length < 10) {
    issues.push("Voorgestelde volgende actie ontbreekt");
  }

  if (/\{\{[^}]*\}\}|\[\[[^\]]*\]\]/.test(text)) {
    issues.push("Placeholder-tekst aangetroffen");
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) {
      issues.push("Verboden toezegging of prijsinfo in het antwoord-concept");
      break;
    }
  }

  const internalHit = INTERNAL_PATTERNS.find((pattern) => pattern.test(text));
  if (internalHit) issues.push("Interne of technische informatie aangetroffen");

  if (/\b(ai[- ]gegenereerd|als (een )?(ai|kunstmatige intelligentie)|namens de ai|chatgpt|claude)\b/i.test(text)) {
    issues.push("AI-vermelding richting de klant is niet toegestaan");
  }
  if (/\b(lorem ipsum|voorbeeldtekst|todo)\b/i.test(text)) {
    issues.push("Test- of mocktekst aangetroffen");
  }
  if (!options?.allowMockMarkers && /\b(testdata|mock)\b/i.test(text)) {
    issues.push("Test- of mocktekst aangetroffen");
  }

  return { passed: issues.length === 0, issues };
}
