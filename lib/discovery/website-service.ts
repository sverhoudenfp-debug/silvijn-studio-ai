import type { WebsiteStatus } from "@/lib/types";
import {
  fetchSafeWebsite,
  type SafeWebsiteResponse,
  type WebsiteNetworkDependencies,
} from "./website-network-safety";

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
 * Beveiliging: DNS-validatie en IP-pinning per request, alleen publieke
 * HTTP(S)-doelen op standaardpoorten, handmatig gevalideerde redirects,
 * totale timeout, HTML content-type en een harde 64KB streamed bodylimiet.
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

export interface StructuredOrganizationEvidence {
  name: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  telephone: string | null;
  email: string | null;
  url: string | null;
}

export interface WebsiteInspectionResult {
  check: WebsiteCheckResult;
  finalUrl: string | null;
  title: string | null;
  visibleText: string;
  structuredOrganizations: StructuredOrganizationEvidence[];
  emails: string[];
  phones: string[];
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  const item = record(value);
  if (!item) return [];
  const nested = Array.isArray(item["@graph"]) ? flattenJsonLd(item["@graph"]) : [];
  return [item, ...nested];
}

function extractStructuredOrganizations(html: string): StructuredOrganizationEvidence[] {
  const organizations: StructuredOrganizationEvidence[] = [];
  const scriptPattern = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      for (const item of flattenJsonLd(parsed)) {
        const rawTypes = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
        const types = rawTypes.filter((type): type is string => typeof type === "string").map((type) => type.toLowerCase());
        const address = record(item.address);
        const hasOrganizationShape = types.some((type) =>
          type === "organization" || type === "localbusiness" || type.endsWith("business") ||
          type.includes("store") || type === "restaurant" || type === "professionalservice"
        ) || Boolean(address && item.name);
        if (!hasOrganizationShape) continue;
        organizations.push({
          name: cleanText(item.name),
          address: cleanText(address?.streetAddress ?? item.address),
          city: cleanText(address?.addressLocality),
          postalCode: cleanText(address?.postalCode),
          telephone: cleanText(item.telephone),
          email: cleanText(item.email),
          url: cleanText(item.url),
        });
      }
    } catch {
      // Malformed structured data is ignored; the safely fetched HTML can
      // still provide deterministic visible evidence.
    }
  }
  return organizations.slice(0, 20);
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function analyzeResponse(response: SafeWebsiteResponse): WebsiteInspectionResult {
  const lowerBody = response.body.toLowerCase();
  const rawTitle = response.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
  const title = rawTitle ? cleanText(decodeBasicEntities(rawTitle.replace(/<[^>]*>/g, " "))) : null;
  const visibleText = decodeBasicEntities(
    response.body
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
  ).replace(/\s+/g, " ").trim();
  const hasTitle = Boolean(title);
  const hasBasicHtml = lowerBody.includes("<body") || lowerBody.includes("<!doctype html");
  const hasViewport = lowerBody.includes("width=device-width");
  const hasContactHint =
    lowerBody.includes("tel:") || lowerBody.includes("mailto:") ||
    lowerBody.includes("contact") || lowerBody.includes("bel ") || lowerBody.includes("e-mail");
  const looksBroken = !hasBasicHtml || visibleText.length < 200;
  const emails = Array.from(new Set(
    response.body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
  )).slice(0, 20);
  const phones = Array.from(new Set(
    (response.body.match(/(?:\+31|0031|0)[\s().-]*(?:\d[\s().-]*){8,10}/g) ?? [])
      .map((phone) => phone.replace(/\s+/g, " ").trim())
  )).slice(0, 20);
  return {
    check: {
      reachable: response.statusCode >= 200 && response.statusCode < 300,
      httpStatus: response.statusCode,
      https: response.finalUrl.protocol === "https:",
      redirected: response.redirected,
      hasTitle,
      hasBasicHtml,
      hasViewport,
      hasContactHint,
      looksBroken,
    },
    finalUrl: response.finalUrl.toString(),
    title,
    visibleText,
    structuredOrganizations: extractStructuredOrganizations(response.body),
    emails,
    phones,
  };
}

function emptyInspection(https = false): WebsiteInspectionResult {
  return {
    check: {
      reachable: false, httpStatus: null, https, redirected: false,
      hasTitle: false, hasBasicHtml: false, hasViewport: false, hasContactHint: false,
      looksBroken: true,
    },
    finalUrl: null,
    title: null,
    visibleText: "",
    structuredOrganizations: [],
    emails: [],
    phones: [],
  };
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
      if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname.includes(".")) return null;
      if (parsed.username || parsed.password) return null;
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

  /** Safely fetch once and return bounded, in-memory evidence for matching. */
  static async inspectWebsite(
    url: string,
    timeoutMs = 5000,
    dependencies?: WebsiteNetworkDependencies
  ): Promise<WebsiteInspectionResult> {
    const normalized = this.normalizeUrl(url);
    if (!normalized) return emptyInspection();
    try {
      return analyzeResponse(await fetchSafeWebsite(new URL(normalized), timeoutMs, dependencies));
    } catch {
      return emptyInspection(normalized.startsWith("https://"));
    }
  }

  /** Gecontroleerde technische check. Gooit nooit — onbereikbaar/onveilig is een valide uitkomst. */
  static async checkWebsite(
    url: string,
    timeoutMs = 5000,
    dependencies?: WebsiteNetworkDependencies
  ): Promise<WebsiteCheckResult> {
    return (await this.inspectWebsite(url, timeoutMs, dependencies)).check;
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
