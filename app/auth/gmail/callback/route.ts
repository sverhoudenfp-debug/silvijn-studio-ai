import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { requireStudioOwner } from "@/lib/auth/server";
import { exchangeGmailCode, verifyGmailStateCookie } from "@/lib/gmail/oauth";
import { saveGmailConnection } from "@/lib/gmail/tokens";
import { gmailGetProfile } from "@/lib/gmail/client";
import { requireGmailConfig } from "@/lib/gmail/config";
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
    // is (Gmail-profiel), niet het dashboard-loginadres. Alleen het vereiste
    // studio-account (GMAIL_ACCOUNT_KEY, standaard info@silvijnstudio.com) mag
    // worden opgeslagen; elk ander account wordt geweigerd met duidelijke uitleg.
    const { emailAddress } = await gmailGetProfile(tokens.accessToken);
    const required = requireGmailConfig().accountKey;
    if (emailAddress !== required) {
      const params = new URLSearchParams({ gmail_error: "wrong_account", authorized: emailAddress, required });
      return NextResponse.redirect(new URL(`/settings?${params.toString()}`, url));
    }
    await saveGmailConnection({
      accountKey: emailAddress,
      ownerUserId: user.id,
      refreshToken: tokens.refreshToken,
      scope: tokens.scope,
    });
    return NextResponse.redirect(new URL("/settings?gmail_connected=1", url));
  } catch {
    return NextResponse.redirect(new URL("/settings?gmail_error=exchange_failed", url));
  }
}
