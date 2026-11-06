from pathlib import Path

p = Path("lib/shopify/admin.ts")
s = p.read_text()

s = s.replace(
    'export const SHOPIFY_ADMIN_API_VERSION = "2024-10";',
    '''/**
 * Nieuwste stabiele GraphQL Admin API-versie. Shopify brengt elk kwartaal een
 * versie uit en ondersteunt de laatste vier; 2024-10 valt daar buiten.
 * Bijwerken gebeurt in deze ene constante, plus de versietest.
 */
export const SHOPIFY_ADMIN_API_VERSION = "2026-10";''',
    1,
)

s = s.replace(
    '''  | "PUBLISH_REQUIRES_HUMAN";''',
    '''  | "PUBLISH_REQUIRES_HUMAN"
  | "API_VERSION_UNVERIFIED"
  | "API_VERSION_FALLBACK";''',
    1,
)

old = '''  if (response.status === 401 || response.status === 403) {
    throw new ShopifyAdminError("ADMIN_API_AUTH", `Admin API weigerde de toegang (HTTP ${response.status})`);
  }'''
new = '''  if (response.status === 401 || response.status === 403) {
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
  }'''
assert old in s
s = s.replace(old, new, 1)

# Resultaat van een pagina-actie krijgt de bevestigde API-versie mee
s = s.replace(
    '''export type PageDeliveryResult = {
  handle: string;
  id: string | null;
  action: "created" | "updated" | "skipped" | "failed";
  error: string | null;
};''',
    '''export type PageDeliveryResult = {
  handle: string;
  id: string | null;
  action: "created" | "updated" | "skipped" | "failed";
  error: string | null;
  /** De door Shopify bevestigde API-versie (uit de responseheader). */
  apiVersion: string;
};''',
    1,
)

s = s.replace(
    '''      results.push({ handle: item.handle, id: pageId, action, error: null });''',
    '''      results.push({
        handle: item.handle,
        id: pageId,
        action,
        error: null,
        apiVersion: config.apiVersion ?? SHOPIFY_ADMIN_API_VERSION,
      });''',
    1,
)
s = s.replace(
    '''      results.push({ handle: item.handle, id: null, action: "failed", error: message });''',
    '''      results.push({
        handle: item.handle,
        id: null,
        action: "failed",
        error: message,
        apiVersion: config.apiVersion ?? SHOPIFY_ADMIN_API_VERSION,
      });''',
    1,
)

p.write_text(s)
print("admin.ts: 2026-10 + versiebewaking")
