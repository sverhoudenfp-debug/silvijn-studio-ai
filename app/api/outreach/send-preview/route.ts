import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * Verzendvoorbeeld (droge run) van een outreach-draft. Read-only: bouwt exact
 * wat de echte verzending zou opbouwen (live send-as-controle, From, alias-
 * handtekening, threading, MIME) maar verzendt niets en schrijft niets.
 * Toegang: geldige eigenaarssessie of CRON_SECRET-header (x-cron-secret).
 * Body: { "draftId": "<uuid>" }.
 */
export const maxDuration = 60;

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

  let draftId: unknown;
  try {
    draftId = ((await request.json()) as { draftId?: unknown })?.draftId;
  } catch {
    draftId = undefined;
  }
  if (typeof draftId !== "string") {
    return NextResponse.json({ error: "draftId ontbreekt" }, { status: 400 });
  }

  try {
    const { buildOutreachSendPreview } = await import("@/lib/gmail/send-preview");
    const preview = await buildOutreachSendPreview(draftId);
    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
