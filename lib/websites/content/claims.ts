import type { ContentPlan, ContentPlanPage, ContentUnit } from "./content-plan";

/**
 * CLAIMMODEL F / C / G (W2, 2026-11-05) — de drie contentcategorieën die
 * bepalen waar een tekst vandaan komt en wie hem goedkeurt.
 *
 * F — FEIT: een bedrijfsfeit dat in de bronnen staat (specificatie, lead,
 *     vragenlijst, notities). Altijd herleidbaar tot een bewijsvoering;
 *     nooit geformuleerd op basis van aannames.
 * C — KLANT: informatie die de klant zelf moet aanleveren. De unit blijft
 *     leeg (customer_slot) met een concrete instructie.
 * G — BRANCHE: algemene, branchegerichte tekst zonder bedrijfsspecifieke
 *     beweringen. Herkenbaar in het dashboard en pas live na menselijke
 *     goedkeuring (approvals.gContent in het plan).
 *
 * HARD: dit model is deterministisch. Geen AI, geen schattingen: patronen
 * en structuurregels, zodat een verkeerde categorie altijd zichtbaar wordt.
 * G-tekst die tóch een bedrijfsfeit claimt (aantal, garantie, prijs,
 * certificering, beoordeling) is een FABRICATIE en wordt geweigerd.
 */

export const CLAIM_CATEGORIES = ["F", "C", "G"] as const;
export type ClaimCategory = (typeof CLAIM_CATEGORIES)[number];

export const CLAIM_LABELS: Record<ClaimCategory, string> = {
  F: "feit (bron)",
  C: "klant levert aan",
  G: "branche (goedkeuring nodig)",
};

/**
 * Wat G-tekst nooit mag bevatten: bedrijfsfeiten die de studio niet kan
 * onderbouwen. Bewust streng — een onterecht geweigerde G-zin kost één
 * herschrijving, een onterecht doorgelaten claim kost een klant.
 */
export const G_FORBIDDEN_PATTERNS: readonly { id: string; pattern: RegExp; reason: string }[] = [
  { id: "cijfer", pattern: /\d/, reason: "een cijfer (aantallen, jaren, prijzen, percentages) is een bedrijfsfeit" },
  { id: "garantie", pattern: /\bgarantie\w*|\bgegarandeerd\b/i, reason: "garanties zijn bedrijfsfeiten" },
  // W3-LES (Veld & Vorm, 2026-11-05): "het beste starten" is een bijwoord,
  // geen claim. De regel vangt nu alleen superlatief-als-claim (de/ons/onze
  // beste) plus de onbetwist commerciële varianten.
  { id: "superlatief", pattern: /\b(de|ons|onze)\s+(beste|mooiste|grootste|hoogste)\b|\b(goedkoopste|snelste|numm?er\s?1|nummer\s?één|marktleider|toonaangevend)\b/i, reason: "superlatieven zijn onbewijsbare claims" },
  { id: "erkenning", pattern: /\b(bekroond|prijswinnaar|award|onderscheiden|genomineerd)\b/i, reason: "erkenningen en prijzen zijn bedrijfsfeiten" },
  { id: "certificering", pattern: /\b(gecertificeerd|certificering|certificaat|keurmerk|iso\s?\d+)\b/i, reason: "certificeringen en keurmerken zijn bedrijfsfeiten" },
  { id: "beoordeling", pattern: /\b(beoordeling|review|reviews|sterren|klantscore|waardering)\b/i, reason: "beoordelingen zijn bedrijfsfeiten" },
  { id: "prijs", pattern: /€|\beuro\b|\btarief\b|\bprijs\b|\bprijzen\b/i, reason: "prijzen en tarieven worden door de studio bepaald, niet door de branchetekst" },
  { id: "ervaring", pattern: /\b(jarenlange|jaren ervaring|\d+\s?jaar)\b/i, reason: "ervaringsjaren zijn bedrijfsfeiten" },
  { id: "klantaantal", pattern: /\b(honderden|duizenden|tientallen)\s+(klanten|projecten|opdrachten|tuinen)\b/i, reason: "klantaantallen zijn bedrijfsfeiten" },
  { id: "teamgrootte", pattern: /\bons team\b|\bons kantoor\b|\bwij hebben\b|\bwij werken met\b/i, reason: "een uitspraak over het eigen bedrijf is een F-claim, geen G-tekst" },
];

export interface ClaimIssue {
  code: string;
  message: string;
}

/** Is dit een bedrijfsfeit dat alleen met bron mag bestaan? */
export function isSourcedClaim(unit: ContentUnit): boolean {
  return unit.claim === "F" || unit.status === "fixed";
}

/**
 * Controleert één unit tegen het claimmodel. Retourneert uitsluitend
 * bevindingen; de aanroeper bepaalt of ze blokkeren (QA) of waarschuwen.
 */
export function claimIssues(unit: ContentUnit): ClaimIssue[] {
  const issues: ClaimIssue[] = [];
  const text = unit.text?.trim() ?? "";

  if (unit.status === "merchant_slot") {
    if (unit.claim != null) {
      issues.push({ code: "claim_merchant", message: "Een merchant_slot hoort geen claimcategorie te hebben." });
    }
    return issues;
  }

  if (unit.claim == null) {
    issues.push({
      code: "claim_missing",
      message: `Unit ${unit.path}/${unit.kind} heeft geen claimcategorie (F, C of G).`,
    });
    return issues;
  }

  if (unit.status === "customer_slot") {
    if (unit.claim !== "C") {
      issues.push({ code: "claim_customer", message: "Een customer_slot hoort categorie C te hebben." });
    }
    if (!unit.instruction || unit.instruction.trim().length < 10) {
      issues.push({ code: "claim_customer_instruction", message: "Een C-unit vereist een concrete instructie voor de klant." });
    }
    return issues;
  }

  if (unit.claim === "C") {
    issues.push({ code: "claim_c_with_text", message: "Categorie C hoort leeg te blijven tot de klant aanlevert." });
  }

  if (unit.claim === "F" && unit.evidence.length === 0) {
    issues.push({ code: "claim_f_evidence", message: "Een F-unit zonder bewijsvoering is een onbevestigd bedrijfsfeit." });
  }

  if (unit.claim === "G") {
    if (unit.evidence.length > 0) {
      issues.push({
        code: "claim_g_evidence",
        message: "Een G-unit hoort geen bedrijfsbewijs te dragen; gebruik dan F.",
      });
    }
    for (const rule of G_FORBIDDEN_PATTERNS) {
      if (rule.pattern.test(text)) {
        issues.push({ code: `claim_g_${rule.id}`, message: `G-tekst bevat ${rule.reason}.` });
      }
    }
  }

  if (unit.status === "generated" && text.length === 0) {
    issues.push({ code: "claim_empty", message: "Een generated unit zonder tekst levert een leeg vlak op de site." });
  }

  if (unit.status === "fixed" && unit.claim !== "F") {
    issues.push({ code: "claim_fixed_f", message: "Een fixed unit is per definitie een F-feit." });
  }

  return issues;
}

export interface ClaimSummary {
  readonly pages: readonly {
    key: string;
    F: number;
    C: number;
    G: number;
    issues: readonly ClaimIssue[];
  }[];
  readonly totals: { F: number; C: number; G: number };
  readonly gUnits: number;
  readonly gApproved: boolean;
  readonly blocking: readonly { page: string; path: string; code: string; message: string }[];
}

/** Volledige claim-audit van een plan (deterministisch, geen AI). */
export function auditClaims(plan: ContentPlan): ClaimSummary {
  const pages: ClaimSummary["pages"][number][] = [];
  const totals = { F: 0, C: 0, G: 0 };
  const blocking: { page: string; path: string; code: string; message: string }[] = [];

  for (const page of plan.pages) {
    const counts = { F: 0, C: 0, G: 0 };
    const issues: ClaimIssue[] = [];
    for (const unit of page.units) {
      if (unit.claim === "F" || unit.claim === "C" || unit.claim === "G") counts[unit.claim] += 1;
      const unitIssues = claimIssues(unit);
      for (const issue of unitIssues) {
        issues.push(issue);
        blocking.push({ page: page.key, path: unit.path, code: issue.code, message: issue.message });
      }
    }
    totals.F += counts.F;
    totals.C += counts.C;
    totals.G += counts.G;
    pages.push({ key: page.key, ...counts, issues });
  }

  return {
    pages,
    totals,
    gUnits: totals.G,
    gApproved: isGContentApproved(plan),
    blocking,
  };
}

/** Is de G-content van dit plan menselijk goedgekeurd? */
export function isGContentApproved(plan: ContentPlan): boolean {
  return plan.approvals?.gContent?.approvedAt != null;
}

/** Mag dit plan naar buiten (thema/levering)? G zonder goedkeuring niet. */
export function planReadyForDelivery(plan: ContentPlan): { ok: boolean; reason: string | null } {
  const audit = auditClaims(plan);
  if (audit.blocking.length > 0) {
    return { ok: false, reason: `${audit.blocking.length} claimbevinding(en) moeten eerst worden opgelost.` };
  }
  if (audit.gUnits > 0 && !audit.gApproved) {
    return { ok: false, reason: `${audit.gUnits} G-unit(s) wachten op menselijke goedkeuring.` };
  }
  return { ok: true, reason: null };
}

/**
 * Normaliseert ontbrekende categorieën voor plannen van vóór W2:
 * fixed → F, customer_slot → C, merchant_slot → null, generated met bewijs
 * → F. Een generated unit zonder bewijs blijft bewust onbevestigd (en wordt
 * door de audit geblokkeerd) — nooit stilzwijgend G maken.
 */
export function normalizeClaims(plan: ContentPlan): ContentPlan {
  const pages: ContentPlanPage[] = plan.pages.map((page) => ({
    ...page,
    units: page.units.map((unit) => {
      if (unit.claim != null) return unit;
      if (unit.status === "fixed") return { ...unit, claim: "F" as const };
      if (unit.status === "customer_slot") return { ...unit, claim: "C" as const };
      if (unit.status === "merchant_slot") return { ...unit, claim: null };
      if (unit.evidence.length > 0) return { ...unit, claim: "F" as const };
      return unit;
    }),
  }));
  return { ...plan, pages };
}
