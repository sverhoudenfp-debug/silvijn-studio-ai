import type { ContentPlan, ContentUnit } from "./content-plan";
import { auditClaims, type ClaimSummary } from "./claims";
import { pageBriefFor } from "./page-briefs";

/**
 * CONTENTKWALITEIT (W2, 2026-11-05) — de deterministische meetlat onder de
 * Content Engine.
 *
 * De AI schrijft; deze module beoordeelt. Zonder deze laag is "de content is
 * nu beter" een mening. Hier staan alleen controleerbare feiten:
 * - diepgang per pagina (lopende tekst, niet het aantal units),
 * - volledige FAQ-paren (geen lege accordions),
 * - geen placeholders of lege generated units,
 * - geen herhaling tussen pagina's (zelfde zinnen = één verhaal),
 * - claimveiligheid (F met bron, C leeg, G zonder bedrijfsfeiten),
 * - conversiedichtheid (niet na iedere sectie een CTA).
 *
 * Geen AI, geen netwerk, geen tijd: dezelfde input geeft altijd hetzelfde
 * oordeel.
 */

export type ContentIssueSeverity = "blocking" | "warning";

export interface ContentIssue {
  page: string;
  severity: ContentIssueSeverity;
  code: string;
  message: string;
}

export interface PageQuality {
  key: string;
  role: string;
  /** Woorden in daadwerkelijk gerenderde tekst (generated + fixed). */
  words: number;
  minWords: number;
  units: number;
  renderedUnits: number;
  emptyUnits: number;
  faqPairs: number;
  faqWithoutAnswer: number;
  gUnits: number;
  ctaSections: number;
}

export interface ContentQualityReport {
  ok: boolean;
  pages: readonly PageQuality[];
  issues: readonly ContentIssue[];
  claims: ClaimSummary;
  totals: { words: number; units: number; gUnits: number; faqPairs: number };
  /** Hoogste woordenaantal in een pagina die door de vloer zakt (0 = geen). */
  worstPage: { key: string; words: number; minWords: number } | null;
}

const PLACEHOLDER_PATTERNS: readonly { id: string; pattern: RegExp }[] = [
  { id: "voorbeeldtekst", pattern: /voorbeeldtekst|lorem ipsum|dummy[- ]?tekst/i },
  { id: "tbd", pattern: /\b(tbd|tbc|xxx+|nog invullen|placeholder|\[[^\]]{0,40}\])\b/i },
  { id: "leeg", pattern: /^\s*[.…-]*\s*$/ },
];

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;

function wordsIn(text: string): number {
  return (text.match(WORD_RE) ?? []).length;
}

/** Genormaliseerde zinnen (voor herhalingsdetectie). */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) =>
      sentence
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((sentence) => sentence.split(" ").length >= 5);
}

function renderedText(unit: ContentUnit): string {
  if (unit.status !== "generated" && unit.status !== "fixed") return "";
  return unit.text?.trim() ?? "";
}

/**
 * Aantal CTA-secties per pagina. Alleen betrouwbaar met de blueprint-telling;
 * zonder die telling (bijv. een losse plan-audit) wordt de check overgeslagen
 * in plaats van geraden — een hero heeft immers ook een cta_label.
 */
function countCtaSections(pageKey: string, blueprintCta?: ReadonlyMap<string, number>): number | null {
  if (!blueprintCta) return null;
  return blueprintCta.get(pageKey) ?? 0;
}

export interface ContentQualityInput {
  plan: ContentPlan;
  /** Aantal CTA-secties per paginaKey uit de blueprint (nauwkeuriger). */
  ctaSectionsByPage?: ReadonlyMap<string, number>;
  /** Minimale FAQ-paren per pagina met een FAQ-sectie. */
  minFaqPairs?: number;
  /** Maximale overeenkomst tussen pagina's (0-1). */
  maxOverlap?: number;
}

export function auditContentQuality(input: ContentQualityInput): ContentQualityReport {
  const { plan } = input;
  const minFaqPairs = input.minFaqPairs ?? 3;
  const maxOverlap = input.maxOverlap ?? 0.25;
  const issues: ContentIssue[] = [];
  const pages: PageQuality[] = [];

  let totalWords = 0;
  let totalUnits = 0;
  let totalFaq = 0;

  for (const page of plan.pages) {
    const brief = pageBriefFor(page.key);
    let words = 0;
    let rendered = 0;
    let empty = 0;
    let gUnits = 0;
    let faqPairs = 0;
    let faqWithoutAnswer = 0;

    const questions = new Map<string, string[]>();
    const answers = new Map<string, string[]>();
    for (const unit of page.units) {
      totalUnits += 1;
      const text = renderedText(unit);
      if (text.length > 0) {
        words += wordsIn(text);
        rendered += 1;
      } else if (unit.status === "generated" || unit.status === "fixed") {
        empty += 1;
        issues.push({
          page: page.key,
          severity: "blocking",
          code: "empty_unit",
          message: `${unit.path}/${unit.kind}: generated unit zonder tekst levert een leeg vlak.`,
        });
      }
      if (unit.claim === "G") gUnits += 1;

      if (text.length > 0) {
        for (const placeholder of PLACEHOLDER_PATTERNS) {
          if (placeholder.pattern.test(text)) {
            issues.push({
              page: page.key,
              severity: "blocking",
              code: `placeholder_${placeholder.id}`,
              message: `${unit.path}/${unit.kind}: placeholdertekst in de copy.`,
            });
          }
        }
      }

      if (unit.kind === "faq_question") {
        const list = questions.get(unit.path) ?? [];
        list.push(text);
        questions.set(unit.path, list);
      }
      if (unit.kind === "faq_answer") {
        const list = answers.get(unit.path) ?? [];
        list.push(text);
        answers.set(unit.path, list);
      }
    }

    // Vraag en antwoord horen bij elkaar op VOLGORDE binnen hetzelfde
    // sectiepad: de blokken in het thema staan in dezelfde volgorde.
    for (const [path, questionList] of questions) {
      const answerList = answers.get(path) ?? [];
      for (let index = 0; index < questionList.length; index += 1) {
        const question = questionList[index].trim();
        if (question.length === 0) continue;
        const answer = (answerList[index] ?? "").trim();
        if (answer.length < 40) {
          faqWithoutAnswer += 1;
          issues.push({
            page: page.key,
            severity: "blocking",
            code: "faq_answer_missing",
            message: `${path}: vraag "${question.slice(0, 60)}" heeft geen bruikbaar antwoord (min. 40 tekens).`,
          });
        }
      }
    }

    const askedQuestions = [...questions.values()].flat().filter((value) => value.trim().length > 0);
    faqPairs = askedQuestions.length;
    if (faqPairs > 0 && faqPairs < minFaqPairs) {
      issues.push({
        page: page.key,
        severity: "warning",
        code: "faq_too_few",
        message: `${page.key}: ${faqPairs} vraag-en-antwoordparen; onder de ${minFaqPairs} die een FAQ-pagina nodig heeft.`,
      });
    }

    if (words < brief.minWords) {
      const severity: ContentIssueSeverity = words < brief.minWords * 0.6 ? "blocking" : "warning";
      issues.push({
        page: page.key,
        severity,
        code: "depth",
        message: `${page.key} (${brief.role}): ${words} woorden lopende tekst, ondergrens ${brief.minWords}.`,
      });
    }

    const ctaSections = countCtaSections(page.key, input.ctaSectionsByPage);
    if (ctaSections !== null && ctaSections > 1) {
      issues.push({
        page: page.key,
        severity: "warning",
        code: "cta_density",
        message: `${page.key}: ${ctaSections} CTA-secties — één duidelijke vervolgstap is genoeg.`,
      });
    }

    totalWords += words;
    totalFaq += faqPairs;
    pages.push({
      key: page.key,
      role: brief.role,
      words,
      minWords: brief.minWords,
      units: page.units.length,
      renderedUnits: rendered,
      emptyUnits: empty,
      faqPairs,
      faqWithoutAnswer,
      gUnits,
      ctaSections: ctaSections ?? 0,
    });
  }

  // Herhaling tussen pagina's: gedeelde zinnen (genormaliseerd).
  const pageSentences = new Map<string, Set<string>>();
  for (const page of plan.pages) {
    const set = new Set<string>();
    for (const unit of page.units) {
      for (const sentence of sentences(renderedText(unit))) set.add(sentence);
    }
    pageSentences.set(page.key, set);
  }
  const keys = [...pageSentences.keys()];
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const a = pageSentences.get(keys[i])!;
      const b = pageSentences.get(keys[j])!;
      if (a.size === 0 || b.size === 0) continue;
      const shared = [...a].filter((sentence) => b.has(sentence));
      const ratio = shared.length / Math.min(a.size, b.size);
      if (ratio > maxOverlap) {
        issues.push({
          page: `${keys[i]}/${keys[j]}`,
          severity: "warning",
          code: "repetition",
          message: `${keys[i]} en ${keys[j]} delen ${(ratio * 100).toFixed(0)}% van hun zinnen — verdeel de inhoud over de pagina's.`,
        });
      }
    }
  }

  const claims = auditClaims(plan);
  for (const finding of claims.blocking) {
    issues.push({
      page: finding.page,
      severity: "blocking",
      code: finding.code,
      message: `${finding.path}: ${finding.message}`,
    });
  }

  const depthFailures = pages.filter((page) => page.words < page.minWords);
  const worst = depthFailures.sort((a, b) => a.words / a.minWords - b.words / b.minWords)[0] ?? null;

  return {
    ok: !issues.some((issue) => issue.severity === "blocking"),
    pages,
    issues,
    claims,
    totals: { words: totalWords, units: totalUnits, gUnits: pages.reduce((sum, page) => sum + page.gUnits, 0), faqPairs: totalFaq },
    worstPage: worst ? { key: worst.key, words: worst.words, minWords: worst.minWords } : null,
  };
}

/** Korte samenvatting voor logs/dashboard. */
export function summarizeQuality(report: ContentQualityReport): string {
  const blocking = report.issues.filter((issue) => issue.severity === "blocking").length;
  const warnings = report.issues.length - blocking;
  return `${report.totals.words} woorden over ${report.pages.length} pagina's · ${report.totals.faqPairs} FAQ-paren · F/C/G ${report.claims.totals.F}/${report.claims.totals.C}/${report.claims.totals.G} · ${blocking} blokkerend, ${warnings} waarschuwing`;
}
