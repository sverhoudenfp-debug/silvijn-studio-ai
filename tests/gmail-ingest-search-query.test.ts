import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Regressietests voor de Gmail-ingest zoekopdracht (2026-09-28).
 * Aanleiding: outreach wordt verzonden als het send-as-adres (info@), dus een
 * prospect-reply heeft "To: <send-as>", terwijl de ingest alleen zocht op
 * "to:<account>". Echte reacties werden daardoor nooit eens gescand.
 *
 * De fix verbreedt uitsluitend de zoekbreedte; guards blijven onaangeroerd:
 * self-uitsluiting ("-from:me" + matcher-guard), In-Reply-To/References-
 * matching, thread matching en reply_handling_mode.
 */
import { buildIngestSearchQuery, gmailListMessages } from "../lib/gmail/client";
import { findReplyTarget } from "../lib/gmail/matching";

const ACCOUNT = "silvijn@silvijnstudio.com";
const SEND_AS = "info@silvijnstudio.com";

const SENT_OUTREACH = [
  {
    id: "draft-1",
    lead_id: "lead-1",
    provider_message_id: "<outreach-4e3b3adf735e1984a7233d7f8d469e96@silvijnstudio.com>",
    provider_account_key: ACCOUNT,
    conversation_id: null,
  },
];
const LEAD_EMAILS = [{ lead_id: "lead-1", email: "prospect@example.nl" }];
const CONTACT_EMAILS: { contact_id: string; lead_id: string; address: string }[] = [];
const CONVERSATIONS: {
  id: string; lead_id: string; contact_id: string; channel: string; thread_key: string; last_reply_at: string;
}[] = [];

test("1. reply aan het primaire account wordt in de query gevonden", () => {
  const q = buildIngestSearchQuery({ accountKey: ACCOUNT, sendAsEmail: SEND_AS });
  assert.ok(q.includes(`to:${ACCOUNT}`), "to:<account> zit in de query");
});

test("2. reply aan het send-as/outreach-adres wordt in de query gevonden (config-adres, niet hardcoded)", () => {
  const q = buildIngestSearchQuery({ accountKey: ACCOUNT, sendAsEmail: SEND_AS });
  assert.ok(q.includes(`to:${SEND_AS}`), "to:<send-as> zit in de query");
  assert.equal(q, `to:${ACCOUNT} OR to:${SEND_AS} -from:me`);
  // Het adres komt uit de aanroep (GMAIL_SEND_AS-config), niet uit de querybuilder:
  const q2 = buildIngestSearchQuery({ accountKey: ACCOUNT, sendAsEmail: "anders@example.nl" });
  assert.ok(q2.includes("to:anders@example.nl"));
  // Send-as gelijk aan account: geen dubbele term.
  const q3 = buildIngestSearchQuery({ accountKey: ACCOUNT, sendAsEmail: ACCOUNT });
  assert.equal(q3, `to:${ACCOUNT} -from:me`);
});

test("3. eigen studio-mail blijft uitgesloten: -from:me in de query én self-guard in de matcher", () => {
  const q = buildIngestSearchQuery({ accountKey: ACCOUNT, sendAsEmail: SEND_AS });
  assert.ok(q.includes("-from:me"), "eigen mail blijft uit de zoekresultaten");
  // Zelfs als een self-reply (van het gekoppelde account) de scan bereikt,
  // weigert de matcher vóór de In-Reply-To-controle: nooit eigen studio-mail
  // als klantreactie, ook niet met een geldige In-Reply-To.
  const self = findReplyTarget({
    headers: {
      from: `Silvijn <${ACCOUNT}>`,
      to: SEND_AS,
      inReplyTo: SENT_OUTREACH[0].provider_message_id,
      references: null,
      messageId: null,
      subject: "Re: Even opgevallen",
      date: null,
    },
    accountKey: ACCOUNT,
    sentOutreach: SENT_OUTREACH,
    leadEmails: LEAD_EMAILS,
    contactEmails: CONTACT_EMAILS,
    conversations: CONVERSATIONS,
  });
  assert.equal(self, null, "self-reply van het studio-account wordt weggefilterd");
});

test("4. echte prospect-reply aan het send-as-adres bereikt de bestaande matcher en matcht op In-Reply-To", () => {
  // Zoekopdracht bevat het send-as-adres zodat Gmail deze reply retourneert...
  const q = buildIngestSearchQuery({ accountKey: ACCOUNT, sendAsEmail: SEND_AS, afterEpochSeconds: 1750000000 });
  assert.ok(q.includes(`to:${SEND_AS}`));
  assert.ok(q.includes("after:1750000000"));
  // ...en de matcher koppelt hem via In-Reply-To aan lead + verzonden outreach.
  const match = findReplyTarget({
    headers: {
      from: "Klant <prospect@example.nl>",
      to: SEND_AS,
      inReplyTo: SENT_OUTREACH[0].provider_message_id,
      references: null,
      messageId: null,
      subject: "Re: Even opgevallen: uw studio in Utrecht",
      date: null,
    },
    accountKey: ACCOUNT,
    sentOutreach: SENT_OUTREACH,
    leadEmails: LEAD_EMAILS,
    contactEmails: CONTACT_EMAILS,
    conversations: CONVERSATIONS,
  });
  assert.ok(match, "prospect-reply aan info@ wordt gekoppeld");
  assert.equal(match!.matchReason, "in_reply_to");
  assert.equal(match!.leadId, "lead-1");
  assert.equal(match!.outreachId, "draft-1");
});

test("gmailListMessages stuurt de verbrede query naar de Gmail API", async () => {
  const calls: string[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ messages: [{ id: "m1", threadId: "t1" }], resultSizeEstimate: 1 }), { status: 200 });
  }) as typeof fetch;
  try {
    const page = await gmailListMessages("token", { accountKey: ACCOUNT, sendAsEmail: SEND_AS, afterEpochSeconds: 123 });
    assert.equal(page.messages.length, 1);
    assert.ok(calls[0].includes("/messages?"));
    const q = decodeURIComponent((calls[0].split("q=")[1] ?? "").split("&")[0]).replace(/\+/g, " ");
    assert.equal(q, `to:${ACCOUNT} OR to:${SEND_AS} -from:me after:123`);
  } finally {
    global.fetch = originalFetch;
  }
});
