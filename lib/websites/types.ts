/**
 * Website Generation-domein types (Fase 9).
 *
 * ARCHITECTUUR: AI plant de website als gestructureerde
 * WebsiteSpecification (Zod-gevalideerd) → de DETERMINISTISCHE generator
 * vertaalt die naar GeneratedWebsiteContent via vooraf gecontroleerde
 * componenten. De AI schrijft NOOIT rechtstreeks productiecode en er wordt
 * nooit AI-code uitgevoerd binnen de hoofdapplicatie.
 *
 * De AI verzint geen feiten: ontbrekende informatie wordt een expliciete
 * PLACEHOLDER of missing information — nooit verzonnen reviews, prijzen,
 * certificaten, garanties of contactgegevens.
 */

/** Gecontroleerde section-keys (canonieke bron voor schema, build-validatie én AI-contract). */
export const WEBSITE_SECTION_TYPES = [
  "header",
  "hero",
  "services",
  "about",
  "gallery",
  "testimonials",
  "benefits",
  "faq",
  "cta",
  "contact",
  "footer",
] as const;

export type WebsiteSectionType = (typeof WEBSITE_SECTION_TYPES)[number];

/** Templates — uitbreidbaar via de WebsiteTemplateRegistry. */
export type WebsiteTemplateType =
  | "local_service"
  | "professional_service"
  | "home_improvement"
  | "business_standard";

export type GeneratedWebsiteStatus =
  | "generating" // volledige generatie bezig (planning + build)
  | "generated" // content gegenereerd, wacht op build/validation
  | "building" // build/validation bezig
  | "ready_for_qc" // klaar voor quality control (Fase 10)
  | "qc_running" // quality control bezig
  | "ready_for_silvijn" // QC PASS — wacht op menselijke beoordeling door Silvijn
  | "needs_revision" // QC vond revisiepunten (of Silvijn vroeg revisie aan)
  | "approved" // door Silvijn goedgekeurd (delivery = latere fase)
  | "failed" // generatie, build of QC mislukt
  | "archived"; // superseded door nieuwere versie (bewaard, niets verwijderd)

export type WebsiteGenerationStatus =
  | "pending"
  | "planning"
  | "generating"
  | "validating"
  | "completed"
  | "failed";

export type WebsiteBuildStatus =
  | "not_built"
  | "building"
  | "passed"
  | "failed";

export interface SpecificationBusiness {
  businessName: string;
  industry: string;
  city: string;
  province: string | null;
  description: string | null;
  targetAudience: string | null;
}

export interface SpecificationBranding {
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  backgroundStyle: string | null;
  typographyStyle: string | null;
  visualStyle: string | null;
}

export interface SpecificationPage {
  /** Section-keys uit het template; leeg = alleen hero + contact. */
  key: string;
  title: string | null;
}

export interface SpecificationStructure {
  pages: SpecificationPage[];
  navigation: string[];
  sections: string[];
}

export interface SpecificationService {
  title: string;
  description: string | null;
}

export interface SpecificationFaqItem {
  question: string;
  answer: string;
}

export interface SpecificationContent {
  headline: string;
  subheadline: string | null;
  valueProposition: string | null;
  services: SpecificationService[];
  about: string | null;
  benefits: string[];
  faq: SpecificationFaqItem[];
  testimonials: string[]; // ALLEEN uit echte beschikbare data; anders leeg
  contactIntro: string | null;
  ctaPrimaryText: string;
  ctaSecondaryText: string | null;
}

export interface SpecificationConversion {
  primaryCta: string;
  secondaryCta: string | null;
  contactMethods: string[]; // alleen methodes met échte contactgegevens
  leadCapture: boolean;
}

export interface SpecificationMediaRequirement {
  key: string; // bijv. hero, services, team, local
  description: string;
  required: boolean;
}

export interface SpecificationMedia {
  imageRequirements: SpecificationMediaRequirement[];
  imageDescriptions: string[];
  imagePlaceholders: string[]; // placeholder-referenties; nooit echte bedrijfsfoto's
}

export interface SpecificationSeo {
  title: string;
  metaDescription: string;
  keywords: string[];
  localArea: string | null;
}

/**
 * De volledige AI-geplande websitespecificatie. Alles wat onbekend is,
 * is null of een expliciete placeholder — de AI gokt nooit.
 */
export interface WebsiteSpecification {
  template: WebsiteTemplateType;
  business: SpecificationBusiness;
  branding: SpecificationBranding;
  structure: SpecificationStructure;
  content: SpecificationContent;
  conversion: SpecificationConversion;
  media: SpecificationMedia;
  seo: SpecificationSeo;
  missingInformation: string[];
}

/**
 * Deterministisch gegenereerde content — gestructureerde data per section,
 * gerenderd door vooraf gecontroleerde React-componenten (géén vrije code).
 */
export interface GeneratedSectionData {
  type: WebsiteSectionType;
  data: Record<string, unknown>;
}

export interface GeneratedWebsiteContent {
  template: WebsiteTemplateType;
  branding: SpecificationBranding;
  sections: GeneratedSectionData[];
  seo: SpecificationSeo;
  missingInformation: string[];
}

export interface GeneratedWebsite {
  id: string;
  projectId: string;
  leadId: string;
  slug: string;
  businessName: string;
  status: GeneratedWebsiteStatus;
  generationStatus: WebsiteGenerationStatus;
  websiteType: WebsiteTemplateType;
  framework: "nextjs" | "shopify";
  template: WebsiteTemplateType;
  specification: WebsiteSpecification;
  generatedContent: GeneratedWebsiteContent | null;
  previewUrl: string;
  buildStatus: WebsiteBuildStatus;
  buildErrors: string[];
  generationNotes: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
