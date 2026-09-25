import "server-only";

/**
 * Gmail-configuratie (Google OAuth 2.0) — alle credentials komen uit
 * environment variables, nooit uit code of database-plaintext.
 *
 * Vereist (Vercel Environment Variables / .env.local):
 *  - GMAIL_CLIENT_ID            (Google Cloud OAuth 2.0 Client-ID)
 *  - GMAIL_CLIENT_SECRET        (OAuth 2.0 Client-Secret)
 *  - GMAIL_TOKEN_ENCRYPTION_KEY (32 bytes, base64 of hex — AES-256-GCM
 *                                sleutel voor de versleutelde refresh token)
 * Optioneel:
 *  - GMAIL_ACCOUNT_KEY          (standaard silvijn@silvijnstudio.com) — het PRIMAIRE
 *                                Google Workspace-account dat via OAuth wordt gekoppeld.
 *                                De callback weigert elk ander Google-account.
 *  - GMAIL_SEND_AS              (standaard info@silvijnstudio.com) — het "Verzenden als"-
 *                                alias van dat account dat het zichtbare From-adres van
 *                                outreach is. Geen hardcoded From: bij elke verzending
 *                                valideert de Gmail API (settings.sendAs) dat het alias
 *                                bestaat en geverifieerd is; anders faalt verzenden luid.
 *  - GMAIL_REDIRECT_URI         (standaard afgeleid van de request-host)
 */

export class GmailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailConfigurationError";
  }
}

/**
 * Scopes: verzenden (gmail.send) + lezen (gmail.readonly) + basisinstellingen
 * (gmail.settings.basic: nodig om de bestaande Gmail-handtekening van het
 * account te lezen — de Gmail API voegt handtekeningen bij API-sends nooit
 * zelf toe; wij plakken de eigen "Send as"-handtekening precies één keer aan).
 */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.settings.basic",
] as const;
export const GMAIL_SETTINGS_SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";
export const DEFAULT_GMAIL_ACCOUNT_KEY = "silvijn@silvijnstudio.com";
export const DEFAULT_GMAIL_SEND_AS = "info@silvijnstudio.com";

/** Het vereiste "Verzenden als"-alias voor outreach (GMAIL_SEND_AS). */
export function gmailSendAsEmail(): string {
  return (process.env.GMAIL_SEND_AS ?? DEFAULT_GMAIL_SEND_AS).trim().toLowerCase();
}

/** Productie-hosts waarop de OAuth-callback mag landen. */
export const GMAIL_REDIRECT_HOST_ALLOWLIST = [
  "app.silvijnstudio.com",
  "silvijn-studio-ai.vercel.app",
] as const;

export interface GmailConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly encryptionKey: Buffer;
  readonly accountKey: string;
  /** Vereist "Verzenden als"-alias (zichtbaar From-adres van outreach). */
  readonly sendAsEmail: string;
}

export function isGmailConfigured(): boolean {
  return Boolean(
    (process.env.GMAIL_CLIENT_ID ?? "").trim() &&
      (process.env.GMAIL_CLIENT_SECRET ?? "").trim() &&
      parseEncryptionKey(process.env.GMAIL_TOKEN_ENCRYPTION_KEY) !== null
  );
}

function parseEncryptionKey(raw: string | undefined): Buffer | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  // Base64 (44 tekens incl. padding, 32 bytes) of hex (64 tekens).
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  const fromB64 = Buffer.from(value, "base64");
  return fromB64.length === 32 ? fromB64 : null;
}

export function requireGmailConfig(): GmailConfig {
  const clientId = (process.env.GMAIL_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GMAIL_CLIENT_SECRET ?? "").trim();
  const encryptionKey = parseEncryptionKey(process.env.GMAIL_TOKEN_ENCRYPTION_KEY);
  if (!clientId || !clientSecret || !encryptionKey) {
    throw new GmailConfigurationError(
      "BLOCKED_EXTERNAL_CONFIGURATION: Gmail OAuth is niet geconfigureerd (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_TOKEN_ENCRYPTION_KEY ontbreken of zijn ongeldig)."
    );
  }
  return {
    clientId,
    clientSecret,
    encryptionKey,
    accountKey: ((process.env.GMAIL_ACCOUNT_KEY ?? DEFAULT_GMAIL_ACCOUNT_KEY).trim().toLowerCase()),
    sendAsEmail: gmailSendAsEmail(),
  };
}

/** Redirect-URI voor de OAuth-callback op de opgegeven host. */
export function gmailRedirectUriForHost(host: string): string | null {
  const normalized = host.trim().toLowerCase().split(":")[0];
  const allowed: readonly string[] = [...GMAIL_REDIRECT_HOST_ALLOWLIST, "localhost"];
  if (!allowed.includes(normalized)) return null;
  const proto = normalized === "localhost" ? "http" : "https";
  return `${proto}://${normalized}/auth/gmail/callback`;
}
