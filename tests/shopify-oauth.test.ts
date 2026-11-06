import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAuthorizeUrl,
  createState,
  exchangeAuthorizationCode,
  needsRefresh,
  normaliseShopDomain,
  readState,
  refreshAccessToken,
  ShopifyOAuthError,
  verifyCallbackHmac,
  SHOPIFY_REQUIRED_SCOPES,
  type ShopifyTokenSet,
} from "../lib/shopify/oauth";

const credentials = { clientId: "client_123", clientSecret: "secret_abc" };

test("shopify-oauth: alleen echte myshopify-domeinen", () => {
  assert.equal(normaliseShopDomain("https://SilvijnStudioTest.myshopify.com/"), "silvijnstudiotest.myshopify.com");
  for (const invalid of ["evil.com", "silvijnstudiotest.myshopify.com.evil.com", "shop.myshopify.com/path", ""]) {
    assert.throws(() => normaliseShopDomain(invalid), (error: unknown) => {
      return error instanceof ShopifyOAuthError && error.code === "INVALID_SHOP";
    });
  }
});

test("shopify-oauth: authorize-URL vraagt offline token met expiring=1 en minimale scopes", () => {
  const url = new URL(
    buildAuthorizeUrl({
      shop: "silvijnstudiotest.myshopify.com",
      credentials,
      redirectUri: "https://example.com/api/shopify/callback",
      state: "state123",
    }),
  );
  assert.equal(url.hostname, "silvijnstudiotest.myshopify.com");
  assert.equal(url.pathname, "/admin/oauth/authorize");
  assert.equal(url.searchParams.get("expiring"), "1");
  assert.equal(url.searchParams.get("client_id"), "client_123");
  assert.equal(url.searchParams.get("scope"), SHOPIFY_REQUIRED_SCOPES.join(","));
  assert.ok(!url.searchParams.get("scope")!.includes("write_orders"), "geen onnodige orderrechten");
});

test("shopify-oauth: state is ondertekend en sabotage wordt geweigerd", () => {
  const state = createState("silvijnstudiotest.myshopify.com", "nonce-1", credentials);
  const parsed = readState(state, credentials);
  assert.equal(parsed.shop, "silvijnstudiotest.myshopify.com");

  const payload = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  payload.shop = "anderewinkel.myshopify.com";
  const tampered = Buffer.from(JSON.stringify(payload)).toString("base64url");
  assert.throws(() => readState(tampered, credentials), (error: unknown) => {
    return error instanceof ShopifyOAuthError && error.code === "INVALID_STATE";
  });
});

test("shopify-oauth: callback-hmac wordt geverifieerd volgens Shopify-specificatie", () => {
  const { createHmac } = require("node:crypto") as typeof import("node:crypto");
  const params: Record<string, string> = {
    code: "abc",
    shop: "silvijnstudiotest.myshopify.com",
    state: "xyz",
    timestamp: "1700000000",
  };
  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  const hmac = createHmac("sha256", credentials.clientSecret).update(message).digest("hex");

  assert.equal(verifyCallbackHmac({ ...params, hmac }, credentials), true);
  assert.equal(verifyCallbackHmac({ ...params, hmac: hmac.replace(/.$/, "0") }, credentials), false);
  assert.equal(verifyCallbackHmac(params, credentials), false);
});

test("shopify-oauth: code-uitwisseling leest expires_in en refresh_token uit de respons", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        access_token: "shpat_nieuw",
        scope: SHOPIFY_REQUIRED_SCOPES.join(","),
        expires_in: 3600,
        refresh_token: "shprt_vernieuw",
        refresh_token_expires_in: 7776000,
      }),
      { status: 200 },
    )) as unknown as typeof fetch;

  const tokens = await exchangeAuthorizationCode(
    { shop: "silvijnstudiotest.myshopify.com", code: "code", credentials },
    fetchImpl,
  );
  assert.equal(tokens.accessToken, "shpat_nieuw");
  assert.equal(tokens.expiresIn, 3600);
  assert.equal(tokens.refreshToken, "shprt_vernieuw");
  assert.equal(tokens.refreshTokenExpiresIn, 7776000);
});

test("shopify-oauth: mislukte uitwisseling geeft een eerlijke fout", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(
    () => exchangeAuthorizationCode({ shop: "silvijnstudiotest.myshopify.com", code: "x", credentials }, fetchImpl),
    (error: unknown) => error instanceof ShopifyOAuthError && error.code === "TOKEN_EXCHANGE_FAILED",
  );
});

test("shopify-oauth: vernieuwen gebruikt het refresh token en houdt de winkel", async () => {
  let body: any = null;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ access_token: "shpat_2", expires_in: 3600, refresh_token: "shprt_2" }), {
      status: 200,
    });
  }) as unknown as typeof fetch;

  const tokens = await refreshAccessToken(
    { shop: "silvijnstudiotest.myshopify.com", refreshToken: "shprt_1", credentials },
    fetchImpl,
  );
  assert.equal(body.grant_type, "refresh_token");
  assert.equal(body.refresh_token, "shprt_1");
  assert.equal(tokens.shop, "silvijnstudiotest.myshopify.com");
});

test("shopify-oauth: token wordt vernieuwd binnen de marge, niet onnodig vroeg", () => {
  const base = Date.parse("2026-11-06T12:00:00.000Z");
  const token: ShopifyTokenSet = {
    shop: "silvijnstudiotest.myshopify.com",
    accessToken: "shpat_x",
    scope: "",
    expiresIn: 3600,
    refreshToken: "shprt_x",
    refreshTokenExpiresIn: 7776000,
    obtainedAt: new Date(base).toISOString(),
  };
  assert.equal(needsRefresh(token, new Date(base + 10 * 60 * 1000)), false);
  assert.equal(needsRefresh(token, new Date(base + 56 * 60 * 1000)), true);
});
