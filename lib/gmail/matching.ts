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
 *
 * Thread-consolidatie (2026-10-01): één (lead, contact, kanaal) heeft
 * exact één conversation. Een reactie die via de afzender matcht (of via
 * In-Reply-To) gebruikt daarom altijd de thread_key van de reeds
 * bestaande conversation van dat contact, zodat een tweede reply — ook
 * uit een nieuw Gmail-gesprek — in dezelfde conversation belandt.
 * Alleen zonder bestaande conversation start een nieuwe thread
 * (Gmail-threadId als thread_key). De gesynthetiseerde "gmail-thread:"
 * thread_key bestaat niet meer: een conversation wordt altijd via zijn
 * échte, in de database staande thread_key gevonden.
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

export interface ContactLookupRow {
  readonly contact_id: string;
  readonly lead_id: string;
  readonly address: string;
}

export interface ConversationLookupRow {
  readonly id: string;
  readonly lead_id: string;
  readonly contact_id: string;
  readonly channel: string;
  readonly thread_key: string;
  readonly last_reply_at: string;
}

export interface ReplyMatchInput {
  readonly headers: GmailMessageHeaders;
  readonly accountKey: string;
  readonly sentOutreach: OutreachLookupRow[];
  readonly leadEmails: SenderLookupRow[];
  readonly contactEmails: ContactLookupRow[];
  readonly conversations: ConversationLookupRow[];
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

/**
 * Thread-key van de bestaande conversation van een (lead, contact, kanaal):
 * de meest recent actieve conversation wint. Null als er nog geen is —
 * de ingest start dan terecht een nieuwe thread.
 */
export function existingConversationThreadKey(
  input: Pick<ReplyMatchInput, "conversations">,
  leadId: string,
  contactId: string | null
): string | null {
  if (!contactId) return null;
  const matches = input.conversations
    .filter((c) => c.lead_id === leadId && c.contact_id === contactId && c.channel === "email")
    .sort((a, b) => (a.last_reply_at < b.last_reply_at ? 1 : -1));
  return matches[0]?.thread_key ?? null;
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
      const senderContact = sender ? input.contactEmails.find((row) => row.lead_id === outreach.lead_id && row.address === sender) : null;
      return {
        leadId: outreach.lead_id,
        outreachId: outreach.id,
        // Consolidatie eerst (bestaande conversation van dit contact), daarna
        // de conversation waarop de outreach zelf al gekoppeld is — via de
        // échte thread_key uit de database, nooit via een syntheseprefix.
        threadKey:
          existingConversationThreadKey(input, outreach.lead_id, senderContact?.contact_id ?? null) ??
          (outreach.conversation_id
            ? (input.conversations.find((c) => c.id === outreach.conversation_id && c.lead_id === outreach.lead_id)?.thread_key ?? null)
            : null),
        matchReason: "in_reply_to",
      };
    }
  }

  if (!sender) return null;

  // 2a. Bekend lead_contact-adres.
  const contact = input.contactEmails.find((row) => row.address === sender);
  if (contact) {
    return {
      leadId: contact.lead_id,
      outreachId: null,
      threadKey: existingConversationThreadKey(input, contact.lead_id, contact.contact_id),
      matchReason: "sender_contact",
    };
  }

  // 2b. Bekend leads.email-adres.
  const byLeadEmail = input.leadEmails.find((row) => row.email && row.email.toLowerCase() === sender);
  if (byLeadEmail) {
    return { leadId: byLeadEmail.lead_id, outreachId: null, threadKey: null, matchReason: "sender_lead_email" };
  }

  return null;
}

/**
 * Verzonden outreach + adresregisters voor matching (service-role leesactie).
 * De afzender die bij een contact-id hoort wordt meegenomen, zodat de
 * thread-consolidatie de juiste conversation kan opzoeken.
 */
export async function loadMatchContext(accountKey: string): Promise<{
  sentOutreach: OutreachLookupRow[];
  leadEmails: SenderLookupRow[];
  contactEmails: ContactLookupRow[];
  conversations: ConversationLookupRow[];
}> {
  if (!isSupabaseConfigured()) return { sentOutreach: [], leadEmails: [], contactEmails: [], conversations: [] };
  const client = getSupabaseServerClient();
  const [outreach, leads, contacts, conversations] = await Promise.all([
    client.from("outreach_drafts").select("id,lead_id,provider_message_id,provider_account_key,conversation_id").eq("status", "sent").eq("channel", "email").limit(2000),
    client.from("leads").select("id,email").limit(5000),
    client.from("lead_contacts").select("id,lead_id,address").eq("channel", "email").limit(5000),
    client.from("conversations").select("id,lead_id,contact_id,channel,thread_key,last_reply_at").limit(5000),
  ]);
  if (outreach.error || leads.error || contacts.error || conversations.error) {
    throw new Error("Match-context kon niet worden geladen");
  }
  return {
    sentOutreach: (outreach.data ?? []).filter((row) => row.provider_account_key === accountKey.toLowerCase()) as OutreachLookupRow[],
    leadEmails: (leads.data ?? []).map((row) => ({ lead_id: row.id, email: row.email ? String(row.email).toLowerCase() : null })),
    contactEmails: (contacts.data ?? []).map((row) => ({
      contact_id: row.id,
      lead_id: row.lead_id,
      address: String(row.address).toLowerCase(),
    })),
    conversations: (conversations.data ?? []).map((row) => ({
      id: row.id,
      lead_id: row.lead_id,
      contact_id: row.contact_id,
      channel: row.channel,
      thread_key: row.thread_key,
      last_reply_at: row.last_reply_at,
    })),
  };
}
