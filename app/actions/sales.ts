"use server";

import { requireStudioOwner } from "@/lib/auth/server";


import { revalidatePath } from "next/cache";
import { recordConfirmedReply } from "@/lib/sales/conversations";
import { getInboundMessageRepository } from "@/lib/sales/repository";
import { SalesService } from "@/lib/sales/service";
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
