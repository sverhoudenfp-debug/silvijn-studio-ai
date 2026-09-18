import "server-only";
import { z } from "zod";
import { sendOutreachViaGmail } from "@/lib/gmail/send";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { getOutreachRepository } from "./repository";
import type { OutreachDraft } from "./types";

/**
 * Verzenden van goedgekeurde outreach (Fase E).
 *
 * Productie (Supabase geconfigureerd): de bestaande Gmail-weg
 * (lib/gmail/send.ts) — vereist draft status 'approved', een geautoriseerde
 * Gmail-verbinding, is onveranderlijk na verzending en legt provider-bewijs
 * vast (Message-ID + account). Er bestaat geen andere productieweg.
 *
 * Development/tests (geen database): mock-verzending via de repository, met
 * hetzelfde verzendbewijs-veld zodat reply-matching en historie te testen
 * zijn. Een mock-verzending raakt NOOIT de productiedatabase.
 */
export interface SentOutreach {
  readonly draftId: string;
  readonly messageId: string;
  readonly accountKey: string;
  readonly sentAt: string;
}

export async function sendApprovedOutreachDraft(draftId: string): Promise<SentOutreach> {
  // UUID-validatie alléén op de productieweg (Supabase-IDs zijn UUIDs en
  // PostgREST-queries moeten tegen injectie worden beschermd); de
  // memory-repository gebruikt legitieme niet-UUID test-IDs (od-xxx).
  if (isSupabaseConfigured()) {
    const result = await sendOutreachViaGmail(z.uuid().parse(draftId));
    return {
      draftId: result.draftId,
      messageId: result.messageIdHeader,
      accountKey: "gmail",
      sentAt: result.sentAt,
    };
  }

  const repository = getOutreachRepository();
  const draft = await repository.getById(draftId);
  if (!draft) throw new Error("Outreach-draft niet gevonden");
  if (draft.status === "sent") throw new Error("Dit draft is al verzonden (immutable)");
  if (draft.status !== "approved") {
    throw new Error("Alleen goedgekeurde drafts kunnen worden verzonden");
  }

  const sentAt = new Date().toISOString();
  const messageId = `mock-outreach-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const updated = await repository.update(draftId, {
    status: "sent",
    sentAt,
    providerMessageId: messageId,
    providerAccountKey: "mock",
  });
  if (!updated) throw new Error("Verzending kon niet worden vastgelegd");
  return { draftId, messageId, accountKey: "mock", sentAt };
}

/** Verzenden vereist altijd eerst goedkeuring — ook in de autonome modus. */
export async function approveAndSendDraft(draftId: string): Promise<SentOutreach> {
  const repository = getOutreachRepository();
  const draft: OutreachDraft | null = await repository.getById(draftId);
  if (!draft) throw new Error("Outreach-draft niet gevonden");
  if (draft.status === "cancelled" || draft.status === "sent") {
    throw new Error(`Draft kan niet worden verzonden (status ${draft.status})`);
  }
  if (draft.status !== "approved") {
    const approved = await repository.update(draftId, { status: "approved" });
    if (!approved) throw new Error("Draft kon niet worden goedgekeurd");
  }
  return sendApprovedOutreachDraft(draftId);
}
