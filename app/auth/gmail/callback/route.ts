import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { requireStudioOwner } from "@/lib/auth/server";
import { exchangeGmailCode, verifyGmailStateCookie } from "@/lib/gmail/oauth";
import { saveGmailConnection } from "@/lib/gmail/tokens";
import { gmailGetProfile, gmailListSendAs } from "@/lib/gmail/client";
import { requireGmailConfig } from "@/lib/gmail/config";
import { resolveSendAsAlias } from "@/lib/gmail/send-as";
import { toSnapshot } from "@/lib/gmail/send-as-check";
import { GMAIL_STATE_COOKIE } from "@/lib/gmail/oauth-state";

/**
 * OAuth 2.0 callback voor Gmail — alléén bereikbaar voor de
 * geverifieerde studio-eigenaar. Code wordt direct server-side
 * tegen Google gewisseld; de refresh token wordt versleuteld
 * opgeslagen en verlaat nooit als plaintext het proces.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const errorParam = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (errorParam) {
    return NextResponse.redirect(new URL(`/settings?gmail_error=${encodeURIComponent(errorParam)}`, url));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL("/settings?gmail_error=missing_code", url));
  }

  const cookieState = (await cookies()).get(GMAIL_STATE_COOKIE)?.value ?? null;
  (await cookies()).delete(GMAIL_STATE_COOKIE);
  if (!verifyGmailStateCookie(state, cookieState)) {
    return NextResponse.redirect(new URL("/settings?gmail_error=state_mismatch", url));
  }

  try {
    const { user } = await requireStudioOwner();
    const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host).split(",")[0].trim();
    const tokens = await exchangeGmailCode(code, host);
    if (!tokens.refreshToken) {
      return NextResponse.redirect(new URL("/settings?gmail_error=no_refresh_token", url));
    }
    // Het gekoppelde account is het Google-account dat werkelijk geautoriseerd
    // is (Gmail-profiel), niet het dashboard-loginadres. Alleen het primaire
    // studio-account (GMAIL_ACCOUNT_KEY; zie lib/gmail/config.ts) mag worden
    // opgeslagen; elk ander account wordt geweigerd met uitleg.
    const { emailAddress } = await gmailGetProfile(tokens.accessToken);
    const config = requireGmailConfig();
    if (emailAddress !== config.accountKey) {
      const params = new URLSearchParams({ gmail_error: "wrong_account", authorized: emailAddress, required: config.accountKey });
      return NextResponse.redirect(new URL(`/settings?${params.toString()}`, url));
    }
    // "Verzenden als"-alias (GMAIL_SEND_AS) live controleren via settings.sendAs.list.
    // De verbinding wordt altijd opgeslagen (inbox/threads werken op het
    // primaire account); de uitkomst van de aliascontrole wordt vastgelegd en
    // bepaalt of outreach mag verzenden. Er wordt niets bij Google aangemaakt.
    let sendAs;
    try {
      sendAs = resolveSendAsAlias(await gmailListSendAs(tokens.accessToken), config.sendAsEmail, emailAddress);
    } catch (error) {
      sendAs = {
        ok: false as const,
        status: "unknown" as const,
        reason: `Gmail API settings.sendAs.list mislukte: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    await saveGmailConnection({
      accountKey: emailAddress,
      ownerUserId: user.id,
      refreshToken: tokens.refreshToken,
      scope: tokens.scope,
      sendAs: toSnapshot(sendAs, config.sendAsEmail, new Date().toISOString()),
    });
    if (!sendAs.ok) {
      const params = new URLSearchParams({ gmail_connected: "1", send_as_status: sendAs.status });
      return NextResponse.redirect(new URL(`/settings?${params.toString()}`, url));
    }
    return NextResponse.redirect(new URL("/settings?gmail_connected=1", url));
  } catch {
    return NextResponse.redirect(new URL("/settings?gmail_error=exchange_failed", url));
  }
}
