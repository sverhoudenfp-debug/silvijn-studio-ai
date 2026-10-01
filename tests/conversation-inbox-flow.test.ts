import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Regressietests — Conversation-inboxflow (2026-10-01).
 * Aanleiding: de volledige Gmail → Conversations → AI Sales-flow moest
 * definitief kloppen. Gedekte klasse van bugs:
 *  1. Een tweede reactie van dezelfde afzender (zonder In-Reply-To) creëerde
 *     een tweede conversation in plaats van mee te lopen in de bestaande
 *     thread (thread-consolidatie).
 *  2. In-Reply-To-matches gebruikten een gesynthetiseerde "gmail-thread:"
 *     thread_key die nooit in de database bestaat → tweede conversation.
 *  3. Berichten in Gmail SPAM/Trash werden nooit gescand (Gmail sluit die
 *     locaties bij zoeken standaard uit).
 *  4. De ingest sloeg de volledige "Naam <adres>"-header op als afzender/
 *     contact-adres, waardoor dezelfde contact uit een eerdere reactie
 *     onvindbaar werd voor matching.
 *  5. Outreach-verzending koos het eerste lead_contact als bestemming
 *     in plaats van het eigen draft-contact.
 *  6. Ongelezen-status, quote-geschoonde weergave en mark-read.
 */

const root = path.resolve(__dirname, "..");
const ingestSrc = readFileSync(path.join(root, "lib/gmail/ingest.ts"), "utf8");
const sendSrc = readFileSync(path.join(root, "lib/gmail/send.ts"), "utf8");
const migrationSrc = readFileSync(path.join(root, "supabase/migrations/0030_conversation_inbox_flow.sql"), "utf8");
const diagnoseSrc = readFileSync(path.join(root, "app/api/gmail/diagnose/route.ts"), "utf8");
const rpcOldSrc = readFileSync(path.join(root, "supabase/migrations/0024_gmail_reply_threading.sql"), "utf8");

const ACCOUNT = "silvijn@silvijnstudio.com";

const baseInput = {
  headers: {
    from: "Klant <klant@example.nl>",
    to: "info@silvijnstudio.com",
    inReplyTo: null,
    references: null,
    messageId: "<klant-mail-1@gmail.com>",
    subject: "Re: Online zichtbaarheid",
    date: null,
  },
  accountKey: ACCOUNT,
  sentOutreach: [
    { id: "out-1", lead_id: "lead-1", provider_message_id: "<outreach-1@silvijnstudio.com>", provider_account_key: ACCOUNT, conversation_id: "conv-1" },
  ],
  leadEmails: [{ lead_id: "lead-1", email: null }],
  contactEmails: [{ contact_id: "contact-1", lead_id: "lead-1", address: "klant@example.nl" }],
  conversations: [
    { id: "conv-1", lead_id: "lead-1", contact_id: "contact-1", channel: "email", thread_key: "gmail:silvijn@silvijnstudio.com:threadA", last_reply_at: "2026-09-18T14:13:35Z" },
  ],
};

test("1. thread-consolidatie: tweede reactie zonder In-Reply-To gebruikt de bestaande conversation-thread_key", async () => {
  const { findReplyTarget } = await import("../lib/gmail/matching");
  const match = findReplyTarget({ ...baseInput });
  assert.ok(match, "afzender-match werkt");
  assert.equal(match!.matchReason, "sender_contact");
  assert.equal(match!.leadId, "lead-1");
  // Kern van de fix: NIET gmail:<account>:<nieuweThreadId> (tweede
  // conversation) maar de thread_key van de bestaande conversation.
  assert.equal(match!.threadKey, "gmail:silvijn@silvijnstudio.com:threadA");
});

test("2. In-Reply-To-match gebruikt de ÉCHTE thread_key van de gekoppelde conversation, nooit een syntheseprefix", async () => {
  const { findReplyTarget } = await import("../lib/gmail/matching");
  const match = findReplyTarget({
    ...baseInput,
    headers: { ...baseInput.headers, inReplyTo: "<outreach-1@silvijnstudio.com>" },
  });
  assert.equal(match!.matchReason, "in_reply_to");
  assert.equal(match!.outreachId, "out-1");
  assert.equal(match!.threadKey, "gmail:silvijn@silvijnstudio.com:threadA");
  assert.ok(!match!.threadKey!.startsWith("gmail-thread:"), "de gesynthetiseerde gmail-thread:-prefix bestaat niet meer");
});

test("3. In-Reply-To zonder bestaande contact-conversation valt terug op de outreach-conversation thread_key", async () => {
  const { findReplyTarget } = await import("../lib/gmail/matching");
  const match = findReplyTarget({
    ...baseInput,
    headers: { ...baseInput.headers, from: "Klant <ander@adres.nl>", inReplyTo: "<outreach-1@silvijnstudio.com>" },
  });
  assert.equal(match!.matchReason, "in_reply_to");
  // De afzender is géén bekend contact: consolidatie kan niet, dus de
  // conversation van de outreach zelf (via zijn echte thread_key).
  assert.equal(match!.threadKey, "gmail:silvijn@silvijnstudio.com:threadA");
});

test("4. zonder bestaande conversation is de thread_key null (nieuwe thread begint terecht)", async () => {
  const { findReplyTarget } = await import("../lib/gmail/matching");
  const match = findReplyTarget({
    ...baseInput,
    conversations: [],
  });
  assert.equal(match!.threadKey, null);
});

test("5. de ingest scant SPAM/Trash (includeSpamTrash) — echte reacties in spam blijven zichtbaar", async () => {
  assert.ok(/includeSpamTrash:\s*true/.test(ingestSrc), "ingest geeft includeSpamTrash: true mee aan gmailListMessages");
  const { gmailListMessages } = await import("../lib/gmail/client");
  const urls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ messages: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    await gmailListMessages("token", { accountKey: ACCOUNT, includeSpamTrash: true });
    assert.ok(urls[0].includes("includeSpamTrash=true"), "de API-aanroep bevat includeSpamTrash=true");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("6. de ingest normaliseert de afzender naar het kale adres (source-guard)", () => {
  assert.ok(
    /p_sender:\s*extractEmailAddress\(message\.headers\.from\)/.test(ingestSrc),
    "p_sender gebruikt extractEmailAddress, niet de rauwe From-header"
  );
});

test("7. ingest_gmail_reply v3 vergelijkt idempotent op het KALE adres (pre-normalisatie-rijen matchen)", () => {
  assert.ok(/prior_address\s*:=\s*lower\(coalesce\(substring\(prior\.sender from '<\(\[\^>\]\+\)>'\), prior\.sender\)\)/.test(migrationSrc));
  assert.ok(!/prior\.sender\s*<>\s*normalized_sender/.test(migrationSrc), "de rauwe afzenderstring is niet meer de identiteitsvergelijking");
});

test("8. ingest_gmail_reply v3 koppelt verzonden outreach van hetzelfde (lead, contact) aan de thread", () => {
  assert.ok(/if conv_id is not null and p_outreach is null then/.test(migrationSrc));
  assert.ok(/update public\.outreach_drafts set conversation_id = conv_id/.test(migrationSrc));
  assert.ok(/where lead_id = p_lead and contact_id = cid and channel = 'email'/.test(migrationSrc));
  assert.ok(/and conversation_id is null/.test(migrationSrc), "al gekoppelde outreach wordt nooit verplaatst");
});

test("9. mark_conversation_read is owner-only en raakt uitsluitend owner_last_read_at", () => {
  assert.ok(/HUMAN_AUTHORIZATION_REQUIRED/.test(migrationSrc));
  assert.ok(/revoke all on function public\.mark_conversation_read\(uuid\) from public, anon, service_role/.test(migrationSrc));
  assert.ok(/grant execute on function public\.mark_conversation_read\(uuid\) to authenticated/.test(migrationSrc));
  assert.ok(/update public\.conversations set owner_last_read_at = now\(\)/.test(migrationSrc));
  assert.ok(/add column if not exists owner_last_read_at timestamptz/.test(migrationSrc));
});

test("10. diagnose-route is strikt read-only (source-guard)", () => {
  // Alleen lezen: geen schrijvende Supabase-calls, geen cursor-update, geen
  // verzending. is_studio_owner is de auth-check (read) en gmailSendAsEmail
  // is de config-lezer; gmailSend (verzenden) zelf komt niet voor.
  assert.ok(!/\.update\(|\.insert\(|\.upsert\(|\.delete\(|markGmailIngested|gmailSend\b/.test(diagnoseSrc), "geen schrijvende calls in de diagnose-route");
  assert.ok(!/\.rpc\("(?!is_studio_owner")/.test(diagnoseSrc), "de enige RPC is de owner-authcheck");
  assert.ok(/x-cron-secret/.test(diagnoseSrc));
  assert.ok(/includeSpamTrash: true/.test(diagnoseSrc), "de diagnose scant inclusief spam/trash");
});

test("11. verzendbestemming: het draft-contact, nooit het eerste willekeurige lead_contact (source-guard)", () => {
  assert.ok(/resolveOutreachDestination\(/.test(sendSrc));
  assert.ok(!/\.eq\("lead_id", draft\.lead_id\)\s*\n\s*\.eq\("channel", "email"\)\s*\n\s*\.limit\(1\)/.test(sendSrc), "de oude eerste-contact-keuze bestaat niet meer");
});

test("12. resolveOutreachDestination: draft-contact wint, anders leads.email", async () => {
  const { resolveOutreachDestination } = await import("../lib/gmail/send");
  type Row = Record<string, unknown> | null;
  const contacts: Record<string, Row> = {};
  let leadEmail: string | null = null;
  type Step = { eq: (...args: unknown[]) => Step; maybeSingle: () => Promise<{ data: unknown; error: null }> };
  const client = {
    from(table: string) {
      const step: Step = {
        eq: (...args: unknown[]) => {
          if (table === "lead_contacts" && args[0] === "id" && typeof args[1] === "string") (client as { lastContactId?: string }).lastContactId = args[1];
          return step;
        },
        maybeSingle: async () => ({
          data: table === "lead_contacts" ? (contacts[(client as { lastContactId?: string }).lastContactId ?? ""] ?? null) : leadEmail === null ? null : { email: leadEmail },
          error: null,
        }),
      };
      return { select: () => step };
    },
  } as unknown as Parameters<typeof resolveOutreachDestination>[0];

  // Draft-contact aanwezig → zijn adres.
  contacts["contact-9"] = { address: "klant@example.nl" };
  assert.equal(await resolveOutreachDestination(client, "lead-1", "contact-9"), "klant@example.nl");

  // Contact-id onbekend/verwijderd → leads.email-fallback.
  assert.equal(await resolveOutreachDestination(client, "lead-1", "contact-x"), null);
  leadEmail = "direct@example.org";
  assert.equal(await resolveOutreachDestination(client, "lead-1", "contact-x"), "direct@example.org");
  // Zonder draft-contact ook leads.email.
  assert.equal(await resolveOutreachDestination(client, "lead-1", null), "direct@example.org");
});

test("13. weergave-schoonmaker: gequoteerde historie en handtekeningen uit de thread", async () => {
  const { cleanMessageForDisplay, messagePreview } = await import("../lib/sales/message-clean");
  const body = [
    "Hoi, bedankt voor je bericht!",
    "Ik wil graag meer informatie.",
    "",
    "Op wo 28 sep 2026 om 10:15 schreef Silvijn Studio <info@silvijnstudio.com>:",
    "> Beste klant, wij maken websites.",
    "> Met vriendelijke groet,",
    "",
    "-- ",
    "Silvijn Studio",
    "silvijnstudio.com",
  ].join("\n");
  const cleaned = cleanMessageForDisplay(body);
  assert.ok(cleaned.includes("Ik wil graag meer informatie."), "de nieuwe tekst blijft");
  assert.ok(!cleaned.includes("schreef"), "de quote-header verdwijnt");
  assert.ok(!cleaned.includes("Beste klant"), "de gequoteerde historie verdwijnt");
  assert.ok(!cleaned.includes("Silvijn Studio"), "de handtekening verdwijnt");
  // Zonder patronen verandert er niets (conservatief).
  assert.equal(cleanMessageForDisplay("Gewoon een bericht.\n\nTweede regel."), "Gewoon een bericht.\n\nTweede regel.");
  // Preview: één regel, begrensd.
  const preview = messagePreview("abcd ".repeat(40));
  assert.ok(preview.length <= 90);
});

test("14. ongelezen-indicator: alleen inkomende berichten ná de laatste leesactie", async () => {
  const { buildConversationList } = await import("../lib/sales/conversation-list");
  const row = (owner_last_read_at: string | null) => ({
    id: "c1", lead_id: "lead-1", contact_id: "contact-1", channel: "email",
    thread_key: "t", first_reply_id: "m1", last_reply_at: "2026-10-01T10:00:00Z", owner_last_read_at,
  });
  const inbound = { id: "m1", lead_id: "lead-1", conversation_id: "c1", direction: "inbound" as const, sender: "klant@example.nl", subject: "Re:", body: "Hallo", occurred_at: "2026-10-01T10:00:00Z", source: "gmail" };
  const outbound = { ...inbound, id: "m2", direction: "outbound" as const, body: "Jij bericht", occurred_at: "2026-10-01T12:00:00Z", source: "outreach" };

  // Nooit geopend → ongelezen.
  assert.equal(buildConversationList([row(null)], [inbound], { contact_1: "klant@example.nl" })[0].unread, true);
  // Gelezen ná het laatste inkomende bericht → gelezen.
  assert.equal(buildConversationList([row("2026-10-01T11:00:00Z")], [inbound], {})[0].unread, false);
  // Gelezen vóór het inkomende bericht → ongelezen.
  assert.equal(buildConversationList([row("2026-09-01T00:00:00Z")], [inbound], {})[0].unread, true);
  // Alleen een uitgaand bericht na de leesactie → geen ongelezen.
  assert.equal(buildConversationList([row("2026-10-01T11:00:00Z")], [inbound, outbound], {})[0].unread, false);
  // Laatste bericht in de lijst = nieuwste (ook als outbound later is).
  assert.equal(buildConversationList([row(null)], [inbound, outbound], {})[0].lastDirection, "outbound");
});

test("15. de oude RPC (0024) bewijst dat de rauwe sender-vergelijking de oude bug was", () => {
  assert.ok(/prior\.sender\s*<>\s*normalized_sender/.test(rpcOldSrc), "pre-conditie: de v2-RPC vergeleek de rauwe afzenderstring");
});
