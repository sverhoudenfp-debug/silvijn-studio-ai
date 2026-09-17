/**
 * Sales-domein types (Fase 7). De AI functioneert als EERSTE sales-assistent:
 * inkomende reacties analyseren, kwalificeren en een antwoord-CONCEPT
 * voorbereiden. Verzenden, prijzen en toezeggingen bestaan niet in deze fase.
 */

import type { ObjectionType, SalesIntent } from "@/lib/ai/types";

export type InboundChannel = "email" | "linkedin" | "phone" | "other";

export interface InboundMessage {
  contactId?: string | null;
  conversationId?: string | null;
  inReplyToOutreachId?: string | null;
  replyConfirmed?: boolean;
  providerMessageId?: string | null;
  providerAccountKey?: string | null;
  id: string;
  leadId: string;
  channel: InboundChannel;
  sender: string;
  subject: string;
  body: string;
  receivedAt: string;
  source: string; // bijv. "manual" (mock/dev) of later een echte provider-id
  createdAt: string;
  updatedAt: string;
}

export interface LeadQualification {
  status: "unqualified" | "qualifying" | "qualified" | "not_qualified" | "needs_human";
  interestLevel: "none" | "low" | "medium" | "high";
  projectType: string | null;
  needsWebsite: boolean;
  needsEcommerce: boolean;
  wantsDemo: boolean;
  wantsCall: boolean;
  timeline: string | null;
  budgetKnown: boolean;
  decisionMakerKnown: boolean;
  requirementsKnown: boolean;
  missingInformation: string[];
  qualificationNotes: string;
  confidence: number;
}

export type SalesInteractionStatus =
  | "draft" // analyse klaar, wacht op menselijke review
  | "ready_for_silvijn" // escalatie of expliciet gemarkeerd: menselijke beslissing nodig
  | "handled" // menselijk afgehandeld
  | "cancelled"; // verworpen

export interface SalesInteraction {
  id: string;
  leadId: string;
  inboundMessageId: string;
  intent: SalesIntent;
  objectionType: ObjectionType | "none";
  qualification: LeadQualification;
  responseDraft: string;
  suggestedNextAction: string;
  questions: string[];
  escalationRequired: boolean;
  escalationReason: string | null;
  status: SalesInteractionStatus;
  qualityIssues: string[];
  model: string;
  aiRunId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SalesAnalysisResult {
  interaction: SalesInteraction;
  model: string;
  mode: string;
  estimatedCost: number;
  durationMs: number;
  qualityPassed: boolean;
}
