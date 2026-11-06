/**
 * Shopify Admin API — opleveringslaag (W10).
 *
 * Doel: pagina's, SEO en navigatie in de winkel aanmaken die bij een gegenereerd
 * thema horen, zodat een klant een werkende site krijgt en niet alleen bestanden.
 *
 * Regels die in deze module zijn ingebakken:
 *  - Alleen officiële Admin GraphQL API (`/admin/api/<versie>/graphql.json`).
 *  - Geen publicatie zonder expliciete menselijke bevestiging (`publishTheme`).
 *  - Tokens komen uit de omgeving en belanden nooit in foutmeldingen of logs.
 *  - Zonder configuratie faalt de module eerlijk met BLOCKED_EXTERNAL_CONFIGURATION.
 *  - Idempotent: bestaande pagina's/menu's worden bijgewerkt, niet gedupliceerd.
 */

/**
 * Nieuwste stabiele GraphQL Admin API-versie. Shopify brengt elk kwartaal een
 * versie uit en ondersteunt de laatste vier; 2024-10 valt daar buiten.
 * Bijwerken gebeurt in deze ene constante, plus de versietest.
 */
export const SHOPIFY_ADMIN_API_VERSION = "2026-10";

export type ShopifyAdminConfig = {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
};

export type ShopifyAdminErrorCode =
  | "BLOCKED_EXTERNAL_CONFIGURATION"
  | "ADMIN_API_ERROR"
  | "ADMIN_API_AUTH"
  | "PAGE_DELIVERY_FAILED"
  | "MENU_DELIVERY_FAILED"
  | "PUBLISH_REQUIRES_HUMAN"
  | "API_VERSION_UNVERIFIED"
  | "API_VERSION_FALLBACK";

export class ShopifyAdminError extends Error {
  readonly code: ShopifyAdminErrorCode;
  readonly detail: string | null;

  constructor(code: ShopifyAdminErrorCode, message: string, detail: string | null = null) {
    super(message);
    this.name = "ShopifyAdminError";
    this.code = code;
    this.detail = detail;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function normaliseDomain(shopDomain: string): string {
  const trimmed = shopDomain.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!/^[a-z0-9-]+\.myshopify\.com$/i.test(trimmed)) {
    throw new ShopifyAdminError(
      "BLOCKED_EXTERNAL_CONFIGURATION",
      "SHOPIFY_SHOP_DOMAIN moet de *.myshopify.com-winkelnaam zijn",
    );
  }
  return trimmed;
}

/** Leest de configuratie uit de omgeving; geeft null als die niet compleet is. */
export function shopifyAdminConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ShopifyAdminConfig | null {
  const shopDomain = env.SHOPIFY_SHOP_DOMAIN?.trim();
  const accessToken = env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim();
  if (!shopDomain || !accessToken) return null;
  return { shopDomain, accessToken };
}

async function adminGraphql<T>(
  config: ShopifyAdminConfig,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const domain = normaliseDomain(config.shopDomain);
  const version = config.apiVersion ?? SHOPIFY_ADMIN_API_VERSION;
  const url = `https://${domain}/admin/api/${version}/graphql.json`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": config.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    // Nooit de token of de requestheaders doorgeven aan de foutmelding.
    throw new ShopifyAdminError("ADMIN_API_ERROR", "Admin API niet bereikbaar");
  }

  if (response.status === 401 || response.status === 403) {
    throw new ShopifyAdminError("ADMIN_API_AUTH", `Admin API weigerde de toegang (HTTP ${response.status})`);
  }

  // Shopify "valt vooruit" wanneer de gevraagde versie niet meer bestaat. Zonder
  // deze controle zou een verouderde versie stilzwijgend op een andere versie
  // draaien en zou de integratie "werken" zonder dat de versie klopt.
  const servedVersion = response.headers.get("x-shopify-api-version");
  const requestedVersion = config.apiVersion ?? SHOPIFY_ADMIN_API_VERSION;
  if (!servedVersion) {
    throw new ShopifyAdminError(
      "API_VERSION_UNVERIFIED",
      `Shopify gaf geen X-Shopify-API-Version-header terug; versie ${requestedVersion} is niet bevestigd`,
    );
  }
  if (servedVersion !== requestedVersion) {
    throw new ShopifyAdminError(
      "API_VERSION_FALLBACK",
      `Shopify serveerde API-versie ${servedVersion} in plaats van ${requestedVersion}`,
      "stille terugval geweigerd",
    );
  }

  const payload = (await response.json().catch(() => null)) as
    | { data?: T; errors?: Array<{ message?: string }> }
    | null;

  if (!response.ok || !payload) {
    throw new ShopifyAdminError("ADMIN_API_ERROR", `Admin API gaf HTTP ${response.status}`);
  }
  if (payload.errors?.length) {
    const detail = payload.errors.map((error) => error.message ?? "onbekend").join("; ");
    throw new ShopifyAdminError("ADMIN_API_ERROR", "Admin API retourneerde fouten", detail);
  }
  if (!payload.data) {
    throw new ShopifyAdminError("ADMIN_API_ERROR", "Admin API gaf geen data");
  }
  return payload.data;
}

export type PageDeliveryItem = {
  handle: string;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  templateSuffix: string | null;
};

export type PageDeliveryResult = {
  handle: string;
  id: string | null;
  action: "created" | "updated" | "skipped" | "failed";
  error: string | null;
  /** De door Shopify bevestigde API-versie (uit de responseheader). */
  apiVersion: string;
};

const PAGE_BY_HANDLE = `#graphql
  query PageByHandle($query: String!) {
    pages(first: 1, query: $query) {
      nodes { id handle title templateSuffix }
    }
  }
`;

const PAGE_CREATE = `#graphql
  mutation PageCreate($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page { id handle }
      userErrors { field message }
    }
  }
`;

const PAGE_UPDATE = `#graphql
  mutation PageUpdate($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
      page { id handle }
      userErrors { field message }
    }
  }
`;

const METAFIELDS_SET = `#graphql
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key }
      userErrors { field message }
    }
  }
`;

function errorText(errors: Array<{ field?: string[] | null; message?: string }> | undefined): string | null {
  if (!errors?.length) return null;
  return errors.map((error) => `${(error.field ?? []).join(".")}: ${error.message ?? "onbekend"}`).join("; ");
}

/**
 * Maakt of werkt paginabobjecten bij, inclusief SEO-metavelden
 * (global.title_tag / global.description_tag) en het paginatemplate.
 */
export async function deliverPages(
  config: ShopifyAdminConfig,
  items: readonly PageDeliveryItem[],
  fetchImpl: FetchLike = fetch,
): Promise<PageDeliveryResult[]> {
  const results: PageDeliveryResult[] = [];

  for (const item of items) {
    try {
      const existing = await adminGraphql<{ pages: { nodes: Array<{ id: string }> } }>(
        config,
        PAGE_BY_HANDLE,
        { query: `handle:${item.handle}` },
        fetchImpl,
      );
      const current = existing.pages.nodes[0] ?? null;

      let pageId: string | null = current?.id ?? null;
      let action: PageDeliveryResult["action"] = "skipped";

      if (current) {
        const updated = await adminGraphql<{
          pageUpdate: { page: { id: string } | null; userErrors: Array<{ field?: string[]; message?: string }> };
        }>(
          config,
          PAGE_UPDATE,
          {
            id: current.id,
            page: {
              title: item.title,
              templateSuffix: item.templateSuffix,
            },
          },
          fetchImpl,
        );
        const failure = errorText(updated.pageUpdate.userErrors);
        if (failure) throw new ShopifyAdminError("PAGE_DELIVERY_FAILED", `Pagina ${item.handle} bijwerken faalde`, failure);
        pageId = updated.pageUpdate.page?.id ?? current.id;
        action = "updated";
      } else {
        const created = await adminGraphql<{
          pageCreate: { page: { id: string } | null; userErrors: Array<{ field?: string[]; message?: string }> };
        }>(
          config,
          PAGE_CREATE,
          {
            page: {
              title: item.title,
              handle: item.handle,
              templateSuffix: item.templateSuffix,
              isPublished: true,
            },
          },
          fetchImpl,
        );
        const failure = errorText(created.pageCreate.userErrors);
        if (failure) throw new ShopifyAdminError("PAGE_DELIVERY_FAILED", `Pagina ${item.handle} aanmaken faalde`, failure);
        pageId = created.pageCreate.page?.id ?? null;
        action = "created";
      }

      if (pageId) {
        const metafields = [
          item.seoTitle ? { ownerId: pageId, namespace: "global", key: "title_tag", type: "single_line_text_field", value: item.seoTitle } : null,
          item.seoDescription
            ? { ownerId: pageId, namespace: "global", key: "description_tag", type: "single_line_text_field", value: item.seoDescription }
            : null,
        ].filter((value): value is NonNullable<typeof value> => value !== null);

        if (metafields.length > 0) {
          const result = await adminGraphql<{
            metafieldsSet: { userErrors: Array<{ field?: string[]; message?: string }> };
          }>(config, METAFIELDS_SET, { metafields }, fetchImpl);
          const failure = errorText(result.metafieldsSet.userErrors);
          if (failure) throw new ShopifyAdminError("PAGE_DELIVERY_FAILED", `SEO van ${item.handle} opslaan faalde`, failure);
        }
      }

      results.push({
        handle: item.handle,
        id: pageId,
        action,
        error: null,
        apiVersion: config.apiVersion ?? SHOPIFY_ADMIN_API_VERSION,
      });
    } catch (error) {
      // Authenticatie- en versiefouten gaan altijd omhoog: dat zijn geen
      // pagina-specifieke problemen die je per pagina kunt negeren.
      if (
        error instanceof ShopifyAdminError &&
        (error.code === "ADMIN_API_AUTH" ||
          error.code === "API_VERSION_FALLBACK" ||
          error.code === "API_VERSION_UNVERIFIED")
      ) {
        throw error;
      }
      const message = error instanceof ShopifyAdminError ? error.message : "onbekende fout";
      results.push({
        handle: item.handle,
        id: null,
        action: "failed",
        error: message,
        apiVersion: config.apiVersion ?? SHOPIFY_ADMIN_API_VERSION,
      });
    }
  }

  return results;
}

export type MenuLink = { label: string; path: string };

const MENUS_QUERY = `#graphql
  query Menus { menus(first: 20) { nodes { id handle title } } }
`;

const MENU_UPDATE = `#graphql
  mutation MenuUpdate($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, items: $items) {
      menu { id handle }
      userErrors { field message }
    }
  }
`;

/** Werkt het main-menu bij met de gegenereerde navigatie (idempotent op handle). */
export async function deliverMainMenu(
  config: ShopifyAdminConfig,
  links: readonly MenuLink[],
  fetchImpl: FetchLike = fetch,
): Promise<{ id: string; updated: boolean }> {
  const menus = await adminGraphql<{ menus: { nodes: Array<{ id: string; handle: string }> } }>(
    config,
    MENUS_QUERY,
    {},
    fetchImpl,
  );
  const main = menus.menus.nodes.find((menu) => menu.handle === "main-menu");
  if (!main) {
    throw new ShopifyAdminError(
      "MENU_DELIVERY_FAILED",
      "Geen main-menu in de winkel; maak die eerst in de Shopify-navigatie",
    );
  }

  const items = links.map((link) => ({ title: link.label, type: "HTTP", url: link.path }));
  const result = await adminGraphql<{
    menuUpdate: { userErrors: Array<{ field?: string[]; message?: string }> };
  }>(config, MENU_UPDATE, { id: main.id, title: "main-menu", items }, fetchImpl);

  const failure = errorText(result.menuUpdate.userErrors);
  if (failure) throw new ShopifyAdminError("MENU_DELIVERY_FAILED", "Menu bijwerken faalde", failure);
  return { id: main.id, updated: true };
}

const THEME_PUBLISH = `#graphql
  mutation ThemePublish($id: ID!) {
    themePublish(id: $id) { theme { id name role } userErrors { field message } }
  }
`;

/**
 * Publiceert een thema. Dit mag NOOIT automatisch gebeuren: de aanroeper moet
 * expliciet menselijke bevestiging doorgeven. Zo blijft finale levering een
 * menselijke poort en worden andere thema's van de winkel niet overschreven.
 */
export async function publishTheme(
  config: ShopifyAdminConfig,
  themeId: string,
  humanConfirmation: { confirmedBy: string; confirmedAt: string } | null,
  fetchImpl: FetchLike = fetch,
): Promise<{ themeId: string; published: boolean }> {
  if (!humanConfirmation?.confirmedBy) {
    throw new ShopifyAdminError(
      "PUBLISH_REQUIRES_HUMAN",
      "Publiceren vereist expliciete menselijke bevestiging (READY_FOR_SILVIJN)",
    );
  }
  const result = await adminGraphql<{
    themePublish: { theme: { id: string } | null; userErrors: Array<{ field?: string[]; message?: string }> };
  }>(config, THEME_PUBLISH, { id: themeId }, fetchImpl);

  const failure = errorText(result.themePublish.userErrors);
  if (failure) throw new ShopifyAdminError("ADMIN_API_ERROR", "Publiceren faalde", failure);
  return { themeId, published: true };
}
