import type { WebsiteStatus } from "@/lib/types";

/**
 * WebsiteDiscoveryService — technische basiscontrole van websites.
 *
 * Regels (eerlijk, geen gokken):
 * - geen URL                      → no_website
 * - URL aanwezig maar NIET live gecontroleerd → unknown
 * - live check: onbereikbaar      → unknown
 * - live check: bereikbaar maar basic kwaliteit mist (geen HTTPS, geen
 *   title, geen viewport, leeg/broken) → website_poor
 * - live check: bereikbaar en in orde → has_website
 *
 * Dit is een TECHNISCHE CHECK — de uitgebreide AI-businessanalyse hoort
 * bij de AI-laag en wordt nooit automatisch in bulk uitgevoerd.
 *
 * Beveiliging: één gecontroleerd GET-request met timeout, max ~64KB body,
 * geen login-pages, geen auth-bypass, geen agressieve crawling.
 */

export interface WebsiteCheckResult {
  reachable: boolean;
  httpStatus: number | null;
  https: boolean;
  redirected: boolean;
  hasTitle: boolean;
  hasBasicHtml: boolean;
  hasViewport: boolean;
  hasContactHint: boolean;
  looksBroken: boolean;
}

export class WebsiteDiscoveryService {
  /** Live checks staan default UIT (WEBSITE_CHECKS_ENABLED=true om aan te zetten). */
  static checksEnabled(): boolean {
    return (process.env.WEBSITE_CHECKS_ENABLED ?? "").trim().toLowerCase() === "true";
  }

  /** URL normaliseren: protocol toevoegen, host lowercase, trailing slash eraf. */
  static normalizeUrl(input: string | null | undefined): string | null {
    if (!input) return null;
    let url = input.trim();
    if (!url) return null;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.includes(".")) return null;
      parsed.hash = "";
      const normalized = parsed.toString().replace(/\/$/, "");
      return normalized;
    } catch {
      return null;
    }
  }

  /** Zelfde website? Op basis van genormaliseerde URL + host-only fallback. */
  static isSameWebsite(a: string | null, b: string | null): boolean {
    if (!a || !b) return false;
    const na = this.normalizeUrl(a);
    const nb = this.normalizeUrl(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    try {
      return new URL(na).hostname.replace(/^www\./, "") === new URL(nb).hostname.replace(/^www\./, "");
    } catch {
      return false;
    }
  }

  /** Gecontroleerde technische check. Gooit nooit — onbereikbaar is een valide uitkomst. */
  static async checkWebsite(url: string, timeoutMs = 5000): Promise<WebsiteCheckResult> {
    const normalized = this.normalizeUrl(url);
    const empty: WebsiteCheckResult = {
      reachable: false, httpStatus: null, https: false, redirected: false,
      hasTitle: false, hasBasicHtml: false, hasViewport: false, hasContactHint: false,
      looksBroken: true,
    };
    if (!normalized) return empty;

    try {
      const response = await fetch(normalized, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": "SilvijnStudioDiscoveryBot/1.0 (basis-websitecheck)" },
      });
      const https = response.url.startsWith("https://");
      const redirected = response.url.replace(/\/$/, "") !== normalized.replace(/\/$/, "");
      const body = (await response.text()).slice(0, 64_000).toLowerCase();

      const hasTitle = /<title[^>]*>\s*\S+/.test(body);
      const hasBasicHtml = body.includes("<body") || body.includes("<!doctype html");
      const hasViewport = body.includes("width=device-width");
      const hasContactHint =
        body.includes("tel:") || body.includes("mailto:") ||
        body.includes("contact") || body.includes("bel ") || body.includes("e-mail");
      const contentLength = body.replace(/<[^>]*>/g, "").trim().length;
      const looksBroken = !hasBasicHtml || contentLength < 200;

      return {
        reachable: response.ok,
        httpStatus: response.status,
        https,
        redirected,
        hasTitle,
        hasBasicHtml,
        hasViewport,
        hasContactHint,
        looksBroken,
      };
    } catch {
      return { ...empty, https: normalized.startsWith("https://") };
    }
  }

  /**
   * Definitieve website-status volgens de eerlijke regels hierboven.
   * checksEnabled=false → een URL zonder live check wordt NOOIT als
   * has_website/website_poor geclaimd: unknown.
   */
  static async determineStatus(
    website: string | null,
    opts?: { checksEnabled?: boolean }
  ): Promise<WebsiteStatus> {
    const normalized = this.normalizeUrl(website);
    if (!normalized) return "no_website";

    const enabled = opts?.checksEnabled ?? this.checksEnabled();
    if (!enabled) return "unknown";

    const check = await this.checkWebsite(normalized);
    if (!check.reachable) return "unknown";
    if (check.looksBroken || !check.hasTitle || !check.https) return "website_poor";
    return "has_website";
  }
}
