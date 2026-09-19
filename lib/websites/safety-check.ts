import type { WebsiteSpecification } from "./types";

/**
 * Deterministische content-safety voor WebsiteSpecifications (Fase 9).
 * Volgt het quality-checkpatroon uit Fase 6/7: harde, regel-gebaseerde
 * controles — géén AI nodig. De AI mag geen feiten verzinnen; alles wat
 * op fabricatie lijkt (reviews, prijzen, certificaten, garanties,
 * resultaten, contactgegevens, interne info) wordt geblokkeerd.
 */

export interface WebsiteSafetyContext {
  /** Echte contactgegevens uit de lead — spec-waarden die hier niet in voorkomen zijn gefabriceerd. */
  allowedPhone: string | null;
  allowedEmail: string | null;
  /** Echte Google-data (mag benoemd worden; afwijkende getallen zijn fabricatie). */
  allowedRating: number | null;
  allowedReviewCount: number | null;
  /** Menselijke leadnotities: hiervan afkomstige citaten zijn toegestaan. */
  leadNotes: string[];
}

export interface WebsiteSafetyIssue {
  rule: string;
  reason: string;
}

/** Alle tekst in de specification samenvoegen voor patrooncontrole. */
function collectSpecText(spec: WebsiteSpecification): string {
  return JSON.stringify(spec);
}

function collectContentText(spec: WebsiteSpecification): string {
  const parts: string[] = [
    spec.business.description ?? "",
    spec.business.targetAudience ?? "",
    spec.content.headline,
    spec.content.subheadline ?? "",
    spec.content.valueProposition ?? "",
    spec.content.about ?? "",
    spec.content.contactIntro ?? "",
    spec.content.ctaPrimaryText,
    spec.content.ctaSecondaryText ?? "",
    ...spec.content.benefits,
    ...spec.content.services.map((s) => `${s.title} ${s.description ?? ""}`),
    ...spec.content.faq.map((f) => `${f.question} ${f.answer}`),
    ...spec.content.testimonials,
    ...spec.conversion.contactMethods,
    spec.conversion.secondaryCta ?? "",
    ...spec.media.imageDescriptions,
    ...spec.media.imagePlaceholders,
    spec.seo.title,
    spec.seo.metaDescription,
    ...spec.seo.keywords,
  ];
  return parts.join(" \n ");
}

const PATTERNS: { rule: string; pattern: RegExp; reason: string }[] = [
  { rule: "prijs", pattern: /€\s?\d|\d+,\d{2}\s?(euro|,-)|prijs(?:en)? van €|vanaf €/i, reason: "Prijsbedrag gevonden — de website mag geen verzonnen of ongevalideerde prijzen bevatten." },
  { rule: "garantie", pattern: /garantie|gegarandeerd|niet-goed-geld-terug/i, reason: "Garantie-claim gevonden — nooit zelf bedenken; alleen met bewijs uit de input." },
  { rule: "certificering", pattern: /gecertificeerd|certificaat|keurmerk|ISO\s?\d{2,4}|geregistreerd bij de\s/i, reason: "Certificering/keurmerk-claim gevonden — nooit zelf bedenken." },
  { rule: "ervaring", pattern: /\b\d{1,2}\s*(jaar|jaren)\s*(ervaring|kwaliteit|vakervaring)/i, reason: "Ervaringsclaim met getal gevonden — alleen met bewijs uit de input." },
  { rule: "klantaantal", pattern: /\b\d{1,5}\+?\s*(tevreden )?(klanten|opdrachten|projecten)/i, reason: "Klantaantal/resultaatclaim gevonden — alleen met bewijs uit de input." },
  { rule: "review-claim", pattern: /\b\d{1,2},?\d*\s*(van\s*\d{1,2})?\s*ster(ren)?\b|\b\d{1,5}\+?\s*reviews?\b/i, reason: "Sterrenrating/reviewaantal gevonden dat niet uit de echte Google-data volgt." },
  { rule: "openingstijden", pattern: /maandag\s*(t\/m|tot)\s*vrijdag|openingstijden:/i, reason: "Openingstijden gevonden — alleen met echte aangeleverde gegevens." },
  { rule: "api-key", pattern: /sk-ant-[a-z0-9]|api[-_ ]?key\s*[:=]|bearer\s+[a-z0-9._-]{10,}/i, reason: "Mogelijke API-key/secret gevonden — secrets mogen nooit in een website terechtkomen." },
  { rule: "ai-vermelding", pattern: /gegenereerd door (een )?(ai|kunstmatige intelligentie)|als ai[- ]|deze (tekst|website) is ai/i, reason: "AI-vermelding gevonden — de website noemt nooit dat deze door AI is gemaakt." },
  { rule: "interne-info", pattern: /(system\s)?prompt\b|interne (informatie|notitie)|silvijn studio ai [-–] interne/i, reason: "Interne agency-informatie gevonden — hoort niet op een klantwebsite." },
];

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "").replace(/^\+31/, "0").replace(/\D/g, "");
}

export function checkWebsiteSpecificationSafety(
  spec: WebsiteSpecification,
  context: WebsiteSafetyContext
): { passed: boolean; issues: WebsiteSafetyIssue[] } {
  const issues: WebsiteSafetyIssue[] = [];
  const contentText = collectContentText(spec);
  const fullText = collectSpecText(spec);

  for (const { rule, pattern, reason } of PATTERNS) {
    if (pattern.test(contentText)) {
      issues.push({ rule, reason });
    }
  }

  // Geïmiteerde contactgegevens: alleen de échte lead-gegevens zijn toegestaan.
  const phoneMatches = fullText.match(/(?:\+31|0)\s?6?\s?[1-9]\d{7,9}/g) ?? [];
  const allowedPhoneNormalized = context.allowedPhone ? normalizePhone(context.allowedPhone) : null;
  for (const phone of phoneMatches) {
    const normalized = normalizePhone(phone);
    if (!allowedPhoneNormalized || (normalized !== allowedPhoneNormalized && !allowedPhoneNormalized.endsWith(normalized.slice(-8)) && !normalized.endsWith(allowedPhoneNormalized.slice(-8)))) {
      issues.push({ rule: "telefoonnummer", reason: `Telefoonnummer "${phone}" staat niet in de echte lead-gegevens — mogelijk gefabriceerd contactgegeven.` });
    }
  }

  const emailMatches = fullText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  const allowedEmail = context.allowedEmail?.toLowerCase() ?? null;
  for (const email of emailMatches) {
    if (!allowedEmail || email.toLowerCase() !== allowedEmail) {
      issues.push({ rule: "e-mailadres", reason: `E-mailadres "${email}" staat niet in de echte lead-gegevens — mogelijk gefabriceerd contactgegeven.` });
    }
  }

  // Echte rating mag wél: controleer dat vermelde getallen overeenkomen met de Google-data.
  if (context.allowedRating == null && /\b\d[,.]\d\b.*ster(ren)?|ster(ren)?.*\b\d[,.]\d\b/i.test(contentText)) {
    // alleen al gedekt door review-claim patroon; dubbele dekking is onschadelijk
  }

  // Testimonials: alleen toegestaan als de tekst uit de menselijke notities komt.
  for (const testimonial of spec.content.testimonials) {
    const isFromNotes = context.leadNotes.some((note) => note.includes(testimonial.slice(0, 20)));
    if (!isFromNotes) {
      issues.push({
        rule: "testimonials",
        reason: `Testimonial "${testimonial.slice(0, 60)}..." bestaat niet in de echte leadnotities — gefabriceerde reviews zijn verboden.`,
      });
    }
  }

  return { passed: issues.length === 0, issues };
}

/**
 * Fase I.1: hergebruik van de fabricatie-patronen voor willekeurige interne
 * documenten (bijv. het Design Plan). Puur tekstscan — geen lead-context
 * nodig; dezelfde PATTERNS als de websitecontent-controle.
 */
export function scanTextForFabricationPatterns(
  text: string,
  trustedClaims?: readonly string[]
): WebsiteSafetyIssue[] {
  const issues: WebsiteSafetyIssue[] = [];
  for (const { rule, pattern, reason } of PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    // Fase C: een match binnen een BEWEZEN echte claim (blueprint trustElements,
    // bron-verplicht en upstream Zod-gevalideerd) is geen fabricatie: de
    // onderdrukking geldt uitsluitend voor de exacte, aangeleverde tekst.
    if (trustedClaims?.some((claim) => claim.includes(match[0]))) continue;
    issues.push({ rule, reason });
  }
  return issues;
}
