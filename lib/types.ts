export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info";

export type LeadStatus = import("./leads/lifecycle").LeadLifecycleStatus;

export type WebsiteStatus = "no_website" | "has_website" | "website_poor" | "unknown";

export type OutreachStatus =
  | "not_contacted"
  | "draft"
  | "sent"
  | "opened"
  | "replied"
  | "interested"
  | "opted_out";

export type DemoStatus = "not_created" | "generating" | "ready" | "failed";

export type LeadSourceType = "mock" | "google" | "directory" | "manual" | "referral" | "other";

export type ScoreCategory = "Excellent" | "High" | "Medium" | "Low";

export interface LeadAiAnalysis {
  businessSummary: string;
  opportunity: string;
  potentialProblems: string;
  recommendedApproach: string;
}

export interface Lead {
  id: string;
  /** Additive enterprise identity; legacy leads remain null/unidentified. */
  kvkNumber?: string | null;
  establishmentNumber?: string | null;
  businessName: string;
  industry: string;
  address: string | null;
  postalCode: string | null;
  city: string;
  province: string;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  websiteStatus: WebsiteStatus;
  googleRating: number | null;
  reviewCount: number | null;
  leadScore: number;
  leadStatus: LeadStatus;
  outreachStatus: OutreachStatus;
  demoStatus: DemoStatus;
  source: LeadSourceType;
  notes: string[];
  aiAnalysis: LeadAiAnalysis | null;
  /** Extern ID van de discovery-bron (optioneel, voor duplicate-detectie). */
  externalId?: string | null;
  /** URL van de bronpagina waar de lead is gevonden (optioneel). */
  sourceUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RawBusiness {
  businessName: string;
  industry: string;
  city: string;
  province: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  websiteStatus: WebsiteStatus;
  googleRating: number | null;
  reviewCount: number | null;
  source: LeadSourceType;
}

export interface Kpi {
  label: string;
  value: string;
  delta: string;
}

export interface ActivityEntry {
  time: string;
  type: "search" | "check" | "score" | "demo" | "email" | "send" | "reply" | "qualify";
  message: string;
}

export interface PipelineStage {
  label: string;
  count: number;
}

export type DemoTemplate =
  | "local_service"
  | "professional_service"
  | "home_improvement"
  | "business_standard"
  /** G4: één-pagina-demo gerenderd uit ons eigen Shopify-thema (HTML opgeslagen). */
  | "theme_page";

export type DemoSource = "legacy_template" | "theme_page";

export type GenerationStatus = "idle" | "generating" | "completed" | "failed";

export interface DemoWebsite {
  id: string;
  leadId: string;
  slug: string;
  businessName: string;
  industry: string;
  city: string;
  template: DemoTemplate;
  status: DemoStatus;
  generationStatus: GenerationStatus;
  headline: string;
  description: string;
  services: string[];
  ctaText: string;
  notes: string;
  previewUrl: string;
  /** G4: herkomst van de demo. Legacy-demo's blijven het React-templatesysteem gebruiken. */
  source: DemoSource;
  /** SHA-256 van het opgeslagen HTML-document (alleen theme_page). */
  themeSha256: string | null;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
