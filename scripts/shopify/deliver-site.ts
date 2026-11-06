/**
 * Opleveringsscript: zet een gegenereerde site in Shopify.
 *
 * Gebruik:
 *   npx tsx scripts/shopify/deliver-site.ts --from visual-output/w10final/site.json
 *       → droogloop: toont precies wat er zou gebeuren, doet niets
 *   npx tsx scripts/shopify/deliver-site.ts --from ... --apply
 *       → maakt/werkt pagina's + SEO + main-menu bij (thema NIET publiceren)
 *   npx tsx scripts/shopify/deliver-site.ts --from ... --apply --publish \
 *       --confirm-publish "silvijn"
 *       → publiceert het opgegeven thema; alleen met expliciete bevestiging
 *
 * Vereist in de omgeving: SHOPIFY_SHOP_DOMAIN + SHOPIFY_ADMIN_ACCESS_TOKEN.
 * Tokens worden nooit geprint.
 */
import { readFileSync } from "node:fs";

import {
  deliverMainMenu,
  deliverPages,
  publishTheme,
  shopifyAdminConfigFromEnv,
  SHOPIFY_ADMIN_API_VERSION,
  ShopifyAdminError,
  type PageDeliveryItem,
} from "../../lib/shopify/admin";

type SiteExport = {
  brand: string;
  pages: Array<{
    handle: string;
    title: string;
    templateSuffix: string | null;
    seoTitle: string | null;
    seoDescription: string | null;
    published?: boolean;
  }>;
  navigation: Array<{ label: string; path: string }>;
};

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  const next = process.argv[index + 1];
  return next && !next.startsWith("--") ? next : "";
}

async function main(): Promise<number> {
  const from = arg("from");
  if (!from) {
    console.error("Geef --from <site.json> mee.");
    return 2;
  }

  const site = JSON.parse(readFileSync(from, "utf8")) as SiteExport;
  const apply = process.argv.includes("--apply");
  const publish = process.argv.includes("--publish");
  const confirmedBy = arg("confirm-publish");
  const themeId = arg("theme-id");

  const items: PageDeliveryItem[] = site.pages
    .filter((page) => page.published !== false)
    .map((page) => ({
      handle: page.handle,
      title: page.title,
      seoTitle: page.seoTitle,
      seoDescription: page.seoDescription,
      templateSuffix: page.templateSuffix,
    }));

  console.log(`Merk: ${site.brand}`);
  console.log(`API-versie: ${SHOPIFY_ADMIN_API_VERSION}`);
  console.log(`Pagina's: ${items.length}, navigatie-items: ${site.navigation.length}`);
  for (const item of items) console.log(`  · /pages/${item.handle} — ${item.title}`);

  if (!apply) {
    console.log("\nDroogloop: geen wijzigingen doorgevoerd. Voeg --apply toe om te schrijven.");
    return 0;
  }

  const config = shopifyAdminConfigFromEnv();
  if (!config) {
    console.error(
      "BLOCKED_EXTERNAL_CONFIGURATION: SHOPIFY_SHOP_DOMAIN en SHOPIFY_ADMIN_ACCESS_TOKEN ontbreken.",
    );
    return 3;
  }

  const results = await deliverPages(config, items);
  for (const result of results) {
    console.log(`  ${result.action.padEnd(8)} ${result.handle}${result.error ? ` — ${result.error}` : ""}`);
  }
  const failed = results.filter((result) => result.action === "failed");
  if (failed.length > 0) {
    console.error(`\n${failed.length} pagina('s) mislukt; menu en publicatie overgeslagen.`);
    return 4;
  }

  await deliverMainMenu(config, site.navigation);
  console.log("  menu     main-menu bijgewerkt");

  if (publish) {
    if (!themeId || !confirmedBy) {
      console.error(
        "\nPubliceren vereist --theme-id <id> en --confirm-publish <naam van de bevestiger>.",
      );
      return 5;
    }
    await publishTheme(config, themeId, {
      confirmedBy,
      confirmedAt: new Date().toISOString(),
    });
    console.log(`  thema    gepubliceerd (${themeId}) na bevestiging door ${confirmedBy}`);
  } else {
    console.log("\nThema niet gepubliceerd. Dat blijft een menselijke stap.");
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (error instanceof ShopifyAdminError) {
      console.error(`${error.code}: ${error.message}${error.detail ? ` (${error.detail})` : ""}`);
      process.exit(6);
    }
    console.error("Onverwachte fout bij de oplevering.");
    process.exit(6);
  });
