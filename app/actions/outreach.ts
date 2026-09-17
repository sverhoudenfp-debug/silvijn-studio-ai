"use server";

import { requireStudioOwner } from "@/lib/auth/server";


import { revalidatePath } from "next/cache";
import { OutreachService } from "@/lib/outreach/service";
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
