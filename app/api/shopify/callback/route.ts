import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import {
  exchangeAuthorizationCode,
  oauthCredentialsFromEnv,
  readState,
  verifyCallbackHmac,
  ShopifyOAuthError,
} from "@/lib/shopify/oauth";
import { saveConnection } from "@/lib/shopify/connections";

/**
 * Callback van de Shopify-installatie.
 *
 * Volgorde is bewust: eerst de HMAC van Shopify zelf, dan de ondertekende state,
 * dan pas de code inwisselen. Een ongeldige aanvraag raakt de database niet aan.
 * Het resulterende token wordt versleuteld opgeslagen per winkel en verlaat deze
 * route nooit: de respons bevat alleen de winkelnaam en de scope.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "BLOCKED_EXTERNAL_CONFIGURATION" }, { status: 503 });
  }

  const credentials = oauthCredentialsFromEnv();
  if (!credentials) {
    return NextResponse.json(
      { error: "BLOCKED_EXTERNAL_CONFIGURATION", detail: "SHOPIFY_API_KEY/SHOPIFY_API_SECRET ontbreken" },
      { status: 503 },
    );
  }

  const params: Record<string, string> = {};
  request.nextUrl.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  if (!verifyCallbackHmac(params, credentials)) {
    return NextResponse.json({ error: "INVALID_HMAC" }, { status: 401 });
  }

  let shop: string;
  try {
    shop = readState(params.state ?? "", credentials).shop;
  } catch (error) {
    if (error instanceof ShopifyOAuthError) {
      return NextResponse.json({ error: error.code }, { status: 401 });
    }
    throw error;
  }

  if (params.shop && params.shop !== shop) {
    return NextResponse.json({ error: "INVALID_STATE", detail: "winkel wijkt af van de state" }, { status: 401 });
  }

  if (!params.code) {
    return NextResponse.json({ error: "MISSING_CODE" }, { status: 400 });
  }

  try {
    const tokens = await exchangeAuthorizationCode({ shop, code: params.code, credentials });
    await saveConnection(tokens);
    return NextResponse.json({ connected: true, shop: tokens.shop, scope: tokens.scope });
  } catch (error) {
    if (error instanceof ShopifyOAuthError) {
      return NextResponse.json({ error: error.code, detail: error.message }, { status: 502 });
    }
    return NextResponse.json({ error: "STORE_FAILED" }, { status: 500 });
  }
}
