/**
 * Outreach-domein types (Fase 6). Een OutreachDraft is ALTIJD een concept:
 * Fase 6 stuurt nooit echte e-mails; "sent" is gereserveerd voor latere fases
 * met expliciete human approval.
 */

export type OutreachChannel = "email" | "linkedin" | "phone" | "other";

export type OutreachDraftStatus =
  | "draft" // gegenereerd, nog niet nagekeken (of quality check faalde)
  | "ready_for_review" // quality check geslaagd, wacht op menselijke review
  | "approved" // menselijk goedgekeurd — verzenden volgt in een latere fase
  | "sent" // gereserveerd voor latere fase; NOOIT automatisch gezet
  | "failed" // generatie of verwerking mislukt
  | "cancelled"; // menselijk geannuleerd

export interface OutreachDraft {
  contactId?: string | null;
  conversationId?: string | null;
  projectId?: string | null;
  priceApprovalId?: string | null;
  purpose?: "initial" | "followup" | "demo_offer" | "demo_link" | "price_offer" | "sales_reply";
  sentAt?: string | null;
  providerMessageId?: string | null;
  providerAccountKey?: string | null;

  id: string;
  leadId: string;
  channel: OutreachChannel;
  status: OutreachDraftStatus;
  subject: string;
  body: string;
  personalizationReason: string;
  callToAction: string;
  model: string;
  aiRunId?: string | null;
  /** Waarom de quality check faalde (leeg = geslaagd). */
  qualityIssues: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OutreachGenerationResult {
  draft: OutreachDraft;
  /** AI-metadata van deze generatie (model, mode, kosten). */
  model: string;
  mode: string;
  estimatedCost: number;
  durationMs: number;
  /** true = quality check geslaagd en draft staat ready_for_review. */
  qualityPassed: boolean;
}
