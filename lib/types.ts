export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info";

export type LeadStatus =
  | "new"
  | "analyzing"
  | "scored"
  | "demo_ready"
  | "contacted"
  | "replied"
  | "interested"
  | "qualified"
  | "won"
  | "lost";

export interface Lead {
  id: string;
  name: string;
  category: string;
  location: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  leadScore: number;
  status: LeadStatus;
  hasDemo: boolean;
  lastActivity: string;
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

export interface RawBusiness {
  name: string;
  category: string;
  location: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  source: string;
}
