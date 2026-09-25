import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

/**
 * Gmail-integratie — unit- en configuratietests (OAuth-config, tokens,
 * provider-selectie, verzend-MIME, matching). Live database-idempotentie
 * en conversatie-activering staan in scripts/test-gmail-integration.sql.
 *
 * De mock-provider blijft de default: bestaande tests ongewijzigd.
 */

const ENV_BACKUP: Record<string, string | undefined> = {};

/** Zet na afloop alle gemuteerde variabelen exact terug. */
test.after(() => {
  for (const [key, value] of Object.entries(ENV_BACKUP)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in ENV_BACKUP)) ENV_BACKUP[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("gmail oauth configuration: fail-loud zonder credentials, geldig met credentials", async () => {
  setEnv({ GMAIL_CLIENT_ID: undefined, GMAIL_CLIENT_SECRET: undefined, GMAIL_TOKEN_ENCRYPTION_KEY: undefined });
  const { isGmailConfigured, requireGmailConfig, gmailRedirectUriForHost, GMAIL_REDIRECT_HOST_ALLOWLIST } =
    await import("../lib/gmail/config");
  assert.equal(isGmailConfigured(), false);
  assert.throws(() => requireGmailConfig(), /BLOCKED_EXTERNAL_CONFIGURATION/);

  setEnv({
    GMAIL_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    GMAIL_CLIENT_SECRET: "test-secret",
    GMAIL_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  });
  assert.equal(isGmailConfigured(), true);
  const config = requireGmailConfig();
  assert.equal(config.clientId, "test-client-id.apps.googleusercontent.com");
  // Primair OAuth-account = silvijn@ (Workspace-gebruiker); info@ is daarvan het "Verzenden als"-alias (GMAIL_SEND_AS).
  assert.equal(config.accountKey, "silvijn@silvijnstudio.com");
  assert.equal(config.sendAsEmail, "info@silvijnstudio.com");

  // Redirect-allowlist: productiehosts en localhost gelden; anders wordt
  // er expliciet geweigerd (open-redirect voorkomen).
  assert.equal(gmailRedirectUriForHost("app.silvijnstudio.com"), "https://app.silvijnstudio.com/auth/gmail/callback");
  assert.equal(gmailRedirectUriForHost("localhost:3000"), "http://localhost/auth/gmail/callback");
  assert.equal(gmailRedirectUriForHost("evil.example.com"), null);
  assert.ok(GMAIL_REDIRECT_HOST_ALLOWLIST.includes("app.silvijnstudio.com"));
  setEnv({ GMAIL_CLIENT_ID: undefined, GMAIL_CLIENT_SECRET: undefined, GMAIL_TOKEN_ENCRYPTION_KEY: undefined });
});

test("gmail auth url: oauth 2.0, offline access, scope, state, login-hint", async () => {
  setEnv({
    GMAIL_CLIENT_ID: "cid.apps.googleusercontent.com",
    GMAIL_CLIENT_SECRET: "secret",
    GMAIL_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  });
  const { buildGmailAuthUrl } = await import("../lib/gmail/oauth");
  const auth = buildGmailAuthUrl("app.silvijnstudio.com");
  const url = new URL(auth.url);
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), "cid.apps.googleusercontent.com");
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.silvijnstudio.com/auth/gmail/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("login_hint"), "silvijn@silvijnstudio.com", "login met het primaire account, niet met het alias");
  assert.ok(url.searchParams.get("scope")!.includes("gmail.send"));
  assert.ok(url.searchParams.get("scope")!.includes("gmail.readonly"));
  assert.ok(url.searchParams.get("scope")!.includes("gmail.settings.basic"), "handtekening lezen vereist settings.basic");
  assert.ok(url.searchParams.get("state")!.length >= 16);
  // Onbekende host → expliciete configuratiefout.
  assert.throws(() => buildGmailAuthUrl("evil.example.com"), /BLOCKED_EXTERNAL_CONFIGURATION/);
  setEnv({ GMAIL_CLIENT_ID: undefined, GMAIL_CLIENT_SECRET: undefined, GMAIL_TOKEN_ENCRYPTION_KEY: undefined });
});

test("gmail state-verificatie: alleen identieke state uit de eigen cookie", async () => {
  const { verifyGmailStateCookie } = await import("../lib/gmail/oauth");
  assert.equal(verifyGmailStateCookie("abc", "abc"), true);
  assert.equal(verifyGmailStateCookie("abc", "xyz"), false);
  assert.equal(verifyGmailStateCookie(null, "abc"), false);
  assert.equal(verifyGmailStateCookie("abc", null), false);
  assert.equal(verifyGmailStateCookie(null, null), false);
});

test("token-versleuteling: roundtrip + manipulatie faalt (AES-256-GCM)", async () => {
  setEnv({ GMAIL_CLIENT_ID: "cid", GMAIL_CLIENT_SECRET: "s", GMAIL_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64") });
  const { encryptTokenPayload, decryptTokenPayload } = await import("../lib/gmail/tokens");
  const { requireGmailConfig } = await import("../lib/gmail/config");
  const key = requireGmailConfig().encryptionKey;
  const ciphertext = encryptTokenPayload({ refreshToken: "1//refresh-secret", scope: "gmail.send gmail.readonly" }, key);
  assert.ok(!ciphertext.includes("1//refresh-secret"));
  const decrypted = decryptTokenPayload(ciphertext, key);
  assert.equal(decrypted.refreshToken, "1//refresh-secret");
  assert.equal(decrypted.scope, "gmail.send gmail.readonly");

  // Gemanipuleerde ciphertext (bit-flip) moet falen — GCM auth tag.
  const raw = Buffer.from(ciphertext, "base64");
  raw[raw.length - 1] ^= 0xff;
  assert.throws(() => decryptTokenPayload(raw.toString("base64"), key));

  // Onjuiste sleutel faalt ook.
  assert.throws(() => decryptTokenPayload(ciphertext, createHash("sha256").update("other").digest()));
  setEnv({ GMAIL_TOKEN_ENCRYPTION_KEY: undefined });
});

test("provider-selectie: mock default, gmail expliciet, onbekende provider fail-loud", async () => {
  setEnv({ EMAIL_PROVIDER: undefined, GMAIL_CLIENT_ID: undefined, GMAIL_CLIENT_SECRET: undefined, GMAIL_TOKEN_ENCRYPTION_KEY: undefined });
  const { getEmailProvider, MockEmailProvider } = await import("../lib/services/email");
  const defaultProvider = getEmailProvider();
  assert.ok(defaultProvider instanceof MockEmailProvider, "default blijft de mock (tests ongewijzigd)");

  // EMAIL_PROVIDER=gmail zonder OAuth-configuratie faalt bij constructie: nooit stil mock.
  setEnv({ EMAIL_PROVIDER: "gmail" });
  const { GmailEmailProvider } = await import("../lib/gmail/provider");
  assert.throws(() => new GmailEmailProvider(), /BLOCKED_EXTERNAL_CONFIGURATION/);
  setEnv({
    GMAIL_CLIENT_ID: "cid",
    GMAIL_CLIENT_SECRET: "s",
    GMAIL_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  });
  assert.ok(getEmailProvider() instanceof GmailEmailProvider);

  setEnv({ EMAIL_PROVIDER: "resend" });
  assert.throws(() => getEmailProvider(), /onbekende EMAIL_PROVIDER/);
  setEnv({ EMAIL_PROVIDER: undefined });
});

test("gmail verzend-MIME: eigen Message-ID, base64url, juiste headers", async () => {
  setEnv({
    GMAIL_CLIENT_ID: "cid",
    GMAIL_CLIENT_SECRET: "s",
    GMAIL_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  });
  const { gmailSend, base64UrlEncode, decodeBodyData, extractEmailAddress, extractBodyText } =
    await import("../lib/gmail/client");
  const { newOutreachMessageIdHeader } = await import("../lib/gmail/provider");

  const messageIdHeader = newOutreachMessageIdHeader();
  assert.match(messageIdHeader, /^<outreach-[0-9a-f]{32}@silvijnstudio\.com>$/);

  // fetch-mock: vang de call op en decodeer de raw MIME.
  let captured: { url: string; body: Record<string, string>; auth: string } | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    captured = {
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, string>,
      auth: String((init?.headers as Record<string, string>)?.Authorization ?? ""),
    };
    return new Response(JSON.stringify({ id: "gmail-id-1", threadId: "thread-9" }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await gmailSend("token-abc", {
      from: "silvijn@silvijnstudio.com",
      to: "klant@example.nl",
      subject: "Website voor uw bedrijf",
      body: "Beste klant, ...",
      messageIdHeader,
    });
    assert.equal(result.gmailMessageId, "gmail-id-1");
    assert.equal(result.threadId, "thread-9");
    assert.ok(captured!.url.endsWith("/messages/send"));
    assert.equal(captured!.auth, "Bearer token-abc");
    const mime = Buffer.from(captured!.body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    assert.ok(mime.includes("From: silvijn@silvijnstudio.com"));
    assert.ok(mime.includes("To: klant@example.nl"));
    assert.ok(mime.includes(`Message-ID: ${messageIdHeader}`));
    assert.ok(mime.includes("Subject: Website voor uw bedrijf"));
    assert.ok(mime.includes("Beste klant, ..."));
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(base64UrlEncode("hallo>wereld?"), "aGFsbG8-d2VyZWxkPw");
  assert.equal(decodeBodyData(base64UrlEncode("rondje")), "rondje");
  assert.equal(extractEmailAddress('"Klant" <Klant@Example.NL>'), "klant@example.nl");
  assert.equal(extractEmailAddress("plain@example.nl"), "plain@example.nl");
  assert.equal(extractEmailAddress("geen adres"), null);
  const body = extractBodyText({
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/html", body: { data: base64UrlEncode("<p>html</p>") } },
      { mimeType: "text/plain", body: { data: base64UrlEncode("platte tekst") } },
    ],
  });
  assert.equal(body, "platte tekst"); // text/plain heeft voorrang
  setEnv({ GMAIL_CLIENT_ID: undefined, GMAIL_CLIENT_SECRET: undefined, GMAIL_TOKEN_ENCRYPTION_KEY: undefined });
});

test("reply-matching: In-Reply-To eerst, daarna adres; nooit zelf of onbekend", async () => {
  const { findReplyTarget, referenceIds } = await import("../lib/gmail/matching");
  const accountKey = "silvijn@silvijnstudio.com";
  const sentOutreach = [
    { id: "out-1", lead_id: "lead-1", provider_message_id: "<outreach-abc@silvijnstudio.com>", provider_account_key: accountKey, conversation_id: "conv-1" },
    { id: "out-2", lead_id: "lead-2", provider_message_id: "<outreach-xyz@silvijnstudio.com>", provider_account_key: accountKey, conversation_id: null },
  ];
  const contactEmails = [{ lead_id: "lead-3", address: "bekend@example.nl" }];
  const leadEmails = [
    { lead_id: "lead-4", email: "direct@example.nl" },
    { lead_id: "lead-5", email: null },
  ];

  // 1. In-Reply-To matcht exact op het verzonden Message-ID.
  const byHeader = findReplyTarget({
    headers: { from: "een@anders.nl", inReplyTo: "<outreach-abc@silvijnstudio.com>", references: null, messageId: null, to: null, subject: "Re: Website", date: null },
    accountKey, sentOutreach, leadEmails, contactEmails,
  });
  assert.equal(byHeader?.leadId, "lead-1");
  assert.equal(byHeader?.outreachId, "out-1");
  assert.equal(byHeader?.matchReason, "in_reply_to");

  // 2. References-match werkt ook (sommige clients zetten alleen References).
  const byRefs = findReplyTarget({
    headers: { from: "twee@anders.nl", inReplyTo: null, references: "nr1 nr2 <outreach-xyz@silvijnstudio.com>", messageId: null, to: null, subject: null, date: null },
    accountKey, sentOutreach, leadEmails, contactEmails,
  });
  assert.equal(byRefs?.leadId, "lead-2");
  assert.equal(byRefs?.matchReason, "in_reply_to");

  // 3. Onbekend In-Reply-To valt door naar afzendermatch op lead_contact.
  const byContact = findReplyTarget({
    headers: { from: '"B" <bekend@example.nl>', inReplyTo: "<onbekend@id>", references: null, messageId: null, to: null, subject: null, date: null },
    accountKey, sentOutreach, leadEmails, contactEmails,
  });
  assert.equal(byContact?.leadId, "lead-3");
  assert.equal(byContact?.outreachId, null);
  assert.equal(byContact?.matchReason, "sender_contact");

  // 4. Afzendermatch op leads.email.
  const byLeadEmail = findReplyTarget({
    headers: { from: "direct@example.nl", inReplyTo: null, references: null, messageId: null, to: null, subject: null, date: null },
    accountKey, sentOutreach, leadEmails, contactEmails,
  });
  assert.equal(byLeadEmail?.leadId, "lead-4");
  assert.equal(byLeadEmail?.matchReason, "sender_lead_email");

  // 5. Volledig onbekende afzender → geen match (nooit leads verzinnen).
  const unknown = findReplyTarget({
    headers: { from: "vreemd@example.org", inReplyTo: null, references: null, messageId: null, to: null, subject: null, date: null },
    accountKey, sentOutreach, leadEmails, contactEmails,
  });
  assert.equal(unknown, null);

  // 6. Bericht van het studio-account zelf is nooit een prospect-reactie.
  const self = findReplyTarget({
    headers: { from: "Silvijn <silvijn@silvijnstudio.com>", inReplyTo: "<outreach-abc@silvijnstudio.com>", references: null, messageId: null, to: null, subject: null, date: null },
    accountKey, sentOutreach, leadEmails, contactEmails,
  });
  assert.equal(self, null);

  // 7. Subject- of snippet-gelijkenis matcht nooit op zichzelf.
  const bySubject = findReplyTarget({
    headers: { from: "anders@example.org", inReplyTo: null, references: null, messageId: null, to: null, subject: "Re: Website voor uw bedrijf", date: null },
    accountKey, sentOutreach, leadEmails, contactEmails,
  });
  assert.equal(bySubject, null);

  assert.deepEqual(referenceIds({ inReplyTo: "<a@x> ", references: " <b@x>\n<c@x>", messageId: null, from: null, to: null, subject: null, date: null }), ["<a@x>", "<b@x>", "<c@x>"]);
});
