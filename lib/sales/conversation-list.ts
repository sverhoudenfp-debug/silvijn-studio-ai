import { messagePreview } from "./message-clean";

/**
 * Pure afleiding van de inbox-lijst: laatste bericht per conversation,
 * ongelezen-status en adresweergave. Volledig zonder side-effects en
 * daarmee regressietestbaar (de serverlaag in lib/sales/conversations
 * re-export deze functies).
 */

export interface ConversationRow {
  id: string;
  lead_id: string;
  contact_id: string;
  channel: string;
  thread_key: string;
  first_reply_id: string;
  last_reply_at: string;
  owner_last_read_at: string | null;
}

export interface ConversationMessageRow {
  id: string;
  lead_id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  sender: string;
  subject: string;
  body: string;
  occurred_at: string;
  source: string;
}

export interface ConversationListItem {
  id: string;
  lead_id: string;
  contact_id: string;
  email: string;
  subject: string;
  lastDirection: "inbound" | "outbound";
  lastPreview: string;
  lastMessageAt: string;
  unread: boolean;
  last_reply_at: string;
}

export function buildConversationList(
  conversations: ConversationRow[],
  messages: ConversationMessageRow[],
  contactAddresses: Record<string, string>
): ConversationListItem[] {
  const lastByConversation = new Map<string, ConversationMessageRow>();
  for (const m of messages) {
    const cur = lastByConversation.get(m.conversation_id);
    if (!cur || m.occurred_at >= cur.occurred_at) lastByConversation.set(m.conversation_id, m);
  }
  return conversations.map((c) => {
    const last = lastByConversation.get(c.id) ?? null;
    // Ongelezen: er is een INKOMEND bericht dat de eigenaar nog niet heeft
    // gezien (owner_last_read_at null = nooit geopend). Uitgaande eigen
    // berichten maken een gesprek nooit "ongelezen".
    const lastInbound = messages
      .filter((m) => m.conversation_id === c.id && m.direction === "inbound")
      .sort((a, b) => (a.occurred_at >= b.occurred_at ? 1 : -1))[0] ?? null;
    const unread = lastInbound !== null && (c.owner_last_read_at === null || lastInbound.occurred_at > c.owner_last_read_at);
    return {
      id: c.id,
      lead_id: c.lead_id,
      contact_id: c.contact_id,
      email: contactAddresses[c.contact_id] ?? "",
      subject: last?.subject ?? "",
      lastDirection: last?.direction ?? "inbound",
      lastPreview: last ? messagePreview(last.body) : "",
      lastMessageAt: last?.occurred_at ?? c.last_reply_at,
      unread,
      last_reply_at: c.last_reply_at,
    };
  });
}
