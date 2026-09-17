import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { GMAIL_SCOPES, requireGmailConfig, GmailConfigurationError, gmailRedirectUriForHost } from "./config";

/**
 * Google OAuth 2.0 voor Gmail — alleen de geautoriseerde flow, nooit
 * wachtwoorden. Refresh tokens worden versleuteld opgeslagen
 * (zie tokens.ts); het access token blijft alleen in-memory per run.
 */

export interface GmailAuthUrl {
  readonly url: string;
  readonly state: string;
  readonly redirectUri: string;
}

export function buildGmailAuthUrl(host: string): GmailAuthUrl {
  const config = requireGmailConfig();
  const redirectUri =
    (process.env.GMAIL_REDIRECT_URI ?? "").trim() || gmailRedirectUriForHost(host);
  if (!redirectUri) {
    throw new GmailConfigurationError(
      `BLOCKED_EXTERNAL_CONFIGURATION: host '${host}' staat niet op de Gmail-redirect-allowlist.`
    );
  }
  const state = randomBytes(24).toString("base64url");
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    // Login-hint: alleen het geautoriseerde studio-account.
    login_hint: config.accountKey,
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, state, redirectUri };
}

export interface GmailTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: number; // epoch ms
  readonly scope: string;
}

export async function exchangeGmailCode(code: string, host: string): Promise<GmailTokenSet> {
  const config = requireGmailConfig();
  const redirectUri =
    (process.env.GMAIL_REDIRECT_URI ?? "").trim() || gmailRedirectUriForHost(host);
  if (!redirectUri) throw new GmailConfigurationError("Redirect-URI ontbreekt of host niet toegestaan.");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) {
    throw new GmailConfigurationError("Gmail OAuth-code-uitwisseling mislukt — controleer client-id/secret en redirect-URI.");
  }
  const data = (await response.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope: string };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? GMAIL_SCOPES.join(" "),
  };
}

export async function refreshGmailAccessToken(refreshToken: string): Promise<GmailTokenSet> {
  const config = requireGmailConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    throw new GmailConfigurationError("Gmail-token-vernieuwing mislukt — verbinding opnieuw autoriseren in Settings.");
  }
  const data = (await response.json()) as { access_token: string; expires_in: number; scope?: string };
  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? GMAIL_SCOPES.join(" "),
  };
}

/** Verifieert dat de ingestrede dezelfde staat terugstuurt die we uitreikten. */
export function verifyGmailStateCookie(state: string | null, cookieState: string | null): boolean {
  if (!state || !cookieState) return false;
  // Constant-time vergelijking.
  const a = createHash("sha256").update(state).digest();
  const b = createHash("sha256").update(cookieState).digest();
  return a.length === b.length && a.equals(b);
}
