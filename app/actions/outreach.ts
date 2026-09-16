"use server";

import { revalidatePath } from "next/cache";
import { OutreachService } from "@/lib/outreach/service";
import type { OutreachDraft, OutreachGenerationResult } from "@/lib/outreach/types";

/**
 * Server actions — de enige entree naar de outreach-engine vanuit de UI.
 * Elke actie is expliciet en gecontroleerd; er bestaat geen verzend-actie
 * in Fase 6.
 */

export async function listOutreachDrafts(leadId: string): Promise<OutreachDraft[]> {
  const service = new OutreachService();
  return service.listByLead(leadId);
}

export async function generateOutreachDraft(leadId: string): Promise<OutreachGenerationResult> {
  const service = new OutreachService();
  const result = await service.generateDraftForLead(leadId);
  revalidatePath("/outreach");
  return result;
}

export async function approveOutreachDraft(draftId: string): Promise<OutreachDraft> {
  const service = new OutreachService();
  const draft = await service.updateDraftStatus(draftId, "approved");
  revalidatePath("/outreach");
  return draft;
}

export async function cancelOutreachDraft(draftId: string): Promise<OutreachDraft> {
  const service = new OutreachService();
  const draft = await service.updateDraftStatus(draftId, "cancelled");
  revalidatePath("/outreach");
  return draft;
}

/** Gereserveerd voor een latere fase — in Fase 6 bestaat er geen verzenden. */
export async function sendOutreachDraft(): Promise<never> {
  throw new Error("Verzenden is niet mogelijk in Fase 6 — e-mails worden nog niet verstuurd");
}
