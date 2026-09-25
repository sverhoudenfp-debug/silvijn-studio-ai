import "server-only";

/**
 * Minimale Gmail REST-client (geen extra dependency): verzenden via
 * users.messages.send en lezen via users.messages.list/get. Alle calls
 * verlopen met het OAuth-access-token van de eigenaar; nooit met
 * wachtwoorden of API-keys.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailMessageSummary {
  readonly id: string;
  readonly threadId: string;
}

export interface GmailMessageHeaders {
  readonly messageId: string | null;
  readonly inReplyTo: string | null;
  readonly references: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly subject: string | null;
  readonly date: string | null;
}

export interface GmailMessage extends GmailMessageSummary {
  readonly headers: GmailMessageHeaders;
  readonly bodyText: string | null;
  readonly snippet: string | null;
}

interface GmailPayloadPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPayloadPart[];
}

interface GmailRawMessage {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: GmailPayloadPart;
}

export class GmailApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GmailApiError";
  }
}

async function gmailFetch(accessToken: string, url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    throw new GmailApiError(`Gmail API fout (HTTP ${response.status})`, response.status);
  }
  return response.json();
}

/** base64url-encode voor Gmail raw MIME. */
export function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Gmail body-data (base64url) decoderen. */
export function decodeBodyData(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function headerValue(headers: { name: string; value: string }[] | undefined, name: string): string | null {
  const found = headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  const value = found?.value?.trim();
  return value ? value : null;
}

/** E-mailadres uit een From/Toc-header halen ("Naam <a@b.nl>" → a@b.nl). */
export function extractEmailAddress(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const angle = headerValue.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : headerValue).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

/** Vraag de tekstuele body op: voorkeur text/plain boven text/html. */
export function extractBodyText(payload: GmailPayloadPart | undefined): string | null {
  if (!payload) return null;
  const stack: GmailPayloadPart[] = [payload];
  let htmlCandidate: string | null = null;
  while (stack.length > 0) {
    const part = stack.pop()!;
    if (part.filename) continue;
    if (part.mimeType === "text/plain" && part.body?.data) {
      return decodeBodyData(part.body.data);
    }
    if (part.mimeType === "text/html" && part.body?.data && htmlCandidate === null) {
      htmlCandidate = decodeBodyData(part.body.data);
    }
    if (part.parts) stack.push(...part.parts);
  }
  return htmlCandidate;
}

export function mapGmailMessage(raw: GmailRawMessage): GmailMessage {
  const headers = raw.payload?.headers;
  return {
    id: raw.id,
    threadId: raw.threadId,
    snippet: raw.snippet ?? null,
    headers: {
      messageId: headerValue(headers, "Message-ID"),
      inReplyTo: headerValue(headers, "In-Reply-To"),
      references: headerValue(headers, "References"),
      from: headerValue(headers, "From"),
      to: headerValue(headers, "To"),
      subject: headerValue(headers, "Subject"),
      date: headerValue(headers, "Date"),
    },
    bodyText: extractBodyText(raw.payload),
  };
}

/**
 * Verzenden: eigen Message-ID zodat antwoorden matchbaar blijven.
 *
 * Reply-threading: een antwoord op een prospect-reactie krijgt
 * inReplyTo (In-Reply-To-header), references (References-header) en
 * threadId (Gmail-threadId in de send-body, waarmee Gmail het bericht
 * in dezelfde conversatie plaatst). Initiele outreach laat deze weg:
 * dat bericht start terecht een nieuwe thread.
 */
export interface GmailThreadSendOptions {
  readonly inReplyTo?: string | null;
  readonly references?: string | null;
  readonly threadId?: string | null;
}

/** Het werkelijk geautoriseerde Gmail-account (users/me/profile). */
export async function gmailGetProfile(accessToken: string): Promise<{ emailAddress: string }> {
  const data = (await gmailFetch(accessToken, `${GMAIL_API}/profile`)) as { emailAddress?: string };
  const emailAddress = (data.emailAddress ?? "").trim().toLowerCase();
  if (!emailAddress) throw new GmailApiError("Gmail-profiel zonder e-mailadres", 502);
  return { emailAddress };
}

/**
 * De bestaande "Send as"-handtekening van het account (HTML zoals Gmail die
 * opslaat), of null wanneer er geen is ingesteld. Gmail voegt handtekeningen
 * bij API-sends nooit zelf toe; de aanroeper plakt deze precies één keer aan.
 */
export async function gmailGetSendAsSignature(accessToken: string, sendAsEmail: string): Promise<string | null> {
  const data = (await gmailFetch(
    accessToken,
    `${GMAIL_API}/settings/sendAs/${encodeURIComponent(sendAsEmail.trim().toLowerCase())}`
  )) as { signature?: string };
  const signature = (data.signature ?? "").trim();
  return signature.length > 0 ? signature : null;
}

/** HTML-handtekening naar leesbare platte tekst (voor het text/plain-deel). */
export function signatureHtmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      const t = text.replace(/<[^>]+>/g, "").trim();
      return t && t !== href ? `${t} (${href})` : href;
    })
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Platte e-mailtekst als eenvoudige HTML (alinea's + regelbreuken), zonder opmaakvrijheid voor de AI. */
export function plainBodyToHtml(body: string): string {
  return body
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

export interface GmailSignatureOptions {
  /** Gmail "Send as"-handtekening (HTML) van het verzendende account; precies één keer aangeplakt. */
  readonly signatureHtml?: string | null;
}

/**
 * Bouwt het bericht. Zonder handtekening: text/plain zoals altijd. Mét
 * handtekening: multipart/alternative met de tekst + handtekening als platte
 * tekst én als HTML (de opmaak van de Gmail-handtekening blijft behouden).
 * Threading-headers en Message-ID veranderen niet.
 */
export function buildGmailMime(
  input: { to: string; subject: string; body: string; messageIdHeader: string; from: string } & GmailThreadSendOptions & GmailSignatureOptions
): string {
  const headerLines = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Message-ID: ${input.messageIdHeader}`,
  ];
  if (input.inReplyTo) headerLines.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) headerLines.push(`References: ${input.references}`);
  const signatureHtml = (input.signatureHtml ?? "").trim();
  if (!signatureHtml) {
    return [
      ...headerLines,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      input.body,
    ].join("\r\n");
  }
  const signatureText = signatureHtmlToText(signatureHtml);
  const plain = `${input.body.trimEnd()}\n\n${signatureText}`;
  const html = `<div>${plainBodyToHtml(input.body)}\n<br>\n${signatureHtml}</div>`;
  const boundary = `sig_${input.messageIdHeader.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
  return [
    ...headerLines,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    plain,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
    `--${boundary}--`,
  ].join("\r\n");
}

export async function gmailSend(
  accessToken: string,
  input: { to: string; subject: string; body: string; messageIdHeader: string; from: string } & GmailThreadSendOptions & GmailSignatureOptions
): Promise<{ gmailMessageId: string; threadId: string }> {
  // RFC 5322: consequente CRLF-regeleinden in het hele bericht.
  const mime = buildGmailMime(input).replace(/\r?\n/g, "\r\n");
  const payload: Record<string, string> = { raw: base64UrlEncode(mime) };
  if (input.threadId) payload.threadId = input.threadId;
  const data = (await gmailFetch(accessToken, `${GMAIL_API}/messages/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })) as { id: string; threadId: string };
  return { gmailMessageId: data.id, threadId: data.threadId };
}

/** Inbox doorzoeken: berichten aan het studio-account, niet van onszelf. */
export async function gmailListMessages(
  accessToken: string,
  input: { accountKey: string; afterEpochSeconds?: number | null; maxResults?: number; pageToken?: string | null }
): Promise<{ messages: GmailMessageSummary[]; nextPageToken: string | null; resultSizeEstimate: number }> {
  const parts = [`to:${input.accountKey}`, "-from:me"];
  if (input.afterEpochSeconds) parts.push(`after:${input.afterEpochSeconds}`);
  const params = new URLSearchParams({
    q: parts.join(" "),
    maxResults: String(Math.min(Math.max(input.maxResults ?? 25, 1), 100)),
  });
  if (input.pageToken) params.set("pageToken", input.pageToken);
  const data = (await gmailFetch(accessToken, `${GMAIL_API}/messages?${params.toString()}`)) as {
    messages?: { id: string; threadId: string }[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  };
  return {
    messages: data.messages ?? [],
    nextPageToken: data.nextPageToken ?? null,
    resultSizeEstimate: data.resultSizeEstimate ?? 0,
  };
}

export async function gmailGetMessage(accessToken: string, id: string): Promise<GmailMessage> {
  const raw = (await gmailFetch(accessToken, `${GMAIL_API}/messages/${encodeURIComponent(id)}`)) as GmailRawMessage;
  return mapGmailMessage(raw);
}
