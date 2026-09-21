import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Regressietests — Gmail reply-threading (fix open punt Fase C).
 *
 * Dekking:
 *  1. gmailSend zonder thread-context: geen In-Reply-To/References in de
 *     MIME en geen threadId in de send-body (initiele outreach start
 *     terecht een nieuwe thread — exact het oude gedrag).
 *  2. gmailSend met thread-context: In-Reply-To/References in de MIME,
 *     threadId in de send-body zodat Gmail het bericht in dezelfde
 *     conversatie plaatst.
 *  3. buildReplyThreadHeaders: de References-keten is de klant-References
 *     + onze verzonden Message-IDs + de Message-ID van de klantmail,
 *     gedupupeerd met behoud van volgorde (oud → nieuw).
 *  4. Randgevallen: geen klantmail-referenties, lege References, alleen
 *     een threadId, duplicaten in de keten.
 */

test("threading: initiële outreach heeft geen In-Reply-To, References of threadId", async () => {
  const { gmailSend } = await import("../lib/gmail/client");

  let captured: { body: Record<string, string> } | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    captured = { body: JSON.parse(String(init?.body)) as Record<string, string> };
    return new Response(JSON.stringify({ id: "gmail-id-x", threadId: "thread-x" }), { status: 200 });
  }) as typeof fetch;
  try {
    await gmailSend("token-abc", {
      from: "studio@silvijnstudio.com",
      to: "klant@example.nl",
      subject: "Website voor uw bedrijf",
      body: "Beste klant, ...",
      messageIdHeader: "<outreach-abc@silvijnstudio.com>",
    });
    const mime = Buffer.from(captured!.body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    assert.ok(!mime.includes("In-Reply-To:"), "initiele outreach mag geen In-Reply-To hebben");
    assert.ok(!mime.includes("References:"), "initiele outreach mag geen References hebben");
    assert.equal(captured!.body.threadId, undefined, "initiele outreach mag geen threadId meesturen");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("threading: antwoord krijgt In-Reply-To, References-keten en threadId", async () => {
  const { gmailSend } = await import("../lib/gmail/client");

  let captured: { body: Record<string, string> } | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    captured = { body: JSON.parse(String(init?.body)) as Record<string, string> };
    return new Response(JSON.stringify({ id: "gmail-id-y", threadId: "thread-klant-1" }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await gmailSend("token-abc", {
      from: "studio@silvijnstudio.com",
      to: "klant@example.nl",
      subject: "Re: Website voor uw bedrijf",
      body: "Hartelijk dank voor uw reactie, ...",
      messageIdHeader: "<outreach-antwoord-1@silvijnstudio.com>",
      inReplyTo: "<klant-mail-9@example.nl>",
      references: "<outreach-abc@silvijnstudio.com> <klant-mail-9@example.nl>",
      threadId: "thread-klant-1",
    });
    assert.equal(result.threadId, "thread-klant-1");
    const mime = Buffer.from(captured!.body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    assert.ok(mime.includes("In-Reply-To: <klant-mail-9@example.nl>"));
    assert.ok(mime.includes("References: <outreach-abc@silvijnstudio.com> <klant-mail-9@example.nl>"));
    assert.ok(mime.includes(`Message-ID: <outreach-antwoord-1@silvijnstudio.com>`));
    assert.equal(captured!.body.threadId, "thread-klant-1", "threadId moet in de send-body staan voor Gmail-threading");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("threading: buildReplyThreadHeaders bouwt de keten oud → nieuw zonder duplicaten", async () => {
  const { buildReplyThreadHeaders } = await import("../lib/gmail/threading");

  // Volledige keten: klant verwees naar onze outreach + zijn eigen eerdere
  // mail; wij hebben al één antwoord gestuurd; we beantwoorden de nieuwe mail.
  const headers = buildReplyThreadHeaders({
    latestInbound: {
      providerThreadId: "thread-klant-77",
      providerRfcMessageId: "<klant-mail-2@example.nl>",
      providerReferences: "<outreach-abc@silvijnstudio.com> <klant-mail-1@example.nl> <outreach-antwoord-1@silvijnstudio.com>",
    },
    sentMessageIds: ["<outreach-abc@silvijnstudio.com>", "<outreach-antwoord-1@silvijnstudio.com>"],
  });
  assert.equal(headers.inReplyTo, "<klant-mail-2@example.nl>");
  assert.equal(
    headers.references,
    "<outreach-abc@silvijnstudio.com> <klant-mail-1@example.nl> <outreach-antwoord-1@silvijnstudio.com> <klant-mail-2@example.nl>"
  );
  assert.equal(headers.threadId, "thread-klant-77");
});

test("threading: zonder klantmail-referenties blijft alles null (nieuw gesprek/oude ingest)", async () => {
  const { buildReplyThreadHeaders } = await import("../lib/gmail/threading");

  const geenInbound = buildReplyThreadHeaders({ latestInbound: null, sentMessageIds: ["<outreach-abc@silvijnstudio.com>"] });
  assert.deepEqual(geenInbound, { inReplyTo: null, references: null, threadId: null });

  const zonderBewijs = buildReplyThreadHeaders({
    latestInbound: { providerThreadId: null, providerRfcMessageId: null, providerReferences: null },
    sentMessageIds: [],
  });
  assert.deepEqual(zonderBewijs, { inReplyTo: null, references: null, threadId: null });
});

test("threading: threadId zonder RFC-Message-ID blijft bruikbaar; duplicaten worden gedupupeerd", async () => {
  const { buildReplyThreadHeaders } = await import("../lib/gmail/threading");

  // Gmail-threadId bewaard, In-Reply-To weg (geen RFC-bewijs van de klant).
  const alleenThreadId = buildReplyThreadHeaders({
    latestInbound: { providerThreadId: "thread-klant-88", providerRfcMessageId: null, providerReferences: null },
    sentMessageIds: [],
  });
  assert.equal(alleenThreadId.threadId, "thread-klant-88");
  assert.equal(alleenThreadId.inReplyTo, null);
  assert.equal(alleenThreadId.references, null);

  // Duplicaten (ook hoofdlettervarianten) verdwijnen; eerste positie wint.
  const gedupupeerd = buildReplyThreadHeaders({
    latestInbound: {
      providerThreadId: "thread-klant-99",
      providerRfcMessageId: "<Klant-Mail-3@Example.nl>",
      providerReferences: "<a@x.nl> <A@X.NL> <b@x.nl>",
    },
    sentMessageIds: ["<b@x.nl>"],
  });
  assert.equal(gedupupeerd.inReplyTo, "<Klant-Mail-3@Example.nl>");
  assert.equal(gedupupeerd.references, "<a@x.nl> <b@x.nl> <Klant-Mail-3@Example.nl>");
});
