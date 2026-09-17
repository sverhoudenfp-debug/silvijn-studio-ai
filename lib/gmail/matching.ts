import "server-only";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { extractEmailAddress } from "./client";
import type { GmailMessageHeaders } from "./client";

/**
 * Matching van binnenkomende Gmail-reacties op leads/outreach.
 * Deterministisch en expliciet — onderwerp of losse tekst matcht NOOIT:
 * alleen betrouwbare identifiers gelden.
 *
 * Prioriteit:
 *  1. In-Reply-To/References → verstuurd outreach (provider_message_id
 *     = Message-ID van de verzonden mail) → lead + gespreksthread.
 *  2. Afzenderadres → bestaand lead_contact (email) of leads.email.
 *  3. Geen match → onverwerkt; er wordt nooit een lead verzonnen.
 */

export interface OutreachLookupRow {
  readonly id: string;
  readonly lead_id: string;
  readonly provider_message_id: string | null;
  readonly provider_account_key: string | null;
  readonly conversation_id: string | null;
}

export interface SenderLookupRow {
  readonly lead_id: string;
  readonly email: string | null;
}

export interface ReplyMatchInput {
  readonly headers: GmailMessageHeaders;
  readonly accountKey: string;
  readonly sentOutreach: OutreachLookupRow[];
  readonly leadEmails: SenderLookupRow[];
  readonly contactEmails: { lead_id: string; address: string }[];
}

export interface ReplyMatchResult {
  readonly leadId: string;
  readonly outreachId: string | null;
  readonly threadKey: string | null;
  readonly matchReason: "in_reply_to" | "sender_contact" | "sender_lead_email";
}

/** Referentie-ID's uit In-Reply-To en References (whitespace-gescheiden). */
export function referenceIds(headers: GmailMessageHeaders): string[] {
  const raw = [headers.inReplyTo, headers.references].filter(Boolean).join(" ");
  return raw.split(/[\s,]+/).map((token) => token.trim()).filter((token) => token.length > 0);
}

export function findReplyTarget(input: ReplyMatchInput): ReplyMatchResult | null {
  const sender = extractEmailAddress(input.headers.from);

  // Nooit reacties van het studio-account zelf.
  if (sender && sender === input.accountKey.toLowerCase()) return null;

  // 1. In-Reply-To / References → exacte outreach-match.
  const refs = referenceIds(input.headers);
  if (refs.length > 0) {
    const outreach = input.sentOutreach.find((row) => row.provider_message_id && refs.includes(row.provider_message_id));
    if (outreach) {
      return {
        leadId: outreach.lead_id,
        outreachId: outreach.id,
        threadKey: outreach.conversation_id ? `gmail-thread:${outreach.conversation_id}` : null,
        matchReason: "in_reply_to",
      };
    }
  }

  if (!sender) return null;

  // 2a. Bekend lead_contact-adres.
  const contact = input.contactEmails.find((row) => row.address === sender);
  if (contact) return { leadId: contact.lead_id, outreachId: null, threadKey: null, matchReason: "sender_contact" };

  // 2b. Bekend leads.email-adres.
  const byLeadEmail = input.leadEmails.find((row) => row.email && row.email.toLowerCase() === sender);
  if (byLeadEmail) return { leadId: byLeadEmail.lead_id, outreachId: null, threadKey: null, matchReason: "sender_lead_email" };

  return null;
}

/** Verzonden outreach + adresregisters voor matching (service-role leesactie). */
export async function loadMatchContext(accountKey: string): Promise<{
  sentOutreach: OutreachLookupRow[];
  leadEmails: SenderLookupRow[];
  contactEmails: { lead_id: string; address: string }[];
}> {
  if (!isSupabaseConfigured()) return { sentOutreach: [], leadEmails: [], contactEmails: [] };
  const client = getSupabaseServerClient();
  const [outreach, leads, contacts] = await Promise.all([
    client.from("outreach_drafts").select("id,lead_id,provider_message_id,provider_account_key,conversation_id").eq("status", "sent").eq("channel", "email").limit(2000),
    client.from("leads").select("id,email").limit(5000),
    client.from("lead_contacts").select("lead_id,address").eq("channel", "email").limit(5000),
  ]);
  if (outreach.error || leads.error || contacts.error) {
    throw new Error("Match-context kon niet worden geladen");
  }
  return {
    sentOutreach: (outreach.data ?? []).filter((row) => row.provider_account_key === accountKey.toLowerCase()) as OutreachLookupRow[],
    leadEmails: (leads.data ?? []).map((row) => ({ lead_id: row.id, email: row.email ? String(row.email).toLowerCase() : null })),
    contactEmails: (contacts.data ?? []).map((row) => ({ lead_id: row.lead_id, address: row.address.toLowerCase() })),
  };
}
