import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * Ingest-endpoint voor de Gmail-inbox (Masterconfig C/E). Wordt elke 15
 * minuten aangeroepen door de externe planner (Base44-workflow
 * "Gmail-ingest elke 15 minuten" → backend function gmailIngestTick) met de
 * CRON_SECRET-header; daarnaast handmatig triggerbaar door de eigenaar via
 * Settings (server action). Dit endpoint koppelt uitsluitend echte
 * antwoorden (idempotente RPC); de AI-reply-pipeline blijft een expliciet
 * eigenaarscommando en wordt hier bewust nooit gestart.
 *
 * Toegang: geldige eigenaarssessie (cookie) of CRON_SECRET-header.
 * Zonder credentials en zonder geautoriseerde Gmail-verbinding faalt
 * de call expliciet; er wordt nooit gefaked of gemockt.
 */
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
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "gmail ingest failed";
    const status = message.includes("BLOCKED_EXTERNAL_CONFIGURATION") ? 503 : 502;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
