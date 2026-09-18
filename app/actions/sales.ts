"use server";

import { requireStudioOwner } from "@/lib/auth/server";


import { revalidatePath } from "next/cache";
import { recordConfirmedReply } from "@/lib/sales/conversations";
import { getInboundMessageRepository, getSalesInteractionRepository } from "@/lib/sales/repository";
import { SalesService } from "@/lib/sales/service";
import { processPendingReplies, type ReplyPipelineResult } from "@/lib/sales/reply-pipeline";
import type { InboundMessage, SalesInteraction } from "@/lib/sales/types";

/**
 * Server actions — de enige entree naar de sales-engine vanuit de UI.
 * Elke actie is expliciet en gecontroleerd; er bestaat géén verzend-actie
 * en geen actie die prijzen of toezeggingen doet in Fase 7.
 */

export async function listInboundMessagesAction(leadId: string): Promise<InboundMessage[]> {
  await requireStudioOwner();
  return new SalesService().listInboundByLead(leadId);
}

export async function listSalesInteractionsAction(leadId: string): Promise<SalesInteraction[]> {
  await requireStudioOwner();
  return new SalesService().listInteractionsByLead(leadId);
}

export async function createInboundMessageAction(input: {
 leadId:string; sender:string; subject:string; body:string; receivedAt:string; requestId:string; confirmedReply:true; outreachId?:string|null; threadKey?:string;
}): Promise<InboundMessage> {
 await requireStudioOwner();
 const id=await recordConfirmedReply(input);
 const message=await getInboundMessageRepository().getById(id);
 if(!message) throw new Error("Recorded reply could not be loaded");
 revalidatePath("/sales"); revalidatePath("/conversations"); revalidatePath(`/leads/${input.leadId}`);
 return message;
}

export async function analyzeInboundMessageAction(leadId: string, inboundMessageId: string) {
  await requireStudioOwner();
  const result = await new SalesService().analyzeInboundMessage(leadId, inboundMessageId);
  revalidatePath("/sales");
  revalidatePath(`/leads/${leadId}`);
  return result;
}

export async function markReadyForSilvijnAction(interactionId: string): Promise<SalesInteraction> {
  await requireStudioOwner();
  const interaction = await new SalesService().markReadyForSilvijn(interactionId);
  revalidatePath("/sales");
  return interaction;
}

export async function markHandledAction(interactionId: string): Promise<SalesInteraction> {
  await requireStudioOwner();
  const interaction = await new SalesService().markHandled(interactionId);
  revalidatePath("/sales");
  return interaction;
}

/**
 * Fase E — reply-pipeline: de AI verwerkt nieuwe confirmed reacties en zet
 * het verkoopgesprek voort binnen de expliciete eigenaarsmodus.
 * review = antwoord-concepten voor menselijke review; auto = autonome
 * gespreksvoortzetting (opt-out stopt direct; prijs/prijsvoorstel blijft
 * uitsluitend menselijk).
 */
export async function processPendingRepliesAction(input: {
  mode: "review" | "auto";
  limit?: number;
}): Promise<ReplyPipelineResult> {
  await requireStudioOwner();
  const { user } = await requireStudioOwner();
  const result = await processPendingReplies({
    ownerUserId: user.id,
    mode: input.mode,
    limit: input.limit,
  });
  for (const route of ["/sales", "/conversations", "/outreach", "/leads"]) revalidatePath(route);
  return result;
}

export async function countPendingRepliesAction(): Promise<number> {
  await requireStudioOwner();
  const [inbounds, interactions] = await Promise.all([
    getInboundMessageRepository().list(),
    getSalesInteractionRepository().list(),
  ]);
  const processed = new Set(interactions.map((i) => i.inboundMessageId));
  return inbounds.filter((m) => m.replyConfirmed && !processed.has(m.id)).length;
}
