/**
 * Outreach-commando typen (Fase E) — één expliciete owner-opdracht per run.
 * Er bestaat geen andere entree: zonder commando-record geen outreach.
 */

export type OutreachCommandMode = "review" | "auto";

export interface OutreachCommandInput {
  ownerUserId: string;
  mode: OutreachCommandMode;
  requestedLimit: number;
  effectiveLimit: number;
  command: string;
}

export type OutreachLeadOutcome =
  | "draft_created" // review-modus: concept klaar voor menselijke review
  | "sent" // auto-modus: verzonden via de goedgekeurde provider
  | "quality_failed" // quality check niet geslaagd: draft blijft voor review
  | "skipped" // niet in aanmerking komend
  | "error"; // fout tijdens generatie/verzending

export interface OutreachCommandLeadSummary {
  leadId: string;
  businessName: string;
  leadStatus: string;
  outcome: OutreachLeadOutcome;
  detail?: string;
  draftId?: string;
}

export interface OutreachCommandSummary {
  leads: OutreachCommandLeadSummary[];
}

export interface OutreachCommandRecord {
  id: string;
  ownerUserId: string;
  command: string;
  mode: OutreachCommandMode;
  requestedLimit: number;
  effectiveLimit: number;
  status: "running" | "completed" | "failed";
  selectedLeads: number | null;
  draftsCreated: number | null;
  qualityFailed: number | null;
  sent: number | null;
  skipped: number | null;
  durationMs: number | null;
  selectedLeadIds: string[];
  summary: OutreachCommandSummary;
  errors: string[];
  startedAt: string;
  completedAt: string | null;
}

export interface OutreachCommandPatch {
  status: OutreachCommandRecord["status"];
  selectedLeads: number;
  selectedLeadIds: string[];
  draftsCreated: number;
  qualityFailed: number;
  sent: number;
  skipped: number;
  durationMs: number;
  summary: OutreachCommandSummary;
  errors: string[];
  completedAt: string;
}
