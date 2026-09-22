import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * Ingest-endpoint voor de Gmail-inbox (Masterconfig C/E). Wordt elke 15
 * minuten aangeroepen door de externe planner (Base44-workflow
 * "Gmail-ingest elke 15 minuten" → backend function gmailIngestTick) met de
 * CRON_SECRET-header; daarnaast handmatig triggerbaar door de eigenaar via
 * Settings (server action). Dit endpoint koppelt echte antwoorden
 * (idempotente RPC) en start daarna — uitsluitend als de eigenaar dat in
 * studio_settings.reply_handling_mode heeft ingesteld — de bestaande
 * reply-pipeline: "review" maakt alleen antwoordconcepten, "auto" antwoordt
 * waar de pipeline dat toestaat (escalaties, opt-outs, prijsvragen en
 * quality-fails blijven menselijk). Default "off" = gedrag van vóór 0028.
 *
 * Toegang: geldige eigenaarssessie (cookie) of CRON_SECRET-header.
 * Zonder credentials en zonder geautoriseerde Gmail-verbinding faalt
 * de call expliciet; er wordt nooit gefaked of gemockt.
 */
// Ingest + AI-analyse van meerdere reacties kan langer duren dan de default.
export const maxDuration = 300;

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

  const { ingestGmailInbox } = await import("@/lib/gmail/ingest");
  try {
    const result = await ingestGmailInbox();
    const { getReplyHandlingMode } = await import("@/lib/settings/studio-settings");
    const mode = await getReplyHandlingMode();
    let replyHandling: { mode: string; processed: number; answered: number; draftsForReview: number; escalated: number; optedOut: number; errors: string[] } = {
      mode, processed: 0, answered: 0, draftsForReview: 0, escalated: 0, optedOut: 0, errors: [],
    };
    if (mode !== "off") {
      const { processPendingReplies } = await import("@/lib/sales/reply-pipeline");
      const run = await processPendingReplies({ ownerUserId: null, trigger: "gmail_ingest", mode, limit: 10 });
      replyHandling = {
        mode,
        processed: run.processedCount,
        answered: run.sentCount,
        draftsForReview: run.outcomes.filter((o) => o.outcome === "draft_for_review").length,
        escalated: run.escalatedCount,
        optedOut: run.outcomes.filter((o) => o.outcome === "opted_out").length,
        errors: run.errors,
      };
    }
    return NextResponse.json({ ok: true, result, replyHandling });
  } catch (error) {
    const message = error instanceof Error ? error.message : "gmail ingest failed";
    const status = message.includes("BLOCKED_EXTERNAL_CONFIGURATION") ? 503 : 502;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
