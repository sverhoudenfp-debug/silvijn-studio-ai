"use server";

import { revalidatePath } from "next/cache";
import { SalesService } from "@/lib/sales/service";
import type { InboundMessage, SalesInteraction } from "@/lib/sales/types";

/**
 * Server actions — de enige entree naar de sales-engine vanuit de UI.
 * Elke actie is expliciet en gecontroleerd; er bestaat géén verzend-actie
 * en geen actie die prijzen of toezeggingen doet in Fase 7.
 */

export async function listInboundMessagesAction(leadId: string): Promise<InboundMessage[]> {
  return new SalesService().listInboundByLead(leadId);
}

export async function listSalesInteractionsAction(leadId: string): Promise<SalesInteraction[]> {
  return new SalesService().listInteractionsByLead(leadId);
}

export async function createInboundMessageAction(input: {
  leadId: string;
  sender: string;
  subject: string;
  body: string;
}): Promise<InboundMessage> {
  const message = await new SalesService().createInboundMessage({
    leadId: input.leadId,
    channel: "email",
    sender: input.sender,
    subject: input.subject,
    body: input.body,
    source: "manual",
  });
  revalidatePath("/sales");
  return message;
}

export async function analyzeInboundMessageAction(leadId: string, inboundMessageId: string) {
  const result = await new SalesService().analyzeInboundMessage(leadId, inboundMessageId);
  revalidatePath("/sales");
  revalidatePath(`/leads/${leadId}`);
  return result;
}

export async function markReadyForSilvijnAction(interactionId: string): Promise<SalesInteraction> {
  const interaction = await new SalesService().markReadyForSilvijn(interactionId);
  revalidatePath("/sales");
  return interaction;
}

export async function markHandledAction(interactionId: string): Promise<SalesInteraction> {
  const interaction = await new SalesService().markHandled(interactionId);
  revalidatePath("/sales");
  return interaction;
}
