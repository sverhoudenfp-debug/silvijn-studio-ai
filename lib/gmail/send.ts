import "server-only";
import { z } from "zod";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { requireGmailConfig } from "./config";
import { getGmailAccessToken } from "./tokens";
import { gmailSend, signatureHtmlToText } from "./client";
import { buildFromHeader } from "./send-as";
import { checkSendAsAlias } from "./send-as-check";
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
export async function resolveReplyThreadHeaders(
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

  const { accessToken, connection } = await getGmailAccessToken(config.accountKey);
  // Het gekoppelde account is het primaire OAuth-account (silvijn@); de
  // callback slaat geen ander account op. Het zichtbare From-adres is het
  // "Verzenden als"-alias (info@), maar uitsluitend nadat de Gmail API het
  // alias bij deze verzending live als aanwezig én geverifieerd bevestigt.
  // Geen hardcoded From: adres, weergavenaam en handtekening komen uit Gmail.
  const accountEmail = connection.account_key.toLowerCase();
  if (accountEmail !== config.accountKey) {
    throw new Error(`Gekoppeld Gmail-account (${accountEmail}) is niet het vereiste primaire account (${config.accountKey})`);
  }
  const sendAs = await checkSendAsAlias({
    accessToken,
    grantedScopes: connection.scopes,
    accountEmail,
    sendAsEmail: config.sendAsEmail,
  });
  if (!sendAs.ok) {
    throw new Error(`SEND_AS_ALIAS_UNAVAILABLE (${sendAs.status}): ${sendAs.reason}`);
  }
  const fromHeader = buildFromHeader(sendAs.alias);
  const signature = resolveAliasSignature(sendAs.alias.signatureHtml, draft.body);
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
      from: fromHeader,
      to,
      subject: draft.subject,
      body: draft.body,
      messageIdHeader,
      signatureHtml: signature.html,
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

/**
 * Gmail-handtekening van het "Verzenden als"-alias, precies één keer. Gmail
 * voegt bij API-sends nooit zelf een handtekening toe; wij plakken de
 * bestaande alias-handtekening aan. Staat (een herkenbaar deel van) die
 * handtekening al in de tekst, of heeft het alias er geen, dan wordt niets
 * toegevoegd — nooit dubbel, nooit verzonnen.
 */
export function resolveAliasSignature(
  signatureHtml: string | null,
  body: string
): { html: string | null; reason: "applied" | "already_present" | "none_configured" } {
  const html = (signatureHtml ?? "").trim();
  if (!html) return { html: null, reason: "none_configured" };
  if (signatureAlreadyPresent(body, html)) return { html: null, reason: "already_present" };
  return { html, reason: "applied" };
}

export function signatureAlreadyPresent(body: string, signatureHtml: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const text = normalize(signatureHtmlToText(signatureHtml));
  if (!text) return false;
  const haystack = normalize(body);
  if (haystack.includes(text)) return true;
  // Eerste betekenisvolle regel van de handtekening (meestal naam of bedrijf) als vingerafdruk.
  const firstLine = signatureHtmlToText(signatureHtml).split("\n").map((l) => l.trim()).find((l) => l.length >= 6);
  return firstLine ? haystack.includes(normalize(firstLine)) : false;
}
