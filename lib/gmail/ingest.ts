import "server-only";
import { z } from "zod";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getGmailAccessToken, markGmailIngested } from "./tokens";
import { isGmailConfigured, DEFAULT_GMAIL_ACCOUNT_KEY, GMAIL_SETTINGS_SCOPE, gmailSendAsEmail } from "./config";
import { gmailGetMessage, gmailListMessages } from "./client";
import { findReplyTarget, loadMatchContext } from "./matching";

/**
 * Gmail-inbox-ingestie: leest alléén berichten die (a) aan het
 * geautoriseerde studio-account zijn gericht en (b) matchen op een
 * bestaande lead of verstuurd outreach. Elke opgeslagen reactie is een
 * echte, via de API geconstateerde Gmail-reactie (source='gmail') en
 * idempotent per Gmail-bericht-ID.
 *
 * Geen ingest zonder geautoriseerde verbinding; er worden nooit leads
 * verzonnen of automatisch outreach verzonden.
 */

const INGEST_MAX_MESSAGES = 50;
const INGEST_LOOKBACK_DAYS = 30;

export interface GmailIngestResult {
  readonly accountKey: string;
  readonly scanned: number;
  readonly ingested: number;
  readonly unmatched: number;
  readonly lastIngestAt: string | null;
}

export async function ingestGmailInbox(): Promise<GmailIngestResult> {
  const { accessToken, connection } = await getGmailAccessToken();
  const accountKey = connection.account_key;

  const context = await loadMatchContext(accountKey);
  const lookbackSeconds = Math.floor(Date.now() / 1000) - INGEST_LOOKBACK_DAYS * 24 * 60 * 60;
  const cursorSeconds = connection.last_ingest_at
    ? Math.floor(new Date(connection.last_ingest_at).getTime() / 1000)
    : null;
  const after = Math.min(cursorSeconds ?? lookbackSeconds, lookbackSeconds);

  let scanned = 0;
  let ingested = 0;
  let unmatched = 0;
  let lastReceived: string | null = null;
  let pageToken: string | null = null;

  do {
    const page = await gmailListMessages(accessToken, {
      accountKey,
      afterEpochSeconds: after,
      maxResults: 25,
      pageToken,
    });
    for (const summary of page.messages) {
      if (scanned >= INGEST_MAX_MESSAGES) break;
      scanned += 1;
      const message = await gmailGetMessage(accessToken, summary.id);

      const match = findReplyTarget({ headers: message.headers, accountKey, ...context });
      if (!match) {
        unmatched += 1;
        continue;
      }

      const receivedAt = message.headers.date ? new Date(message.headers.date).toISOString() : new Date().toISOString();
      const body = (message.bodyText ?? message.snippet ?? "").trim();
      if (!body) {
        unmatched += 1;
        continue;
      }

      if (isSupabaseConfigured()) {
        const client = getSupabaseServerClient();
        const { data, error } = await client.rpc("ingest_gmail_reply", {
          p_lead: match.leadId,
          p_sender: message.headers.from ?? "",
          p_subject: message.headers.subject ?? "",
          p_body: body.slice(0, 50000),
          p_received: receivedAt,
          p_gmail_message_id: message.id,
          p_account_key: accountKey,
          p_thread: match.threadKey ?? `gmail:${accountKey}:${message.threadId}`,
          p_outreach: match.outreachId,
          p_in_reply_to: message.headers.inReplyTo,
          // Reply-threading: bewijsstukken waarmee een later AI-antwoord
          // als echte reply in deze Gmail-thread wordt verstuurd.
          p_provider_thread_id: message.threadId,
          p_provider_rfc_message_id: message.headers.messageId,
          p_provider_references: message.headers.references,
        });
        if (error) throw new Error(`Gmail-reactie kon niet worden vastgelegd: ${error.message}`);
        // De RPC is idempotent op providersleutel; hetzelfde bericht-ID
        // geeft dezelfde rij terug zonder tweede record.
        if (data) ingested += 1;
      }
      if (!lastReceived || receivedAt > lastReceived) lastReceived = receivedAt;
    }
    pageToken = page.nextPageToken;
  } while (pageToken && scanned < INGEST_MAX_MESSAGES);

  if (lastReceived) await markGmailIngested(accountKey, lastReceived);

  return {
    accountKey,
    scanned,
    ingested,
    unmatched,
    lastIngestAt: lastReceived,
  };
}

export interface GmailIngestStatus {
  readonly configured: boolean;
  readonly connected: boolean;
  readonly accountKey: string | null;
  readonly lastIngestAt: string | null;
  /** Het primaire Google Workspace-account dat gekoppeld moet zijn (GMAIL_ACCOUNT_KEY, standaard silvijn@silvijnstudio.com). */
  readonly requiredAccountKey: string;
  /** Of de koppeling de settings-scope heeft om "Verzenden als" en de handtekening te lezen. */
  readonly signatureScope: boolean;
  /** Het "Verzenden als"-alias dat het zichtbare From-adres van outreach is (GMAIL_SEND_AS, standaard info@silvijnstudio.com). */
  readonly sendAsEmail: string;
  /** Laatste live controle van het alias via settings.sendAs (null = nog nooit gecontroleerd). */
  readonly sendAs: {
    readonly status: "verified" | "pending" | "not_listed" | "unknown";
    readonly displayName: string | null;
    readonly reason: string | null;
    readonly checkedAt: string;
  } | null;
}

const connectionStatusSchema = z.object({
  account_key: z.string(),
  last_ingest_at: z.string().nullable(),
  scopes: z.string().nullable().optional(),
  send_as_email: z.string().nullable().optional(),
  send_as_status: z.enum(["verified", "pending", "not_listed", "unknown"]).nullable().optional(),
  send_as_display_name: z.string().nullable().optional(),
  send_as_reason: z.string().nullable().optional(),
  send_as_checked_at: z.string().nullable().optional(),
});

export async function gmailIngestStatus(): Promise<GmailIngestStatus> {
  const configured = isGmailConfigured();
  const requiredAccountKey = (process.env.GMAIL_ACCOUNT_KEY ?? DEFAULT_GMAIL_ACCOUNT_KEY).trim().toLowerCase();
  const sendAsEmail = gmailSendAsEmail();
  if (!isSupabaseConfigured()) {
    return { configured, connected: false, accountKey: null, lastIngestAt: null, requiredAccountKey, signatureScope: false, sendAsEmail, sendAs: null };
  }
  const client = getSupabaseServerClient();
  const { data } = await client
    .from("gmail_connections")
    .select("account_key,last_ingest_at,scopes,send_as_email,send_as_status,send_as_display_name,send_as_reason,send_as_checked_at")
    .eq("account_key", requiredAccountKey)
    .limit(1)
    .maybeSingle();
  const row = data ? connectionStatusSchema.parse(data) : null;
  return {
    configured,
    connected: row !== null,
    accountKey: row?.account_key ?? null,
    lastIngestAt: row?.last_ingest_at ?? null,
    requiredAccountKey,
    signatureScope: (row?.scopes ?? "").split(/\s+/).includes(GMAIL_SETTINGS_SCOPE),
    sendAsEmail,
    // Snapshot telt alleen voor het huidige alias-adres; een oud adres wordt als "nooit gecontroleerd" getoond.
    sendAs:
      row?.send_as_status && row.send_as_checked_at && (row.send_as_email ?? "").toLowerCase() === sendAsEmail
        ? {
            status: row.send_as_status,
            displayName: row.send_as_display_name ?? null,
            reason: row.send_as_reason ?? null,
            checkedAt: row.send_as_checked_at,
          }
        : null,
  };
}
