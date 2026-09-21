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

export async function gmailSend(
  accessToken: string,
  input: { to: string; subject: string; body: string; messageIdHeader: string; from: string } & GmailThreadSendOptions
): Promise<{ gmailMessageId: string; threadId: string }> {
  const headerLines = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Message-ID: ${input.messageIdHeader}`,
  ];
  if (input.inReplyTo) headerLines.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) headerLines.push(`References: ${input.references}`);
  const mime = [
    ...headerLines,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    input.body,
  ].join("\r\n");
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
