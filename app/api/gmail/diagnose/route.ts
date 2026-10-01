import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * Read-only Gmail-ingest-diagnose. Doorzoekt de GEKOPPELDE productie-
 * mailbox met exact dezelfde zoekopdracht als de ingest (inclusief
 * spam/trash) en rapporteert per bericht: headers, locatie (spam/trash)
 * en de match-beslissing (waarom wel/niet gekoppeld).
 *
 * Schrijft NIETS: geen cursor, geen database-mutatie, geen verzending.
 * Toegang: geldige eigenaarssessie (cookie) of CRON_SECRET-header.
 */

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const provided = request.headers.get("x-cron-secret") ?? "";
  const hasSecret = Boolean(secret) && provided === secret;

  let hasOwnerSession = false;
  if (!hasSecret) {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "BLOCKED_EXTERNAL_CONFIGURATION" }, { status: 503 });
    }
    const { getSessionClient } = await import("@/lib/auth/server");
    const client = await getSessionClient();
    const { data: { user } } = await client.auth.getUser();
    if (user) {
      const { data: owner } = await client.rpc("is_studio_owner");
      hasOwnerSession = owner === true;
    }
  }
  if (!hasSecret && !hasOwnerSession) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { getGmailAccessToken } = await import("@/lib/gmail/tokens");
  const { gmailGetMessage, gmailListMessages } = await import("@/lib/gmail/client");
  const { gmailSendAsEmail } = await import("@/lib/gmail/config");
  const { findReplyTarget, loadMatchContext } = await import("@/lib/gmail/matching");

  try {
    const { accessToken, connection } = await getGmailAccessToken();
    const accountKey = connection.account_key;
    const context = await loadMatchContext(accountKey);

    const scanned: unknown[] = [];
    let pageToken: string | null = null;
    let count = 0;
    do {
      const page = await gmailListMessages(accessToken, {
        accountKey,
        sendAsEmail: gmailSendAsEmail(),
        afterEpochSeconds: null,
        maxResults: 40,
        pageToken,
        includeSpamTrash: true,
      });
      for (const summary of page.messages) {
        if (count >= 40) break;
        count += 1;
        const message = await gmailGetMessage(accessToken, summary.id);
        const match = findReplyTarget({ headers: message.headers, accountKey, ...context });
        scanned.push({
          gmailMessageId: message.id,
          gmailThreadId: message.threadId,
          from: message.headers.from,
          to: message.headers.to,
          subject: message.headers.subject,
          date: message.headers.date,
          inReplyTo: message.headers.inReplyTo,
          references: message.headers.references,
          messageId: message.headers.messageId,
          match: match
            ? { matched: true, leadId: match.leadId, outreachId: match.outreachId, threadKey: match.threadKey, reason: match.matchReason }
            : { matched: false, reason: "no_in_reply_to_no_known_sender" },
          snippet: (message.snippet ?? message.bodyText ?? "").slice(0, 120),
        });
      }
      pageToken = page.nextPageToken;
    } while (pageToken && count < 40);

    return NextResponse.json({
      ok: true,
      accountKey,
      cursor: connection.last_ingest_at,
      scannedCount: count,
      scanned,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "gmail diagnose failed";
    const status = message.includes("BLOCKED_EXTERNAL_CONFIGURATION") ? 503 : 502;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
