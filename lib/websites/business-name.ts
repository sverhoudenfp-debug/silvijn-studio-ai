import type { WebsiteSpecification } from "./types";

/**
 * Bedrijfsnaam-trouw-guard (2026-09-19, A/B v3/v4-bevinding).
 *
 * Bevinding: de live websiteplanning-AI (claude-sonnet-5, temperature 0.4)
 * normaliseerde de exacte bedrijfsnaam "[TEST-FIXTURE] Studio Fictief
 * (Project→ZIP flow)" systematisch naar "Studio Fictief" (v3 én v4
 * identiek gereproduceerd; v1/v2 vóór die runs hielden de naam wél intact).
 * De deterministische QC-regel business_name (lib/qc/checks.ts) wees dat
 * terecht af als critical — de AI mag nooit de enige bron van de
 * bedrijfsnaam zijn.
 *
 * Deze module is de PUURE, deterministische post-AI-guard:
 * - de betrouwbare bronwaarde (lead.businessName uit de database) is
 *   ALLEEN autoriteit;
 * - bij elke mismatch (ingekort, genormaliseerd, vertaald, hoofdletter-
 *   wijziging, extra spaties) wordt de AI-waarde overschreven met de
 *   bronwaarde — verbatim, inclusief elke decoratie zoals een
 *   [TEST-FIXTURE]-prefix;
 * - de AI kan de naam NIET overschrijven; de guard overschrijft de AI;
 * - bij een exacte match is de specificatie byte-identiek (no-op).
 *
 * De guard muteert de specificatie in place (hetzelfde object blijft
 * geldig voor alle vervolgstappen: generator, build, QC, theme-ZIP).
 */
export interface TrustedBusinessNameResult {
  specification: WebsiteSpecification;
  /** true wanneer de AI-waarde afweek en is hersteld naar de bronwaarde. */
  corrected: boolean;
  /** De naam zoals de AI die opleverde (vóór herstel); null bij ontbrekend veld. */
  aiValue: string | null;
  /** De betrouwbare bronwaarde die in de specificatie staat ná de guard. */
  trustedValue: string;
}

export function enforceTrustedBusinessName(
  specification: WebsiteSpecification,
  trustedName: string
): TrustedBusinessNameResult {
  const aiValue = specification.business?.businessName ?? null;

  // Zonder betrouwbare bronwaarde kan niets worden afgedwongen; de
  // bestaande build-validatie (businessName verplicht, min. 2 tekens)
  // blijft dan de vangnet.
  if (!trustedName || typeof trustedName !== "string") {
    return { specification, corrected: false, aiValue, trustedValue: aiValue ?? "" };
  }

  if (aiValue === trustedName) {
    return { specification, corrected: false, aiValue, trustedValue: trustedName };
  }

  // MISMATCH (ingekort, genormaliseerd, vertaald, of helemaal afwezig):
  // de betrouwbare bronwaarde wint — verbatim, nooit de AI-versie.
  specification.business = { ...specification.business, businessName: trustedName };
  return { specification, corrected: true, aiValue, trustedValue: trustedName };
}
