/**
 * Shopify OAuth — authorization code grant voor meerdere klantwinkels (W11).
 *
 * Waarom deze flow en niet een statisch token:
 *  - Custom apps (handmatig token in de winkel) zijn per 1 januari 2026 vervallen
 *    voor nieuwe apps.
 *  - De client-credentials-grant werkt alleen voor winkels binnen je eigen
 *    organisatie en geeft een token van 24 uur. Voor externe klanten is dat geen
 *    geldige route.
 *  - De authorization code grant werkt per winkel die de app installeert, met een
 *    offline token per winkel. Met `expiring=1` krijg je een token van een uur plus
 *    een refresh token van 90 dagen: het minst kwetsbare model dat Shopify
 *    aanbeveelt voor apps die de GraphQL Admin API aanroepen.
 *
 * Deze module doet alleen het protocol: URL bouwen, HMAC verifiëren, code
 * inwisselen, refreshen. Opslag en isolatie staan in `connections.ts`.
 */

export const SHOPIFY_OAUTH_AUTHORIZE_URL = (shop: string): string =>
  `https://${shop}/admin/oauth/authorize`;
export const SHOPIFY_OAUTH_TOKEN_URL = (shop: string): string =>
  `https://${shop}/admin/oauth/access_token`;

/** Alleen *.myshopify.com, geen paden of query's: voorkomt open redirects. */
export function normaliseShopDomain(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value)) {
    throw new ShopifyOAuthError("INVALID_SHOP", "Ongeldig winkel domein; verwacht <naam>.myshopify.com");
  }
  return value;
}

export type ShopifyOAuthErrorCode =
  | "INVALID_SHOP"
  | "INVALID_HMAC"
  | "INVALID_STATE"
  | "TOKEN_EXCHANGE_FAILED"
  | "REFRESH_FAILED"
  | "MISSING_CREDENTIALS";

export class ShopifyOAuthError extends Error {
  readonly code: ShopifyOAuthErrorCode;

  constructor(code: ShopifyOAuthErrorCode, message: string) {
    super(message);
    this.name = "ShopifyOAuthError";
    this.code = code;
  }
}

export type ShopifyOAuthCredentials = {
  clientId: string;
  clientSecret: string;
};

export function oauthCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): ShopifyOAuthCredentials | null {
  const clientId = env.SHOPIFY_API_KEY?.trim();
  const clientSecret = env.SHOPIFY_API_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Scopes die de opleveringslaag nodig heeft; nooit breder vragen dan dit. */
export const SHOPIFY_REQUIRED_SCOPES = [
  "read_content",
  "write_content",
  "read_online_store_navigation",
  "write_online_store_navigation",
  "read_themes",
  "write_themes",
] as const;

export function buildAuthorizeUrl(input: {
  shop: string;
  credentials: ShopifyOAuthCredentials;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const shop = normaliseShopDomain(input.shop);
  const url = new URL(SHOPIFY_OAUTH_AUTHORIZE_URL(shop));
  url.searchParams.set("client_id", input.credentials.clientId);
  url.searchParams.set("scope", (input.scopes ?? SHOPIFY_REQUIRED_SCOPES).join(","));
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  // Offline token: de app werkt ook zonder aanwezigheid van een medewerker.
  // `expiring=1` levert een token van een uur plus refresh token.
  url.searchParams.set("expiring", "1");
  return url.toString();
}

/** State is een HMAC over winkel + nonce, zodat de callback niet te vervalsen is. */
export function createState(shop: string, nonce: string, credentials: ShopifyOAuthCredentials): string {
  const shopDomain = normaliseShopDomain(shop);
  const { createHmac } = require("node:crypto") as typeof import("node:crypto");
  const signature = createHmac("sha256", credentials.clientSecret).update(`${shopDomain}:${nonce}`).digest("hex");
  return Buffer.from(JSON.stringify({ shop: shopDomain, nonce, signature })).toString("base64url");
}

export function readState(state: string, credentials: ShopifyOAuthCredentials): { shop: string; nonce: string } {
  let parsed: { shop?: string; nonce?: string; signature?: string };
  try {
    parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    throw new ShopifyOAuthError("INVALID_STATE", "State is niet leesbaar");
  }
  if (!parsed.shop || !parsed.nonce || !parsed.signature) {
    throw new ShopifyOAuthError("INVALID_STATE", "State mist velden");
  }
  const expected = createState(parsed.shop, parsed.nonce, credentials);
  const expectedSignature = JSON.parse(Buffer.from(expected, "base64url").toString("utf8")).signature as string;
  const { timingSafeEqual } = require("node:crypto") as typeof import("node:crypto");
  const a = Buffer.from(expectedSignature, "hex");
  const b = Buffer.from(parsed.signature, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ShopifyOAuthError("INVALID_STATE", "State-handtekening klopt niet");
  }
  return { shop: normaliseShopDomain(parsed.shop), nonce: parsed.nonce };
}

/**
 * Verifieert de hmac uit de callback-query volgens Shopify's specificatie:
 * alle parameters behalve `hmac` en `signature`, gesorteerd, als querystring,
 * HMAC-SHA256 met het client secret.
 */
export function verifyCallbackHmac(
  params: Record<string, string | string[] | undefined>,
  credentials: ShopifyOAuthCredentials,
): boolean {
  const hmac = typeof params.hmac === "string" ? params.hmac : null;
  if (!hmac) return false;
  const pairs: string[] = [];
  for (const key of Object.keys(params).sort()) {
    if (key === "hmac" || key === "signature") continue;
    const value = params[key];
    if (value === undefined) continue;
    pairs.push(`${key}=${Array.isArray(value) ? value.join(",") : value}`);
  }
  const { createHmac, timingSafeEqual } = require("node:crypto") as typeof import("node:crypto");
  const digest = createHmac("sha256", credentials.clientSecret).update(pairs.join("&")).digest("hex");
  const a = Buffer.from(digest, "hex");
  const b = Buffer.from(hmac, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type ShopifyTokenSet = {
  shop: string;
  accessToken: string;
  scope: string;
  /** Seconden; uit de response, nooit hardcoded. */
  expiresIn: number | null;
  refreshToken: string | null;
  refreshTokenExpiresIn: number | null;
  obtainedAt: string;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function toTokenSet(shop: string, payload: Record<string, unknown>): ShopifyTokenSet {
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : null;
  if (!accessToken) throw new ShopifyOAuthError("TOKEN_EXCHANGE_FAILED", "Geen access_token in het antwoord");
  return {
    shop,
    accessToken,
    scope: typeof payload.scope === "string" ? payload.scope : "",
    expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : null,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    refreshTokenExpiresIn:
      typeof payload.refresh_token_expires_in === "number" ? payload.refresh_token_expires_in : null,
    obtainedAt: new Date().toISOString(),
  };
}

/** Wisselt de authorization code in voor een offline token (met refresh token). */
export async function exchangeAuthorizationCode(
  input: { shop: string; code: string; credentials: ShopifyOAuthCredentials },
  fetchImpl: FetchLike = fetch,
): Promise<ShopifyTokenSet> {
  const shop = normaliseShopDomain(input.shop);
  const response = await fetchImpl(SHOPIFY_OAUTH_TOKEN_URL(shop), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: input.credentials.clientId,
      client_secret: input.credentials.clientSecret,
      code: input.code,
    }),
  });

  if (!response.ok) {
    throw new ShopifyOAuthError("TOKEN_EXCHANGE_FAILED", `Token-uitwisseling faalde (HTTP ${response.status})`);
  }
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) throw new ShopifyOAuthError("TOKEN_EXCHANGE_FAILED", "Leeg antwoord bij token-uitwisseling");
  return toTokenSet(shop, payload);
}

/** Vraagt een nieuw access token met het refresh token (geen tussenkomst van de klant). */
export async function refreshAccessToken(
  input: { shop: string; refreshToken: string; credentials: ShopifyOAuthCredentials },
  fetchImpl: FetchLike = fetch,
): Promise<ShopifyTokenSet> {
  const shop = normaliseShopDomain(input.shop);
  const response = await fetchImpl(SHOPIFY_OAUTH_TOKEN_URL(shop), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: input.credentials.clientId,
      client_secret: input.credentials.clientSecret,
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    }),
  });

  if (!response.ok) {
    throw new ShopifyOAuthError("REFRESH_FAILED", `Vernieuwen faalde (HTTP ${response.status})`);
  }
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) throw new ShopifyOAuthError("REFRESH_FAILED", "Leeg antwoord bij vernieuwen");
  return toTokenSet(shop, payload);
}

/** True wanneer het token binnen de marge verloopt en vernieuwd moet worden. */
export function needsRefresh(token: ShopifyTokenSet, now: Date = new Date(), marginSeconds = 300): boolean {
  if (token.expiresIn === null) return false;
  const obtained = Date.parse(token.obtainedAt);
  if (Number.isNaN(obtained)) return true;
  return obtained + token.expiresIn * 1000 - marginSeconds * 1000 <= now.getTime();
}
