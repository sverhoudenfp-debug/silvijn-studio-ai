"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioOwner } from "@/lib/auth/server";
import { markConversationRead } from "@/lib/sales/conversations";

/**
 * Server actions voor de conversation-inbox. Gelezen markeren is de
 * enige schrijfactie vanuit deze pagina en raakt uitsluitend de
 * owner_last_read_at van het geopende gesprek.
 */
export async function markConversationReadAction(conversationId: string): Promise<{ ok: true }> {
  await requireStudioOwner();
  await markConversationRead(z.uuid().parse(conversationId));
  revalidatePath("/conversations");
  return { ok: true };
}
