import type { ProjectRequirements } from "@/lib/projects/types";
import type { QuestionnaireQuestion } from "@/lib/questionnaire/validation";
import type { QuestionnaireResponseLike } from "@/lib/questionnaire/summary";
import type { DesignPlan } from "../design-plan";

/**
 * CONTENT SOURCE BUNDLE (C3a, 2026-09-20) — de deterministische bronbundel
 * voor de ContentPass (C3: Content Intelligence).
 *
 * ARCHITECTUUR: de bronassemblage is 100% DETERMINISTISCH — géén AI raakt
 * deze module. De latere AI-content-pass (C3b) krijgt uitsluitend deze
 * bundel als input; elk bronitem draagt zijn herkomst zodat de policy-pass
 * (C3c) per content-unit kan afdwingen wat eruit mag.
 *
 * Bronnen (afgesloten verzameling, C3-ontwerp §4):
 * - lead            — bedrijfsnaam, branche, adres, contact, Google-data
 * - qualification   — qualification-notities van de eigenaar
 * - questionnaire   — antwoorden uit BEIDE rondes (incl. follow-upronde),
 *                     met identieke semantics als de Design Planning-
 *                     consumptie (buildQuestionnaireAnswerLines, 5826edc):
 *                     nieuwste niet-lege antwoord wint, uploads als aantallen
 * - requirements    — scope + de copywriting-vlag (bepalend voor C3c)
 * - design_plan     — doelen, doelgroep, toon, CTA-strategie, ontbrekende
 *                     informatie uit het plan zelf
 * - blueprint       — pagina's, sectie-instanties, contentHints, trustElements
 *                     (bron-verplicht, upstream Zod-gevalideerd) en het
 *                     conversionPlan
 *
 * FINGERPRINT: FNV-1a-64 over de canonieke serialisatie van de items —
 * uitsluitend bedoeld om te detecteren of bronnen zijn gewijzigd sinds de
 * laatste ContentPlan-pass (versioning/her-generatie). Geen cryptografische
 * functie; bewust puur TS (BigInt) zodat de module overal laadt.
 *
 * HARD REGELS:
 * - Geen enkele AI of netwerkcall in deze module.
 * - trustedClaims = de verbatim teksten die de fabricatie-scan (C3c) als
 *   bewezen echt beschouwt: lead-feiten, questionnaire-antwoorden en
 *   blueprint trustElements. Verbatim-in-bron = vertrouwd (patroon 5826edc).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const CONTENT_SOURCE_ORIGINS = [
  "lead",
  "qualification",
  "questionnaire",
  "requirements",
  "design_plan",
  "blueprint",
] as const;

export type ContentSourceOrigin = (typeof CONTENT_SOURCE_ORIGINS)[number];

export interface ContentSourceItem {
  /** Herkomst van dit item — afgesloten enum, verplicht (provenance). */
  origin: ContentSourceOrigin;
  /**
   * Stabiele, deterministische sleutel, bijv. "lead:businessName",
   * "questionnaire:<vraagId>", "blueprint:trust:usps:0".
   */
  key: string;
  /** De feitelijke tekst (verbatim grondslag voor de evidence-checks). */
  text: string;
}

export interface ContentSourceBundle {
  /** Bundle-structuurversie (bumpen bij structurele wijzigingen van de bronnen). */
  version: 1;
  /** Alle bronitems, gesorteerd op (origin, key) — canoniek en stabiel. */
  items: readonly ContentSourceItem[];
  /**
   * Fingerprint over de canonieke serialisatie: verandert zodra één bronitem
   * verandert (her-generatie-detectie, zie C3-ontwerp §8).
   */
  fingerprint: string;
  /** Verbatim vertrouwde teksten voor de latere fabricatie-scan (C3c). */
  trustedClaims: readonly string[];
}

export interface LeadSourceInput {
  businessName: string;
  industry: string;
  address: string | null;
  city: string;
  province: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  websiteStatus: string;
  googleRating: number | null;
  reviewCount: number | null;
}

export interface QuestionnaireSourceInput {
  questions: QuestionnaireQuestion[];
  followUpQuestions: QuestionnaireQuestion[];
  responses: QuestionnaireResponseLike[];
}

export interface ContentSourceInput {
  lead: LeadSourceInput;
  /** Qualification-notities van de eigenaar (eigen herkomst i.p.v. lead-notities). */
  qualificationNotes: string[];
  questionnaire: QuestionnaireSourceInput | null;
  requirements: ProjectRequirements;
  designPlan: DesignPlan;
}

// ---------------------------------------------------------------------------
// Canonieke serialisatie + fingerprint (puur, geen imports)
// ---------------------------------------------------------------------------

const UNIT_SEP = "\u001f";

/**
 * FNV-1a-64 over de volledige UTF-16 code units (twee bytes per unit, zodat
 * onderscheid in hoge bits nooit verloren gaat), geemuleerd met twee 32-bit
 * helften — geen BigInt (spareert het bestaande tsconfig-target) en
 * deterministisch op elk platform. Uitsluitend voor fingerprint-doeleinden.
 */
function fnv1a64(input: string): string {
  // prime = 2^40 + 0x1b3; offset-basis 0xcbf29ce484222325
  const PRIME_LOW = 0x1b3;
  let hi = 0xcbf29ce4 >>> 0;
  let lo = 0x84222325 >>> 0;
  for (let i = 0; i < input.length; i++) {
    const codeUnit = input.charCodeAt(i);
    for (const byte of [codeUnit & 0xff, codeUnit >>> 8]) {
      lo = (lo ^ byte) >>> 0;
      // 64-bit vermenigvuldiging (hi:lo) * prime, mod 2^64
      const mulLow = Math.imul(lo, PRIME_LOW) >>> 0; // lo * 0x1b3 mod 2^32
      const mulLowCarry = Math.floor((lo * PRIME_LOW) / 0x100000000); // < 2^9
      const hiMul = (hi * PRIME_LOW) % 0x100000000; // hi * 0x1b3 mod 2^32
      const loShift = ((lo & 0xffffff) << 8) >>> 0; // lo * 2^40 (hi-deel)
      lo = mulLow;
      hi = (hiMul + mulLowCarry + loShift) >>> 0;
    }
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

/**
 * Fingerprint over een willekeurige item-verzameling: canoniek gesorteerd op
 * (origin, key, text) en veldsgewijs geserialiseerd. Item-volgorde in de
 * input beïnvloedt de fingerprint NIET — alleen inhoud telt.
 */
export function computeContentSourceFingerprint(items: readonly ContentSourceItem[]): string {
  const canonical = [...items]
    .map((item) => `${item.origin}${UNIT_SEP}${item.key}${UNIT_SEP}${item.text}`)
    .sort()
    .join("\n");
  return fnv1a64(canonical);
}

// ---------------------------------------------------------------------------
// Per-bron assemblage
// ---------------------------------------------------------------------------

function pushItem(items: ContentSourceItem[], origin: ContentSourceOrigin, key: string, text: string | null | undefined): void {
  if (text == null) return;
  const trimmed = text.trim();
  if (trimmed.length === 0) return;
  items.push({ origin, key, text: trimmed.slice(0, 600) });
}

/** Leid-feiten: bedrijfsnaam, branche, locatie, contact en Google-data. */
function assembleLeadItems(lead: LeadSourceInput, items: ContentSourceItem[]): void {
  pushItem(items, "lead", "businessName", lead.businessName);
  pushItem(items, "lead", "industry", lead.industry);
  pushItem(items, "lead", "location", [lead.address, lead.city, lead.province].filter((p) => p && p.trim().length > 0).join(", "));
  pushItem(items, "lead", "phone", lead.phone);
  pushItem(items, "lead", "email", lead.email);
  pushItem(items, "lead", "website", lead.website);
  pushItem(items, "lead", "websiteStatus", lead.websiteStatus);
  if (lead.googleRating != null) {
    pushItem(items, "lead", "googleRating", `Google-rating: ${lead.googleRating} (${lead.reviewCount ?? 0} reviews — echte data)`);
  }
}

/**
 * Questionnaire-items: antwoorden uit BEIDE rondes per vraag-id, met exact
 * dezelfde semantics als buildQuestionnaireAnswerLines (5826edc):
 * - alle vragen (kern + follow-up) in volgorde, elk id één keer;
 * - nieuwste niet-lege antwoord wint over de rondes heen;
 * - geüploade bestanden worden als aantallen zichtbaar.
 *
 * Sleutel = "questionnaire:<vraagId>" zodat her-generatie stabiele keys heeft
 * (de label-tekst kan in een nieuwe versie anders zijn; het id is stabiel).
 */
export function assembleQuestionnaireItems(input: QuestionnaireSourceInput): ContentSourceItem[] {
  const items: ContentSourceItem[] = [];
  const ordered = [...input.responses].sort((a, b) => a.round - b.round);
  const seen = new Set<string>();

  for (const question of [...input.questions, ...input.followUpQuestions]) {
    if (seen.has(question.id)) continue;
    seen.add(question.id);

    let value: string | null = null;
    let uploadCount = 0;
    for (const response of ordered) {
      const answer = response.answers[question.id];
      if (answer != null && answer.trim().length > 0) value = answer.trim();
      const uploads = (response.uploads ?? []).filter((u) => u.questionId === question.id).length;
      if (uploads > 0) uploadCount = uploads;
    }
    if (value == null && uploadCount === 0) continue;

    const uploadNote = uploadCount > 0 ? ` [${uploadCount} bestand(en) geüpload]` : "";
    const text = `${question.label.slice(0, 120)}: ${(value ?? "(alleen bestanden geüpload)").slice(0, 300)}${uploadNote}`;
    pushItem(items, "questionnaire", question.id, text);
  }
  return items;
}

/** Requirements-items: scope + de copywriting-vlag (sleutel voor C3c). */
function assembleRequirementsItems(requirements: ProjectRequirements, items: ContentSourceItem[]): void {
  pushItem(items, "requirements", "websiteType", requirements.websiteType);
  if (requirements.numberOfPages != null) {
    pushItem(items, "requirements", "numberOfPages", `${requirements.numberOfPages} pagina's`);
  }
  pushItem(items, "requirements", "designLevel", requirements.designLevel);
  if (requirements.ecommerce === true) pushItem(items, "requirements", "ecommerce", "e-commerce: ja");
  pushItem(items, "requirements", "customFunctionality", requirements.customFunctionality);
  if (requirements.integrations?.length) {
    pushItem(items, "requirements", "integrations", requirements.integrations.join(", "));
  }
  if (requirements.seo === true) pushItem(items, "requirements", "seo", "SEO: ja");
  if (typeof requirements.copywriting === "boolean") {
    pushItem(
      items,
      "requirements",
      "copywriting",
      requirements.copywriting
        ? "Tekstschrijving: te verzorgen door de studio (copywriting=true)"
        : "Tekstschrijving: klant levert zelf teksten aan (copywriting=false)"
    );
  }
  pushItem(items, "requirements", "deadline", requirements.deadline);
  pushItem(items, "requirements", "specialRequirements", requirements.specialRequirements);
  if (requirements.responsive === true) pushItem(items, "requirements", "responsive", "responsive: ja");
}

/** Design Plan-items: doelen, doelgroep, toon, CTA-strategie, ontbrekende informatie. */
function assembleDesignPlanItems(plan: DesignPlan, items: ContentSourceItem[]): void {
  pushItem(items, "design_plan", "goal:primary", plan.goals.primaryGoal);
  pushItem(items, "design_plan", "goal:conversion", plan.goals.conversionGoal);
  pushItem(items, "design_plan", "audience:primary", plan.audience.primaryAudience);
  pushItem(items, "design_plan", "audience:tone", plan.audience.toneOfVoice);
  pushItem(items, "design_plan", "branding:style", plan.branding.styleDirection);
  pushItem(items, "design_plan", "branding:mood", plan.branding.mood.length > 0 ? plan.branding.mood.join(", ") : null);
  pushItem(items, "design_plan", "branding:assets", plan.branding.existingBrandAssets);
  pushItem(items, "design_plan", "cta:primary", plan.ctaStrategy.primary);
  pushItem(items, "design_plan", "cta:secondary", plan.ctaStrategy.secondary);
  if (plan.ctaStrategy.leadCapture === true) {
    pushItem(items, "design_plan", "cta:leadCapture", "lead-capture vereist (contactformulier)");
  }
  pushItem(items, "design_plan", "imagery:style", plan.imagery.style);
  pushItem(items, "design_plan", "imagery:requirements", plan.imagery.requirements.length > 0 ? plan.imagery.requirements.join("; ") : null);
  for (const feature of plan.functionality.features) {
    pushItem(items, "design_plan", `feature:${feature.key}`, `${feature.description} [bron: ${feature.source}]`);
  }
  plan.missingInformation.forEach((missing, i) => {
    pushItem(items, "design_plan", `missing:${i}`, missing);
  });
}

/** Blueprint-items: conversieplan, pagina's, sectie-hints en trustElements. */
function assembleBlueprintItems(plan: DesignPlan, items: ContentSourceItem[]): void {
  const blueprint = plan.blueprint;
  if (!blueprint) return;

  pushItem(items, "blueprint", "conversion:primaryGoal", blueprint.conversionPlan.primaryGoal);
  if (blueprint.conversionPlan.leadCapture === true) {
    pushItem(items, "blueprint", "conversion:leadCapture", "leadCapture: true");
  }
  if (blueprint.conversionPlan.contactPreference) {
    pushItem(items, "blueprint", "conversion:contactPreference", `contactvoorkeur: ${blueprint.conversionPlan.contactPreference}`);
  }

  for (const page of blueprint.pages) {
    pushItem(items, "blueprint", `page:${page.key}`, [page.title, page.purpose].filter((p) => p && p.trim().length > 0).join(" — "));
    for (let i = 0; i < page.sectionInstances.length; i++) {
      const instance = page.sectionInstances[i];
      const hints = instance.blocks
        .map((block) => (block.hint ? `${block.kind}: ${block.hint}` : block.kind))
        .slice(0, 12)
        .join("; ");
      const text = [
        `sectie ${instance.type} (layout ${instance.layout})`,
        instance.contentHints ? `richting: ${instance.contentHints}` : null,
        hints ? `blokken: ${hints}` : null,
        instance.cta ? `CTA: ${instance.cta.label} -> ${instance.cta.target}` : null,
      ]
        .filter((p) => p !== null)
        .join(" | ");
      pushItem(items, "blueprint", `section:${page.key}/${i}`, text);
    }
  }

  const trust = blueprint.trustElements;
  trust.usps.forEach((usp, i) => {
    pushItem(items, "blueprint", `trust:usps:${i}`, `${usp.label} [bron: ${usp.source}]`);
  });
  trust.stats.forEach((stat, i) => {
    pushItem(items, "blueprint", `trust:stats:${i}`, `${stat.value} ${stat.label} [bron: ${stat.source}]`);
  });
  trust.badges.forEach((badge, i) => {
    pushItem(items, "blueprint", `trust:badges:${i}`, `${badge.label} [bron: ${badge.source}]`);
  });
}

// ---------------------------------------------------------------------------
// Hoofdentreé: de volledige bundel
// ---------------------------------------------------------------------------

/**
 * Bouwt de SourceBundle deterministisch. Volgorde van assembly is vast; de
 * items worden aan het eind canoniek gesorteerd zodat de fingerprint
 * stabiel is ongeacht toekomstige bron-uitbreidingen.
 */
export function assembleContentSourceBundle(input: ContentSourceInput): ContentSourceBundle {
  const items: ContentSourceItem[] = [];

  assembleLeadItems(input.lead, items);
  for (let i = 0; i < input.qualificationNotes.length; i++) {
    pushItem(items, "qualification", `note:${i}`, input.qualificationNotes[i]);
  }
  if (input.questionnaire) {
    items.push(...assembleQuestionnaireItems(input.questionnaire));
  }
  assembleRequirementsItems(input.requirements, items);
  assembleDesignPlanItems(input.designPlan, items);
  assembleBlueprintItems(input.designPlan, items);

  items.sort((a, b) => `${a.origin}${UNIT_SEP}${a.key}`.localeCompare(`${b.origin}${UNIT_SEP}${b.key}`));

  const deduplicated = items.filter((item, index) => {
    if (index === 0) return true;
    const previous = items[index - 1];
    return !(previous.origin === item.origin && previous.key === item.key && previous.text === item.text);
  });

  const trustedClaims = deduplicated
    .filter((item) => item.origin === "lead" || item.origin === "questionnaire" || item.key.startsWith("blueprint:trust:"))
    .map((item) => item.text);

  return {
    version: 1,
    items: deduplicated,
    fingerprint: computeContentSourceFingerprint(deduplicated),
    trustedClaims,
  };
}
