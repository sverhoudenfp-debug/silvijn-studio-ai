export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info";

export type LeadStatus =
  | "new"
  | "analyzing"
  | "qualified"
  | "contacted"
  | "interested"
  | "won"
  | "lost";

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
