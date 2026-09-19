import type { Lead } from "@/lib/types";
import type { Project } from "@/lib/projects/types";
import { WebsiteBuildService } from "@/lib/websites/build-service";
import { checkWebsiteSpecificationSafety } from "@/lib/websites/safety-check";
import { getWebsiteTemplateConfig, isWebsiteTemplateType } from "@/lib/websites/templates";
import { slugContainsPathTraversal } from "@/lib/websites/slug";
import type { GeneratedSectionData, GeneratedWebsite } from "@/lib/websites/types";
import type { QCCategory, QCCategoryCheck, QCIssue, IssueSeverity } from "./types";

/**
 * Deterministische QC-checks (Fase 10). Harde regels die codematig
 * betrouwbaar te controleren zijn, worden NIET door de AI beoordeeld —
 * de AI concentreert zich op content, UX, design, conversion en
 * business-consistentie (adviserend).
 *
 * Eerlijkheidsregel: wat niet echt gecontroleerd is, krijgt
 * NOT_CHECKED of een WARNING — er wordt nooit gedaan alsof er een
 * visuele browser-test of volledige WCAG-audit heeft plaatsgevonden.
 */

export interface DeterministicCheckInput {
  website: GeneratedWebsite;
  lead: Lead;
  project: Project;
}

export interface DeterministicCheckResult {
  checks: QCCategoryCheck[];
  issues: QCIssue[];
}

class IssueCollector {
  private issues: QCIssue[] = [];
  private counters: Partial<Record<QCCategory, number>> = {};

  add(category: QCCategory, severity: IssueSeverity, rule: string, message: string): QCIssue {
    this.counters[category] = (this.counters[category] ?? 0) + 1;
    const issue: QCIssue = {
      id: `${category}-${this.counters[category]}`,
      category,
      severity,
      rule,
      message,
    };
    this.issues.push(issue);
    return issue;
  }

  byCategory(category: QCCategory): QCIssue[] {
    return this.issues.filter((i) => i.category === category);
  }

  all(): QCIssue[] {
    return this.issues;
  }
}

/** Alle tekst in gegenereerde content (voor security-patroonscans). */
function collectSectionText(sections: GeneratedSectionData[]): string {
  return sections.map((s) => JSON.stringify(s.data)).join("\n");
}

export function runDeterministicChecks(input: DeterministicCheckInput): DeterministicCheckResult {
  const { website, lead, project } = input;
  const spec = website.specification;
  const content = website.generatedContent;
  const issues = new IssueCollector();
  const buildService = new WebsiteBuildService();

  // ============================================================
  // 1. TECHNICAL — build, componenten, structuur, navigatie
  // ============================================================
  const technicalNotes: string[] = [];
  if (website.buildStatus !== "passed") {
    issues.add("technical", "critical", "build_status", `Build-status is "${website.buildStatus}" — de website is niet geldig gebuild.`);
  }
  if (website.generationStatus !== "completed") {
    issues.add("technical", "critical", "generation_status", `Generatiestatus is "${website.generationStatus}" — de generatie is niet afgerond.`);
  }

  const specErrors = buildService.validateSpecification(spec);
  for (const error of specErrors) {
    issues.add("technical", "error", "specification", error);
  }
  if (specErrors.length === 0) technicalNotes.push("Specificatie valideert zonder fouten.");

  if (!content) {
    issues.add("technical", "critical", "generated_content", "Er is geen gegenereerde content — de website kan niet worden gerenderd.");
  } else {
    const contentErrors = buildService.validateContent(content);
    for (const error of contentErrors) {
      issues.add("technical", "error", "content_components", error);
    }
    // Duplicate sections
    const types = content.sections.map((s) => s.type);
    const duplicates = types.filter((t, i) => types.indexOf(t) !== i);
    if (duplicates.length > 0) {
      issues.add("technical", "error", "duplicate_sections", `Dubbele componenten: ${[...new Set(duplicates)].join(", ")}.`);
    }
    // Required components
    for (const required of ["header", "hero", "contact", "footer"] as const) {
      if (!types.includes(required)) {
        issues.add("technical", "critical", "missing_component", `Vereiste component "${required}" ontbreekt.`);
      }
    }
    // Routes/pages
    if (!spec.structure.pages.some((p) => p.key === "home")) {
      issues.add("technical", "warning", "missing_route", "Geen home-pagina in de structuur.");
    }
  }

  // Navigatie: niet leeg, geen lege labels, geen duplicates
  const navigation = spec.structure.navigation;
  if (navigation.length === 0) {
    issues.add("technical", "warning", "invalid_navigation", "Navigatie is leeg.");
  } else {
    if (new Set(navigation.map((n) => n.toLowerCase())).size !== navigation.length) {
      issues.add("technical", "warning", "invalid_navigation", "Dubbele navigatie-items.");
    }
    if (navigation.some((n) => !n.trim())) {
      issues.add("technical", "warning", "invalid_navigation", "Lege navigatie-labels.");
    }
  }

  // Interne links: preview-URL moet naar de eigen preview-route wijzen
  if (website.previewUrl !== `/generated-websites/${website.slug}`) {
    issues.add("technical", "error", "broken_internal_link", `Preview-URL "${website.previewUrl}" wijst niet naar de eigen preview-route.`);
  }

  // ============================================================
  // 2. SECURITY — secrets, code-executie, interne info, unsafe URLs
  // ============================================================
  const fullText = content ? collectSectionText(content.sections) : "";
  const specText = JSON.stringify(spec);

  const securityPatterns: { rule: string; pattern: RegExp; severity: IssueSeverity; message: string }[] = [
    { rule: "api_key", pattern: /sk-ant-[a-z0-9]|api[-_ ]?key\s*[:=]|bearer\s+[a-z0-9._-]{10,}/i, severity: "critical", message: "Mogelijke API-key/secret in de websitecontent gevonden." },
    { rule: "code_execution", pattern: /\beval\s*\(|new\s+Function\s*\(|<script/i, severity: "critical", message: "Onveilige dynamische code-executie aanwezig (eval/Function/script)." },
    { rule: "internal_prompt", pattern: /(system\s)?prompt\b|je bent (de|een)\s+\w+-agent|instructie: /i, severity: "error", message: "Interne prompt/AI-instructies gelekt in de content." },
    { rule: "internal_agency", pattern: /silvijn studio ai [-–] interne|interne (informatie|notitie)/i, severity: "error", message: "Interne agency-informatie gevonden." },
    { rule: "unsafe_url", pattern: /javascript:|data:text\/html|vbscript:/i, severity: "critical", message: "Onveilig URL-schema (javascript:/data:text/html) gevonden." },
  ];
  for (const { rule, pattern, severity, message } of securityPatterns) {
    if (pattern.test(fullText) || pattern.test(specText)) {
      issues.add("security", severity, rule, message);
    }
  }
  if (slugContainsPathTraversal(website.slug)) {
    issues.add("security", "critical", "path_traversal", "Slug bevat onveilige tekens (path traversal-risico).");
  }
  // AI-vermeldingen richting bezoeker zijn een security/privacy-kwestie
  if (/gegenereerd door (een )?(ai|kunstmatige intelligentie)|als ai[- ]/i.test(fullText)) {
    issues.add("security", "error", "ai_mention", "De website noemt richting de bezoeker dat deze door AI is gemaakt.");
  }

  // ============================================================
  // 3. CONTENT — fabricaties, placeholders, ontbrekende informatie
  // ============================================================
  const safety = checkWebsiteSpecificationSafety(spec, {
    allowedPhone: lead.phone,
    allowedEmail: lead.email,
    allowedRating: lead.googleRating,
    allowedReviewCount: lead.reviewCount,
    leadNotes: lead.notes,
  });
  for (const issue of safety.issues) {
    issues.add("content", "error", `fabrication_${issue.rule}`, `Mogelijk gefabriceerde bedrijfsinformatie: ${issue.reason}`);
  }

  const contentText = [spec.content.headline, spec.content.subheadline, spec.content.about, spec.content.valueProposition]
    .filter(Boolean)
    .join("\n");
  const placeholderCount = (contentText.match(/\[INFORMATIE ONBEKEND\]|TESTDATA/g) ?? []).length;
  if (placeholderCount > 0) {
    issues.add("content", "info", "missing_information", `${placeholderCount} expliciete placeholders — ontbrekende informatie is NIET als feit gepresenteerd (correct gedrag).`);
  }
  if (!spec.content.subheadline) {
    issues.add("content", "warning", "missing_content", "Geen subheadline — de hero geeft weinig context.");
  }
  if (!spec.content.about) {
    issues.add("content", "warning", "missing_content", "Geen 'over ons'-tekst — mist vertrouwen bij bezoekers.");
  }
  if (spec.content.services.some((s) => !s.description)) {
    issues.add("content", "warning", "missing_content", "Diensten zonder omschrijving — verduidelijk per dienst.");
  }

  // ============================================================
  // 4. BUSINESS ACCURACY — website vs. lead + project + requirements
  // ============================================================
  const nameMatch = spec.business.businessName.trim().toLowerCase() === lead.businessName.trim().toLowerCase();
  if (!nameMatch) {
    issues.add("business_accuracy", "critical", "business_name", `Bedrijfsnaam op de website ("${spec.business.businessName}") klopt niet met de lead ("${lead.businessName}").`);
  }
  if (spec.business.city.trim().toLowerCase() !== lead.city.trim().toLowerCase()) {
    issues.add("business_accuracy", "error", "city", `Plaats op de website ("${spec.business.city}") klopt niet met de lead ("${lead.city}").`);
  }
  if (spec.business.industry.trim().toLowerCase() !== lead.industry.trim().toLowerCase()) {
    issues.add("business_accuracy", "warning", "industry", `Branche op de website ("${spec.business.industry}") wijkt af van de lead ("${lead.industry}").`);
  }
  // Contactgegevens: aanwezig in content → moet exact de lead-data zijn
  const contactSection = content?.sections.find((s) => s.type === "contact")?.data as Record<string, unknown> | undefined;
  const contactPhone = typeof contactSection?.phone === "string" ? contactSection.phone : null;
  const contactEmail = typeof contactSection?.email === "string" ? contactSection.email : null;
  if (contactPhone && lead.phone && contactPhone.replace(/\D/g, "") !== lead.phone.replace(/\D/g, "")) {
    issues.add("business_accuracy", "error", "contact_details", `Telefoonnummer op de website (${contactPhone}) klopt niet met de lead-gegevens (${lead.phone}).`);
  }
  if (contactEmail && lead.email && contactEmail.toLowerCase() !== lead.email.toLowerCase()) {
    issues.add("business_accuracy", "error", "contact_details", `E-mailadres op de website (${contactEmail}) klopt niet met de lead-gegevens (${lead.email}).`);
  }
  // Afgesproken functionaliteit
  if (project.requirements.ecommerce === true && spec.conversion.leadCapture !== false) {
    // ecommerce vereist shop-functionaliteit die de huidige generator niet levert
    issues.add("business_accuracy", "error", "missing_requirement", "E-commerce is afgesproken in de requirements, maar de gegenereerde website bevat geen shop-functionaliteit.");
  }
  if (project.requirements.copywriting === false && placeholderCount > 0) {
    issues.add("business_accuracy", "warning", "missing_requirement", "Klant verzorgt de teksten, maar de website bevat placeholders die vervangen moeten worden.");
  }
  if (spec.missingInformation.length > 0) {
    issues.add("business_accuracy", "info", "missing_information", `${spec.missingInformation.length} informatiepunten zijn expliciet als MISSING_INFORMATION gemarkeerd — niet als feit gepresenteerd.`);
  }

  // ============================================================
  // 5. SEO — metadata, hiërarchie, lokale signalen (geen rankingclaims)
  // ============================================================
  const title = spec.seo.title.trim();
  if (title.length < 5 || title.length > 70) {
    issues.add("seo", "warning", "title_length", `SEO-titel heeft een suboptimale lengte (${title.length} tekens; 5-70 aanbevolen).`);
  }
  if (!title.toLowerCase().includes(lead.businessName.toLowerCase().split(" ")[0])) {
    issues.add("seo", "warning", "title_business", "SEO-titel bevat de bedrijfsnaam niet.");
  }
  if (!title.toLowerCase().includes(lead.city.toLowerCase())) {
    issues.add("seo", "warning", "title_local", "SEO-titel bevat de plaats niet — lokaal zoekverkeer mist signaal.");
  }
  if (spec.seo.keywords.length === 0) {
    issues.add("seo", "warning", "missing_metadata", "Geen SEO-keywords gedefinieerd.");
  }
  if (!spec.seo.localArea) {
    issues.add("seo", "warning", "missing_metadata", "Geen local area gedefinieerd.");
  }
  // Heading-hiërarchie: precies één h1 (hero-headline)
  if (content && content.sections.filter((s) => s.type === "hero").length !== 1) {
    issues.add("seo", "error", "heading_hierarchy", "De website moet precies één hero (h1) hebben.");
  }
  if (/op #?1 in google|pagina 1 van google|gegarandeerd.*google/i.test(fullText) || /op #?1 in google|pagina 1 van google/i.test(specText)) {
    issues.add("seo", "error", "ranking_claim", "Ongegronde Google-rankingclaim gevonden — QC kan ranking niet bewijzen en de claim is niet verifieerbaar.");
  }

  // ============================================================
  // 6. DESIGN — structurele consistentie (visueel oordeel doet de AI)
  // ============================================================
  if (!isWebsiteTemplateType(spec.template)) {
    issues.add("design", "error", "unknown_template", `Onbekend template "${String(spec.template)}".`);
  } else {
    const templateConfig = getWebsiteTemplateConfig(spec.template);
    if (content) {
      // Sectievolgorde moet de template-volgorde volgen
      const contentTypes = content.sections.map((s) => s.type);
      const expectedOrder = templateConfig.sectionOrder.filter((s) => contentTypes.includes(s as never));
      const actualOrder = contentTypes.filter((t) => templateConfig.sectionOrder.includes(t as never));
      if (JSON.stringify(expectedOrder) !== JSON.stringify(actualOrder)) {
        issues.add("design", "warning", "section_order", "Sectievolgorde wijkt af van de template-volgorde.");
      }
      // Consistente accentkleur-klassen binnen de gecontroleerde componenten
      const accents = new Set(
        content.sections
          .map((s) => (s.data as Record<string, unknown>)?.accent)
          .filter((a): a is string => typeof a === "string")
      );
      if (accents.size > 1) {
        issues.add("design", "warning", "consistent_styling", "Componenten gebruiken verschillende accentkleuren — styling is inconsistent.");
      }
    }
    // Hero-beeld: placeholder is verwacht, maar er moet een beschrijving zijn
    if (!spec.media.imageRequirements.some((r) => r.key === "hero")) {
      issues.add("design", "warning", "missing_media", "Geen hero-beeldvereiste gedefinieerd — de hero oogt leeg.");
    }
  }

  // ============================================================
  // 7. RESPONSIVE — STRUCTURAL CHECK; visuele test expliciet niet uitgevoerd
  // ============================================================
  if (content) {
    const structuralOk = content.sections.every(
      (s) => ["header", "hero", "services", "about", "benefits", "faq", "cta", "contact", "footer"].includes(s.type)
    );
    if (structuralOk) {
      // De gecontroleerde componentenbibliotheek is mobile-first en responsive BY CONSTRUCTION.
      issues.add("responsive", "info", "structural_check", "STRUCTURAL CHECK: alle componenten komen uit de mobile-first, responsive gecontroleerde bibliotheek (Tailwind grid/flex).");
    }
  }
  issues.add("responsive", "warning", "visual_check_not_performed", "VISUAL CHECK niet uitgevoerd: geen echte browser-/screenshot-test in deze fase — daadwerkelijke weergave op tablet/desktop is niet visueel geverifieerd.");

  // ============================================================
  // 8. CONVERSION — CTA, contact, logische opbouw
  // ============================================================
  if (!spec.content.ctaPrimaryText || spec.content.ctaPrimaryText.trim().length < 3) {
    issues.add("conversion", "error", "missing_cta", "Geen primaire call-to-action.");
  }
  if (content && !content.sections.some((s) => s.type === "contact")) {
    issues.add("conversion", "critical", "missing_contact", "Geen contactsectie — bezoekers kunnen niet reageren.");
  }
  if (spec.conversion.contactMethods.length === 0) {
    // Fix 2026-09-19: een aanwezig contactformulier (leadCapture=true) is een
    // geldige contactmethode. Telefoon/e-mail die ontbreekt blijft een warning,
    // maar is géén error/critical meer zodra het formulier bestaat.
    if (spec.conversion.leadCapture === true) {
      issues.add(
        "conversion",
        "warning",
        "no_contact_channels",
        "Telefoon/e-mail ontbreekt — het aanwezige contactformulier is op dit moment de enige contactmethode."
      );
    } else {
      issues.add("conversion", "error", "no_contact_methods", "Geen contactmethodes gedefinieerd.");
    }
  }
  if (spec.content.services.length === 0) {
    issues.add("conversion", "error", "no_services", "Geen diensten — de bezoeker begrijpt niet wat het bedrijf doet.");
  }
  if (spec.conversion.leadCapture !== true) {
    issues.add("conversion", "warning", "no_lead_capture", "Geen lead-capture (contactformulier) — conversie hangt alleen van telefonisch contact af.");
  }

  // ============================================================
  // 9. ACCESSIBILITY — structureel; volledige WCAG-audit expliciet NIET bewezen
  // ============================================================
  if (content) {
    if (content.sections.filter((s) => s.type === "hero").length !== 1) {
      issues.add("accessibility", "error", "heading_structure", "Heading-structuur onduidelijk: precies één h1 vereist.");
    }
    const navLabels = spec.structure.navigation.filter((n) => !n.trim());
    if (navLabels.length > 0) {
      issues.add("accessibility", "error", "link_labels", "Lege link-labels in de navigatie.");
    }
    if (spec.content.ctaPrimaryText.trim().length > 0 === false) {
      issues.add("accessibility", "error", "button_labels", "Lege button-labels.");
    }
    if (spec.media.imageRequirements.length === 0) {
      issues.add("accessibility", "warning", "alt_text", "Geen image-requirements — alt-teksten zijn niet gedefinieerd.");
    }
    if (spec.conversion.leadCapture === true) {
      issues.add("accessibility", "info", "form_labels", "Contactformulier is aanwezig in de gecontroleerde renderer (presentatie-only in deze fase; echte verzending komt in de delivery-fase).");
    }
    issues.add("accessibility", "info", "wcag_not_audited", "Volledige WCAG-compliance is NIET bewezen: kleurcontrast en keyboard-navigatie vereisen een echte audit (NOT_CHECKED).");
  }

  // ============================================================
  // Categorieën samenstellen
  // ============================================================
  const categories: QCCategory[] = [
    "technical",
    "content",
    "design",
    "responsive",
    "conversion",
    "seo",
    "accessibility",
    "security",
    "business_accuracy",
  ];
  const checks: QCCategoryCheck[] = categories.map((category) => {
    const categoryIssues = issues.byCategory(category);
    const hasCriticalOrError = categoryIssues.some((i) => i.severity === "error" || i.severity === "critical");
    const result = hasCriticalOrError
      ? "failed"
      : categoryIssues.some((i) => i.severity === "warning")
        ? "warning"
        : "passed";
    const notes = category === "technical" ? technicalNotes : [];
    return { category, result, issues: categoryIssues, notes };
  });

  return { checks, issues: issues.all() };
}
