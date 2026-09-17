import "server-only";
import { z } from "zod";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { requireGmailConfig } from "./config";
import { getGmailAccessToken } from "./tokens";
import { gmailSend } from "./client";
import { newOutreachMessageIdHeader } from "./provider";

/**
 * Expliciete verzendstap voor outreach via Gmail — altijd mens-geïnitieerd
 * (server action, owner-session); automation/autonoom verzenden bestaat niet.
 *
 * Voorwaarden: draft status 'approved' (bestaande menselijke review) én
 * een geautoriseerde Gmail-verbinding. Na verzending wordt het draft
 * immutable 'sent' met provider-bewijs (Message-ID + account), zodat
 * antwoorden matchbaar en verzendhistorie onveranderlijk zijn.
 */

export interface SentOutreachResult {
  readonly draftId: string;
  readonly messageIdHeader: string;
  readonly gmailMessageId: string;
  readonly sentAt: string;
}

export async function sendOutreachViaGmail(draftId: string): Promise<SentOutreachResult> {
  const id = z.uuid().parse(draftId);
  if (!isSupabaseConfigured()) throw new Error("BLOCKED_EXTERNAL_CONFIGURATION: database niet geconfigureerd");
  const client = getSupabaseServerClient();
  const config = requireGmailConfig();

  const { data: draft, error } = await client
    .from("outreach_drafts")
    .select("id,lead_id,status,channel,subject,body,provider_message_id")
    .eq("id", id)
    .single();
  if (error || !draft) throw new Error("Outreach-draft niet gevonden");
  if (draft.channel !== "email") throw new Error("Alleen e-mailoutreach kan via Gmail worden verzonden");
  if (draft.status !== "approved") {
    throw new Error("Alleen door de eigenaar goedgekeurde drafts kunnen worden verzonden");
  }
  if (draft.status === "sent" || draft.provider_message_id) {
    throw new Error("Dit draft is al verzonden (immutable)");
  }

  // Bestemming: het e-mailadres van de lead (lead_contacts of leads.email).
  const { data: contact } = await client
    .from("lead_contacts")
    .select("address")
    .eq("lead_id", draft.lead_id)
    .eq("channel", "email")
    .limit(1);
  const { data: lead } = await client.from("leads").select("email").eq("id", draft.lead_id).single();
  const to = contact?.[0]?.address ?? lead?.email ?? null;
  if (!to) throw new Error("Geen e-mailadres bekend voor deze lead");

  const { accessToken } = await getGmailAccessToken(config.accountKey);
  const messageIdHeader = newOutreachMessageIdHeader();
  const gmailResult = await gmailSend(accessToken, {
    from: config.accountKey,
    to,
    subject: draft.subject,
    body: draft.body,
    messageIdHeader,
  });

  const sentAt = new Date().toISOString();
  const { error: updateError } = await client
    .from("outreach_drafts")
    .update({
      status: "sent",
      sent_at: sentAt,
      provider_message_id: messageIdHeader,
      provider_account_key: config.accountKey,
    })
    .eq("id", id)
    .eq("status", "approved");
  if (updateError) throw new Error(`Verzonden draft kon niet worden vastgelegd: ${updateError.message}`);

  return { draftId: id, messageIdHeader, gmailMessageId: gmailResult.gmailMessageId, sentAt };
}
