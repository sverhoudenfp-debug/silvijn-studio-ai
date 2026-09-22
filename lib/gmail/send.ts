import "server-only";
import { z } from "zod";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { requireGmailConfig } from "./config";
import { getGmailAccessToken } from "./tokens";
import { gmailSend } from "./client";
import { newOutreachMessageIdHeader } from "./provider";
import { buildReplyThreadHeaders, type ReplyThreadHeaders } from "./threading";

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

/**
 * Thread-context voor een antwoord-draft: de meest recente bevestigde
 * Gmail-reactie van de klant in dit gesprek (Gmail-threadId, RFC
 * Message-ID, References) plus onze eigen al verzonden Message-IDs.
 * Puur leesactie; zonder conversation_id of zonder Gmail-bewijs →
 * alle headers null (ongewijzigd gedrag).
 */
async function resolveReplyThreadHeaders(
  client: ReturnType<typeof getSupabaseServerClient>,
  conversationId: string | null
): Promise<ReplyThreadHeaders> {
  if (!conversationId) return { inReplyTo: null, references: null, threadId: null };

  const { data: inbound, error: inboundError } = await client
    .from("inbound_messages")
    .select("provider_thread_id,provider_rfc_message_id,provider_references")
    .eq("conversation_id", conversationId)
    .eq("source", "gmail")
    .eq("reply_confirmed", true)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (inboundError) throw new Error(`Thread-context kon niet worden gelezen: ${inboundError.message}`);
  if (!inbound) return { inReplyTo: null, references: null, threadId: null };

  const { data: sent, error: sentError } = await client
    .from("outreach_drafts")
    .select("provider_message_id")
    .eq("conversation_id", conversationId)
    .eq("status", "sent")
    .order("sent_at", { ascending: true })
    .limit(500);
  if (sentError) throw new Error(`Verzonden drafts in gesprek konden niet worden gelezen: ${sentError.message}`);

  return buildReplyThreadHeaders({
    latestInbound: {
      providerThreadId: inbound.provider_thread_id,
      providerRfcMessageId: inbound.provider_rfc_message_id,
      providerReferences: inbound.provider_references,
    },
    sentMessageIds: (sent ?? [])
      .map((row: { provider_message_id: string | null }) => row.provider_message_id)
      .filter((value: string | null): value is string => typeof value === "string" && value.length > 0),
  });
}

export async function sendOutreachViaGmail(draftId: string): Promise<SentOutreachResult> {
  const id = z.uuid().parse(draftId);
  if (!isSupabaseConfigured()) throw new Error("BLOCKED_EXTERNAL_CONFIGURATION: database niet geconfigureerd");
  const client = getSupabaseServerClient();
  const config = requireGmailConfig();

  const { data: draft, error } = await client
    .from("outreach_drafts")
    .select("id,lead_id,status,channel,subject,body,provider_message_id,conversation_id")
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

  // Reply-threading: als dit draft een antwoord binnen een bestaand
  // gesprek is, verwijs het naar de thread van de klantmail. Initiële
  // outreach (geen conversation_id of geen Gmail-inbound) verandert
  // niet: dat start terecht een nieuwe thread.
  const threadHeaders = await resolveReplyThreadHeaders(client, draft.conversation_id);

  const { accessToken } = await getGmailAccessToken(config.accountKey);
  const messageIdHeader = newOutreachMessageIdHeader();
  // Dubbelverzend-slot: claim het draft atomair vóór de provider-call. Alleen
  // een approved draft zónder provider_message_id kan geclaimd worden; een
  // gelijktijdige tweede poging (dashboardklik + ingest-tick, dubbele klik)
  // ziet 0 rijen en stopt zonder te verzenden. Faalt de provider ná de claim,
  // dan wordt het draft 'failed' en is een nieuwe eigenaarsgoedkeuring nodig.
  const { data: claimed, error: claimError } = await client
    .from("outreach_drafts")
    .update({ provider_message_id: messageIdHeader, provider_account_key: config.accountKey })
    .eq("id", id)
    .eq("status", "approved")
    .is("provider_message_id", null)
    .select("id");
  if (claimError) throw new Error(`Verzendclaim mislukt: ${claimError.message}`);
  if (!claimed || claimed.length !== 1) {
    throw new Error("Dit draft is al geclaimd of verzonden (dubbelverzending voorkomen)");
  }
  let gmailResult: Awaited<ReturnType<typeof gmailSend>>;
  try {
    gmailResult = await gmailSend(accessToken, {
      from: config.accountKey,
      to,
      subject: draft.subject,
      body: draft.body,
      messageIdHeader,
      ...threadHeaders,
    });
  } catch (error) {
    await client.from("outreach_drafts").update({ status: "failed" }).eq("id", id).eq("provider_message_id", messageIdHeader);
    throw error;
  }

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
    .eq("status", "approved")
    .eq("provider_message_id", messageIdHeader);
  if (updateError) throw new Error(`Verzonden draft kon niet worden vastgelegd: ${updateError.message}`);

  return { draftId: id, messageIdHeader, gmailMessageId: gmailResult.gmailMessageId, sentAt };
}
