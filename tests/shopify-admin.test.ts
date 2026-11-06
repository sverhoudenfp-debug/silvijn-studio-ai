import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deliverMainMenu,
  deliverPages,
  publishTheme,
  shopifyAdminConfigFromEnv,
  ShopifyAdminError,
  type ShopifyAdminConfig,
} from "../lib/shopify/admin";

const config: ShopifyAdminConfig = {
  shopDomain: "voorbeeld.myshopify.com",
  accessToken: "shpat_geheim_token",
};

type Call = { url: string; body: unknown };
type Handler = (body: any) => { status?: number; json: unknown; apiVersion?: string };

function fakeFetch(handler: Handler): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: String(url), body });
    const result = handler(body);
    return new Response(JSON.stringify(result.json), {
      status: result.status ?? 200,
      headers: {
        "Content-Type": "application/json",
        // Shopify bevestigt de gebruikte versie in de responseheader.
        "X-Shopify-API-Version": result.apiVersion ?? "2026-10",
      },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const page = {
  handle: "diensten",
  title: "Diensten",
  seoTitle: "Diensten – Tuinontwerp en aanleg | Veld & Vorm",
  seoDescription: "Tuinontwerp, tuinaanleg en onderhoud in Utrecht.",
  templateSuffix: "diensten",
};

test("shopify-admin: zonder omgevingsconfiguratie geen client", () => {
  assert.equal(shopifyAdminConfigFromEnv({} as unknown as NodeJS.ProcessEnv), null);
  assert.equal(
    shopifyAdminConfigFromEnv({ SHOPIFY_SHOP_DOMAIN: "x.myshopify.com" } as unknown as NodeJS.ProcessEnv),
    null,
  );
});

test("shopify-admin: nieuwe pagina wordt aangemaakt met template en SEO", async () => {
  const seen: string[] = [];
  const { fetchImpl } = fakeFetch((body) => {
    const query: string = body.query;
    if (query.includes("pages(first")) return { json: { data: { pages: { nodes: [] } } } };
    if (query.includes("pageCreate")) {
      seen.push("create");
      return { json: { data: { pageCreate: { page: { id: "gid://shopify/Page/1" }, userErrors: [] } } } };
    }
    if (query.includes("metafieldsSet")) {
      seen.push("seo");
      return { json: { data: { metafieldsSet: { metafields: [], userErrors: [] } } } };
    }
    return { json: { data: {} } };
  });

  const result = await deliverPages(config, [page], fetchImpl);
  assert.equal(result[0]?.action, "created");
  assert.equal(result[0]?.id, "gid://shopify/Page/1");
  assert.deepEqual(seen, ["create", "seo"]);
});

test("shopify-admin: bestaande pagina wordt bijgewerkt, niet gedupliceerd", async () => {
  let created = false;
  const { fetchImpl } = fakeFetch((body) => {
    const query: string = body.query;
    if (query.includes("pages(first")) {
      return { json: { data: { pages: { nodes: [{ id: "gid://shopify/Page/9", handle: "diensten" }] } } } };
    }
    if (query.includes("pageCreate")) {
      created = true;
      return { json: { data: {} } };
    }
    if (query.includes("pageUpdate")) {
      return { json: { data: { pageUpdate: { page: { id: "gid://shopify/Page/9" }, userErrors: [] } } } };
    }
    return { json: { data: { metafieldsSet: { userErrors: [] } } } };
  });

  const result = await deliverPages(config, [page], fetchImpl);
  assert.equal(result[0]?.action, "updated");
  assert.equal(created, false, "geen tweede pagina aangemaakt");
});

test("shopify-admin: SEO-metavelden bevatten de unieke paginawaarden", async () => {
  let sent: any = null;
  const { fetchImpl } = fakeFetch((body) => {
    const query: string = body.query;
    if (query.includes("pages(first")) return { json: { data: { pages: { nodes: [{ id: "gid://shopify/Page/9" }] } } } };
    if (query.includes("pageUpdate")) {
      return { json: { data: { pageUpdate: { page: { id: "gid://shopify/Page/9" }, userErrors: [] } } } };
    }
    sent = body.variables.metafields;
    return { json: { data: { metafieldsSet: { userErrors: [] } } } };
  });

  await deliverPages(config, [page], fetchImpl);
  const keys = sent.map((field: any) => field.key).sort();
  assert.deepEqual(keys, ["description_tag", "title_tag"]);
  assert.equal(sent.find((f: any) => f.key === "title_tag").value, page.seoTitle);
});

test("shopify-admin: token lekt niet in foutmeldingen", async () => {
  const failing = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(
    () => deliverPages(config, [page], failing),
    (error: unknown) => {
      assert.ok(error instanceof ShopifyAdminError);
      assert.equal(error.code, "ADMIN_API_AUTH");
      assert.ok(!error.message.includes(config.accessToken));
      assert.ok(!(error.detail ?? "").includes(config.accessToken));
      return true;
    },
  );
});

test("shopify-admin: publiceren zonder menselijke bevestiging wordt geweigerd", async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({ json: { data: {} } }));
  await assert.rejects(
    () => publishTheme(config, "gid://shopify/OnlineStoreTheme/1", null, fetchImpl),
    (error: unknown) => error instanceof ShopifyAdminError && error.code === "PUBLISH_REQUIRES_HUMAN",
  );
  assert.equal(calls.length, 0, "geen API-call zonder bevestiging");
});

test("shopify-admin: menu wordt bijgewerkt op basis van de gegenereerde navigatie", async () => {
  const { fetchImpl } = fakeFetch((body) => {
    const query: string = body.query;
    if (query.includes("menus(")) {
      return { json: { data: { menus: { nodes: [{ id: "gid://shopify/Menu/1", handle: "main-menu" }] } } } };
    }
    return { json: { data: { menuUpdate: { userErrors: [] } } } };
  });

  const result = await deliverMainMenu(
    config,
    [
      { label: "Diensten", path: "/pages/diensten" },
      { label: "Contact", path: "/pages/contact" },
    ],
    fetchImpl,
  );
  assert.equal(result.updated, true);
});

test("shopify-admin: vraagt de nieuwste stabiele API-versie", async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({ json: { data: { pages: { nodes: [{ id: "gid://shopify/Page/9" }] } } } }));
  await deliverPages(config, [page], fetchImpl);
  assert.ok(calls[0]!.url.includes("/admin/api/2026-10/graphql.json"), "URL gebruikt 2026-10");
});

test("shopify-admin: stille terugval naar een andere API-versie wordt geweigerd", async () => {
  const { fetchImpl } = fakeFetch(() => ({ json: { data: { pages: { nodes: [] } } }, apiVersion: "2026-01" }));
  await assert.rejects(
    () => deliverPages(config, [page], fetchImpl),
    (error: unknown) => error instanceof ShopifyAdminError && error.code === "API_VERSION_FALLBACK",
  );
});

test("shopify-admin: ontbrekende versieheader is geen bewijs van de juiste versie", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ data: { pages: { nodes: [] } } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
  await assert.rejects(
    () => deliverPages(config, [page], fetchImpl),
    (error: unknown) => error instanceof ShopifyAdminError && error.code === "API_VERSION_UNVERIFIED",
  );
});
