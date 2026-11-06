import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import {
  buildAuthorizeUrl,
  createState,
  oauthCredentialsFromEnv,
  normaliseShopDomain,
  ShopifyOAuthError,
} from "@/lib/shopify/oauth";
import { randomBytes } from "node:crypto";

/**
 * Start de Shopify-installatie voor één winkel (authorization code grant).
 *
 * Alleen voor de studio-eigenaar: dit is geen publieke endpoint. De winkel komt
 * uit de query, wordt genormaliseerd naar <naam>.myshopify.com en gaat mee in een
 * ondertekende state, zodat de callback niet naar een andere winkel te wijzigen is.
 *
 * Gebruik: /api/shopify/install?shop=silvijnstudiotest.myshopify.com
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "BLOCKED_EXTERNAL_CONFIGURATION" }, { status: 503 });
  }

  const { getSessionClient } = await import("@/lib/auth/server");
  const client = await getSessionClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { data: owner } = await client.rpc("is_studio_owner");
  if (owner !== true) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const credentials = oauthCredentialsFromEnv();
  if (!credentials) {
    return NextResponse.json(
      {
        error: "BLOCKED_EXTERNAL_CONFIGURATION",
        detail:
          "SHOPIFY_API_KEY en SHOPIFY_API_SECRET ontbreken. Voeg ze toe via het secretformulier of de Vercel-omgevingsvariabelen.",
      },
      { status: 503 },
    );
  }

  const shopParam = request.nextUrl.searchParams.get("shop");
  if (!shopParam) {
    return NextResponse.json({ error: "MISSING_SHOP" }, { status: 400 });
  }

  let shop: string;
  try {
    shop = normaliseShopDomain(shopParam);
  } catch (error) {
    if (error instanceof ShopifyOAuthError) {
      return NextResponse.json({ error: error.code, detail: error.message }, { status: 400 });
    }
    throw error;
  }

  const redirectUri = new URL("/api/shopify/callback", request.nextUrl.origin).toString();
  const state = createState(shop, randomBytes(16).toString("hex"), credentials);
  const authorizeUrl = buildAuthorizeUrl({ shop, credentials, redirectUri, state });

  return NextResponse.redirect(authorizeUrl);
}
