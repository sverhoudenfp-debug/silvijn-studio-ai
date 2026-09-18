"use server";

import { requireStudioOwner } from "@/lib/auth/server";


import { revalidatePath } from "next/cache";
import { OutreachService } from "@/lib/outreach/service";
import { OutreachOrchestrator } from "@/lib/outreach/orchestrator";
import { findDueFollowups, processDueFollowups } from "@/lib/outreach/followups";
import type { OutreachDraft, OutreachGenerationResult } from "@/lib/outreach/types";

/**
 * Server actions — de enige entree naar de outreach-engine vanuit de UI.
 * Elke actie is expliciet en gecontroleerd; er bestaat geen verzend-actie
 * in Fase 6.
 */

export async function listOutreachDrafts(leadId: string): Promise<OutreachDraft[]> {
  await requireStudioOwner();
  const service = new OutreachService();
  return service.listByLead(leadId);
}

export async function generateOutreachDraft(leadId: string): Promise<OutreachGenerationResult> {
  await requireStudioOwner();
  const service = new OutreachService();
  const result = await service.generateDraftForLead(leadId);
  revalidatePath("/outreach");
  return result;
}

export async function approveOutreachDraft(draftId: string): Promise<OutreachDraft> {
  await requireStudioOwner();
  const service = new OutreachService();
  const draft = await service.updateDraftStatus(draftId, "approved");
  revalidatePath("/outreach");
  return draft;
}

export async function cancelOutreachDraft(draftId: string): Promise<OutreachDraft> {
  await requireStudioOwner();
  const service = new OutreachService();
  const draft = await service.updateDraftStatus(draftId, "cancelled");
  revalidatePath("/outreach");
  return draft;
}

/**
 * Verzenden bestaat uitsluitend als expliciete eigenaarsactie via Gmail
 * (zie app/actions/gmail.ts → sendApprovedOutreachDraft). Er is géén
 * automatische/autonome verzendweg; deze stub is vervangen door die actie.
 */

/**
 * Fase E — outreach-orchestratie. Outreach start uitsluitend via deze
 * expliciete owner-opdrachten; discovery kan deze acties nooit aanroepen.
 * mode review = bestaande menselijke review-flow per draft;
 * mode auto = autonoom verzenden binnen de expliciete opdracht (begrensd).
 */

export async function startOutreachCampaignAction(input: {
  mode: "review" | "auto";
  limit: number;
}): Promise<{ ok: true; sent: number; draftsCreated: number; errors: string[] }> {
  await requireStudioOwner();
  const { user } = await requireStudioOwner();
  const orchestrator = new OutreachOrchestrator();
  const result = await orchestrator.runCommand({
    ownerUserId: user.id,
    mode: input.mode,
    limit: input.limit,
  });
  revalidatePath("/outreach");
  revalidatePath("/leads");
  revalidatePath("/conversations");
  return {
    ok: true as const,
    sent: result.command.sent ?? 0,
    draftsCreated: result.command.draftsCreated ?? 0,
    errors: result.command.errors,
  };
}

export async function processDueFollowupsAction(input: {
  mode: "review" | "auto";
  limit?: number;
}): Promise<{ ok: true; dueCount: number; sentFollowups: number; errors: string[] }> {
  await requireStudioOwner();
  const result = await processDueFollowups({ mode: input.mode, limit: input.limit });
  revalidatePath("/outreach");
  revalidatePath("/leads");
  revalidatePath("/conversations");
  return { ok: true as const, dueCount: result.dueCount, sentFollowups: result.sentFollowups, errors: result.errors };
}

export async function getDueFollowupsAction(): Promise<
  { leadId: string; businessName: string; sentFollowups: number }[]
> {
  await requireStudioOwner();
  return (await findDueFollowups()).map((d) => ({
    leadId: d.leadId,
    businessName: d.businessName,
    sentFollowups: d.sentFollowups,
  }));
}
