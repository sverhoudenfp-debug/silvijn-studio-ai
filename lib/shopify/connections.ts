import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import {
  needsRefresh,
  oauthCredentialsFromEnv,
  refreshAccessToken,
  normaliseShopDomain,
  type ShopifyTokenSet,
} from "./oauth";

/**
 * Meerdere klantwinkels, elk met een eigen offline token (W11).
 *
 * - Eén rij per winkel in `shopify_connections`; de winkel is de tenant-sleutel.
 * - Tokens staan AES-256-GCM versleuteld in de kolom `token_ciphertext`.
 * - De sleutel komt uit SHOPIFY_TOKEN_ENCRYPTION_KEY (env), nooit uit de database.
 * - Verversen gebeurt vlak voor gebruik, niet op een achtergrondklok.
 * - Geen enkele functie geeft een token terug aan de client; alleen servercode
 *   haalt het token op via `withShopToken`.
 */

const TABLE = "shopify_connections";

export class ShopifyConnectionError extends Error {
  readonly code: "BLOCKED_EXTERNAL_CONFIGURATION" | "NOT_CONNECTED" | "REFRESH_FAILED" | "STORE_FAILED";

  constructor(code: ShopifyConnectionError["code"], message: string) {
    super(message);
    this.name = "ShopifyConnectionError";
    this.code = code;
  }
}

export type ShopifyConnection = {
  shop: string;
  scope: string;
  tokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  connectedAt: string;
  updatedAt: string;
};

type Row = {
  shop: string;
  scope: string;
  token_ciphertext: string;
  token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  connected_at: string;
  updated_at: string;
};

function encryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.SHOPIFY_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new ShopifyConnectionError(
      "BLOCKED_EXTERNAL_CONFIGURATION",
      "SHOPIFY_TOKEN_ENCRYPTION_KEY ontbreekt; tokens kunnen niet veilig worden opgeslagen",
    );
  }
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new ShopifyConnectionError(
      "BLOCKED_EXTERNAL_CONFIGURATION",
      "SHOPIFY_TOKEN_ENCRYPTION_KEY moet 32 bytes zijn (64 hex-tekens of base64)",
    );
  }
  return key;
}

type SecretPayload = { accessToken: string; refreshToken: string | null };

export function encryptShopToken(payload: SecretPayload, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), "utf8")), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decryptShopToken(encoded: string, key: Buffer): SecretPayload {
  const raw = Buffer.from(encoded, "base64");
  if (raw.length < 28) throw new ShopifyConnectionError("STORE_FAILED", "Tokenopslag is ongeldig");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  const plaintext = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(plaintext) as SecretPayload;
  if (!parsed.accessToken) throw new ShopifyConnectionError("STORE_FAILED", "Tokenopslag mist een access token");
  return parsed;
}

function requireStore() {
  if (!isSupabaseConfigured()) {
    throw new ShopifyConnectionError("BLOCKED_EXTERNAL_CONFIGURATION", "Supabase is niet geconfigureerd");
  }
  return getSupabaseServerClient();
}

/** Slaat een token set versleuteld op; bestaande rij voor dezelfde winkel wordt bijgewerkt. */
export async function saveConnection(tokens: ShopifyTokenSet, key: Buffer = encryptionKey()): Promise<void> {
  const shop = normaliseShopDomain(tokens.shop);
  const now = new Date();
  const row = {
    shop,
    scope: tokens.scope,
    token_ciphertext: encryptShopToken({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }, key),
    token_expires_at: tokens.expiresIn ? new Date(now.getTime() + tokens.expiresIn * 1000).toISOString() : null,
    refresh_token_expires_at: tokens.refreshTokenExpiresIn
      ? new Date(now.getTime() + tokens.refreshTokenExpiresIn * 1000).toISOString()
      : null,
    updated_at: now.toISOString(),
  };

  const store = requireStore();
  const { error } = await store.from(TABLE).upsert(row, { onConflict: "shop" });
  if (error) throw new ShopifyConnectionError("STORE_FAILED", "Token opslaan faalde");
}

/** Verbonden winkels, zonder tokenmateriaal. */
export async function listConnections(): Promise<ShopifyConnection[]> {
  const store = requireStore();
  const { data, error } = await store
    .from(TABLE)
    .select("shop, scope, token_expires_at, refresh_token_expires_at, connected_at, updated_at")
    .order("connected_at", { ascending: true });
  if (error) throw new ShopifyConnectionError("STORE_FAILED", "Winkels ophalen faalde");

  return (data ?? []).map((row) => ({
    shop: String(row.shop),
    scope: String(row.scope ?? ""),
    tokenExpiresAt: (row.token_expires_at as string | null) ?? null,
    refreshTokenExpiresAt: (row.refresh_token_expires_at as string | null) ?? null,
    connectedAt: String(row.connected_at),
    updatedAt: String(row.updated_at),
  }));
}

/**
 * Geeft een geldig access token voor precies één winkel en vernieuwt het zo nodig.
 * De aanroeper krijgt nooit een token van een andere winkel: de winkel is de
 * enige selectiesleutel en wordt genormaliseerd voordat er iets wordt gelezen.
 */
export async function getAccessToken(shopInput: string, key: Buffer = encryptionKey()): Promise<string> {
  const shop = normaliseShopDomain(shopInput);
  const store = requireStore();
  const { data, error } = await store.from(TABLE).select("*").eq("shop", shop).maybeSingle<Row>();
  if (error) throw new ShopifyConnectionError("STORE_FAILED", "Winkel ophalen faalde");
  if (!data) throw new ShopifyConnectionError("NOT_CONNECTED", `Winkel ${shop} is niet gekoppeld`);

  const secret = decryptShopToken(data.token_ciphertext, key);
  const token: ShopifyTokenSet = {
    shop,
    accessToken: secret.accessToken,
    scope: data.scope,
    expiresIn: data.token_expires_at
      ? Math.max(0, Math.round((Date.parse(data.token_expires_at) - Date.now()) / 1000))
      : null,
    refreshToken: secret.refreshToken,
    refreshTokenExpiresIn: null,
    obtainedAt: new Date().toISOString(),
  };

  if (!needsRefresh(token)) return secret.accessToken;

  const credentials = oauthCredentialsFromEnv();
  if (!credentials || !secret.refreshToken) {
    throw new ShopifyConnectionError(
      "REFRESH_FAILED",
      `Token van ${shop} is verlopen en kan niet worden vernieuwd; koppel de winkel opnieuw`,
    );
  }

  const refreshed = await refreshAccessToken({ shop, refreshToken: secret.refreshToken, credentials });
  await saveConnection(refreshed, key);
  return refreshed.accessToken;
}

/** Ontkoppelt een winkel; het token verdwijnt uit de database. */
export async function disconnectShop(shopInput: string): Promise<void> {
  const shop = normaliseShopDomain(shopInput);
  const store = requireStore();
  const { error } = await store.from(TABLE).delete().eq("shop", shop);
  if (error) throw new ShopifyConnectionError("STORE_FAILED", "Ontkoppelen faalde");
}
