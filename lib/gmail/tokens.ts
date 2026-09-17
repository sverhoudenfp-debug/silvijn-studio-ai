import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { requireGmailConfig, isGmailConfigured } from "./config";
import { refreshGmailAccessToken } from "./oauth";

/**
 * Versleutelde opslag van de Gmail-credentials in gmail_connections.
 * - AES-256-GCM met GMAIL_TOKEN_ENCRYPTION_KEY (env, nooit in code).
 * - Refresh token verlaat het proces alleen als ciphertext.
 * - Access tokens worden per run opgehaald en nooit gepersisteerd.
 */

const TOKEN_STORE = new Map<string, { accessToken: string; expiresAt: number }>();

export interface GmailConnectionRow {
  readonly id: string;
  readonly account_key: string;
  readonly owner_user_id: string;
  readonly connected_at: string;
  readonly last_ingest_at: string | null;
  readonly scopes: string;
}

interface StoredToken {
  readonly refreshToken: string | null;
  readonly scope: string;
}

export function encryptTokenPayload(payload: StoredToken, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptTokenPayload(encoded: string, key: Buffer): StoredToken {
  const raw = Buffer.from(encoded, "base64");
  if (raw.length < 12 + 16) throw new Error("Gmail-tokenopslag ongeldig");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as StoredToken;
}

export async function saveGmailConnection(input: {
  accountKey: string;
  ownerUserId: string;
  refreshToken: string;
  scope: string;
}): Promise<void> {
  const config = requireGmailConfig();
  const tokenCiphertext = encryptTokenPayload({ refreshToken: input.refreshToken, scope: input.scope }, config.encryptionKey);
  const client = getSupabaseServerClient();
  const { error } = await client
    .from("gmail_connections")
    .upsert(
      {
        account_key: input.accountKey.toLowerCase(),
        owner_user_id: input.ownerUserId,
        token_ciphertext: tokenCiphertext,
        token_updated_at: new Date().toISOString(),
        scopes: input.scope,
      },
      { onConflict: "account_key" }
    );
  if (error) throw new Error("Gmail-verbinding kon niet worden opgeslagen");
}

export async function getGmailConnection(accountKey?: string): Promise<GmailConnectionRow | null> {
  if (!isSupabaseConfigured()) return null;
  const key = (accountKey ?? (process.env.GMAIL_ACCOUNT_KEY ?? "silvijn@silvijnstudio.com").trim().toLowerCase());
  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from("gmail_connections")
    .select("id,account_key,owner_user_id,connected_at,last_ingest_at,scopes")
    .eq("account_key", key.toLowerCase())
    .maybeSingle();
  if (error) throw new Error("Gmail-verbinding kon niet worden gelezen");
  return (data as GmailConnectionRow) ?? null;
}

/** Geldig access token voor het verbonden account; ververst zelf indien nodig. */
export async function getGmailAccessToken(accountKey?: string): Promise<{ accessToken: string; connection: GmailConnectionRow }> {
  if (!isGmailConfigured()) {
    throw new Error("BLOCKED_EXTERNAL_CONFIGURATION: Gmail OAuth is niet geconfigureerd");
  }
  const connection = await getGmailConnection(accountKey);
  if (!connection) throw new Error("GMAIL_NOT_CONNECTED: verbind het studio-account in Settings");
  const config = requireGmailConfig();

  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from("gmail_connections")
    .select("token_ciphertext")
    .eq("id", connection.id)
    .single();
  if (error || !data) throw new Error("Gmail-verbinding kon niet worden gelezen");

  const stored = decryptTokenPayload(data.token_ciphertext, config.encryptionKey);
  if (!stored.refreshToken) throw new Error("GMAIL_NOT_CONNECTED: geen refresh token — opnieuw autoriseren in Settings");

  const cached = TOKEN_STORE.get(connection.account_key);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return { accessToken: cached.accessToken, connection };
  }
  const refreshed = await refreshGmailAccessToken(stored.refreshToken);
  TOKEN_STORE.set(connection.account_key, { accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt });
  return { accessToken: refreshed.accessToken, connection };
}

export async function disconnectGmailConnection(accountKey?: string): Promise<void> {
  const key = (accountKey ?? (process.env.GMAIL_ACCOUNT_KEY ?? "silvijn@silvijnstudio.com").trim().toLowerCase());
  TOKEN_STORE.delete(key.toLowerCase());
  const client = getSupabaseServerClient();
  const { error } = await client.from("gmail_connections").delete().eq("account_key", key.toLowerCase());
  if (error) throw new Error("Gmail-verbinding kon niet worden verwijderd");
}

export async function markGmailIngested(accountKey: string, at: string): Promise<void> {
  const client = getSupabaseServerClient();
  const { error } = await client
    .from("gmail_connections")
    .update({ last_ingest_at: at })
    .eq("account_key", accountKey.toLowerCase());
  if (error) throw new Error("Ingest-cursor kon niet worden bijgewerkt");
}
