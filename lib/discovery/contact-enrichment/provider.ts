import "server-only";
import type { AcceptanceRule, DocumentEvidence, EnrichmentTarget } from "@/lib/leads/contact-enrichment";
import {
  decideAcceptance,
  distinctiveBusinessSlug,
  domainSlugOf,
  evaluateDocument,
  extractEmails,
  isSocialSourceUrl,
  rankAcceptedCandidates,
  type SourceDocument,
} from "@/lib/leads/contact-enrichment";

/**
 * Contactverrijkingsprovider — zoekt in OPENBARE bronnen naar een zakelijk
 * e-mailadres voor een lead zonder e-mail.
 *
 * Zoekbron (2026-10-03): Brave Search API — Web Search endpoint
 *   GET https://api.search.brave.com/res/v1/web/search
 *   header: X-Subscription-Token: <BRAVE_SEARCH_API_KEY>, Accept: application/json
 *   params: q, count (max 20), country, search_lang, extra_snippets
 *   response: { web: { results: [{ title, url, description, extra_snippets? }] } }
 * Google Programmable Search is voor deze stap losgelaten: nieuwe Google-
 * zoekmachines kunnen niet meer op het hele web zoeken; CSE-sleutels zijn
 * niet langer nodig. Zonder BRAVE_SEARCH_API_KEY wordt er NIET gezocht
 * (blocked) — een lead zonder e-mail blijft dan eerlijk "handmatig contact".
 *
 * Begrenzing per lead: max. 2 zoekopdrachten + max. 3 bronpagina's, timeouts
 * per request, maximale responsegrootte. De provider verstuurt niets en
 * muteert niets: hij levert alleen kandidaten mét bewijs; de beslissing ligt
 * in de pure regels van lib/leads/contact-enrichment.ts (own_page_slug,
 * phone_cross_check, second_source — nooit raden, nooit verzinnen).
 */

const SEARCH_TIMEOUT_MS = 5000;
const PAGE_TIMEOUT_MS = 4000;
const MAX_PAGE_BYTES = 400 * 1024;
const MAX_PAGE_FETCHES = 3;
const SEARCH_RESULTS_PER_QUERY = 8;
const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export interface EmailSearchResult {
  /** Aantoonbaar eigen bedrijfswebsite (alleen bij route-B-acceptatie), anders null. */
  websiteUrl: string | null;
  email: string | null;
  sourceUrl: string | null;
  rule: AcceptanceRule | null;
  reason: string;
  queries: string[];
  pagesFetched: number;
}

export interface ContactEnrichmentProvider {
  readonly id: string;
  readonly live: boolean;
  attempt(target: EnrichmentTarget): Promise<EmailSearchResult>;
}

/** Configuratie: uitsluitend de API-key, server-side via Vercel env. */
export function isContactEnrichmentConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  // Zelfde conventie als lib/supabase/server.ts: unit-tests raken nooit
  // externe API's, ook niet als de shell toevallig sleutels bevat.
  if (process.env.NODE_ENV !== "production" && Boolean(process.env.NODE_TEST_CONTEXT)) return false;
  return Boolean((env.BRAVE_SEARCH_API_KEY ?? "").trim());
}

/** Zoekopdrachten per lead (begrensd, gericht op zakelijk contact). */
export function buildQueries(target: EnrichmentTarget): string[] {
  const name = target.businessName.trim();
  const queries = [`"${name}" ${target.city ?? ""} contact email`.replace(/\s+/g, " ").trim(), `"${name}" email`];
  return queries.filter((q, i) => q.length > 10 && queries.indexOf(q) === i);
}

interface BraveResult {
  title?: unknown;
  url?: unknown;
  description?: unknown;
  extra_snippets?: unknown;
}

interface BraveResponse {
  web?: { results?: BraveResult[] };
}

/**
 * Puur: zet een Brave Web Search-response om naar brondocumenten. De extra
 * snippets (tot 5 extra fragmenten per resultaat, official docs) vergroten
 * de kans dat naam + telefoon + adres in één fragment staan. Onbekende of
 * ongeldige resultaten worden overgeslagen — nooit gokt.
 */
export function braveResponseToDocuments(body: unknown): SourceDocument[] {
  const parsed = body as BraveResponse;
  const results = parsed?.web?.results;
  if (!Array.isArray(results)) return [];
  const documents: SourceDocument[] = [];
  for (const item of results) {
    if (typeof item.url !== "string" || !/^https?:\/\//i.test(item.url)) continue;
    const parts = [
      typeof item.title === "string" ? item.title : "",
      typeof item.description === "string" ? item.description : "",
      ...(Array.isArray(item.extra_snippets)
        ? item.extra_snippets.filter((snippet): snippet is string => typeof snippet === "string")
        : []),
    ];
    const text = parts.join(" — ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    documents.push({ url: item.url, text });
  }
  return documents;
}

async function fetchJson(url: string, timeoutMs: number, token: string): Promise<{ ok: boolean; body: unknown }> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        // Official Brave API: authenticatie via subscription token + Accept.
        "X-Subscription-Token": token,
        Accept: "application/json",
      },
    });
    const text = await response.text();
    return { ok: response.ok, body: response.ok ? (JSON.parse(text) as unknown) : null };
  } catch {
    return { ok: false, body: null };
  }
}

async function fetchPageText(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const response = await fetch(parsed, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS), headers: { "User-Agent": "SilvijnStudio-ContactEnrichment/1.0" } });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain/i.test(contentType)) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_PAGE_BYTES) return null;
    const html = new TextDecoder("utf-8").decode(buffer);
    return htmlToText(html);
  } catch {
    return null;
  }
}

/** Grove HTML→tekst: scripts/styles eruit, tags weg, entiteiten gedecodeerd. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&auml;/g, "ä")
    .replace(/&ouml;/g, "ö")
    .replace(/&uuml;/g, "ü")
    .replace(/&eacute;/g, "é")
    .replace(/&egrave;/g, "è")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .slice(0, 60_000);
}

/**
 * Fetch-volgorde (2026-10-06, false-negative audit): officiële eigen
 * bedrijfsdomeinen en social-profielen krijgen prioriteit boven directories
 * en aggregators. Dit verandert NIET wat wordt geaccepteerd (alle regels,
 * blocks en checks ongewijzigd): het zorgt er alleen voor dat het beperkte
 * fetch-budget eerst aan het sterkste bewijs wordt besteed — de eigen
 * website stond bij herhaalde gelegenheden achter directories op positie 5+
 * en werd daardoor nooit opgehaald.
 */
export function prioritizeFetchUrls(target: EnrichmentTarget, pageUrls: string[]): string[] {
  const distinctive = distinctiveBusinessSlug(target.businessName, target.city ?? null);
  const rank = (url: string): number => {
    let host = "";
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return 2;
    }
    if (distinctive.length >= 6 && domainSlugOf(host).includes(distinctive)) return 0;
    if (isSocialSourceUrl(url)) return 1;
    return 2;
  };
  return pageUrls
    .map((url, index) => ({ url, index, r: rank(url) }))
    .sort((a, b) => a.r - b.r || a.index - b.index)
    .map((entry) => entry.url);
}

/**
 * Zoekt per lead: eerst zoeksnippets (incl. extra snippets), daarna (alleen
 * indien nodig) een klein aantal bronpagina's. Acceptatie verloopt
 * uitsluitend via de pure regels.
 */
export class BraveSearchEmailProvider implements ContactEnrichmentProvider {
  readonly id = "brave-search";
  readonly live = true;

  constructor(private readonly apiKey: string) {}

  async attempt(target: EnrichmentTarget): Promise<EmailSearchResult> {
    const queries = buildQueries(target);
    const documents: SourceDocument[] = [];
    const pageUrls: string[] = [];

    for (const query of queries) {
      const url =
        `${BRAVE_ENDPOINT}?q=${encodeURIComponent(query)}` +
        `&count=${SEARCH_RESULTS_PER_QUERY}&country=nl&search_lang=nl&extra_snippets=true`;
      const { ok, body } = await fetchJson(url, SEARCH_TIMEOUT_MS, this.apiKey);
      if (!ok || !body) continue; // quota/fout: geen kandidaten, geen gok
      for (const document of braveResponseToDocuments(body)) {
        documents.push(document);
        if (!pageUrls.includes(document.url)) pageUrls.push(document.url);
      }
    }

    let accepted = this.evaluateDocuments(target, documents);
    let pagesFetched = 0;

    // Alleen als er (nog) geen geaccepteerd adres is: paar bronpagina's
    // ophalen. De volledige pagina bevat vaak wél het telefoonnummer dat de
    // kruischeck mogelijk maakt; de snippet zelden.
    if (accepted.length === 0) {
      for (const pageUrl of prioritizeFetchUrls(target, pageUrls).slice(0, MAX_PAGE_FETCHES)) {
        const text = await fetchPageText(pageUrl);
        pagesFetched += 1;
        if (!text) continue;
        documents.push({ url: pageUrl, text });
      }
      accepted = this.evaluateDocuments(target, documents);
    }

    if (accepted.length === 0) {
      return {
        email: null,
        sourceUrl: null,
        rule: null,
        websiteUrl: null,
        reason: documents.length === 0 ? "geen zoekresultaten beschikbaar" : "geen adres voldoet aan de verificatieregels",
        queries,
        pagesFetched,
      };
    }
    const best = rankAcceptedCandidates(accepted)[0];
    const evidence = documents.find((d) => extractEmails(d.text).includes(best.email));
    const websiteUrl = (accepted.find((a) => a.email === best.email)?.websiteUrl ?? null) || null;
    return { email: best.email, sourceUrl: evidence?.url ?? null, rule: best.rule, websiteUrl, reason: "", queries, pagesFetched };
  }

  private evaluateDocuments(target: EnrichmentTarget, documents: SourceDocument[]): { email: string; rule: AcceptanceRule; websiteUrl: string | null }[] {
    const byEmail = new Map<string, DocumentEvidence[]>();
    for (const doc of documents) {
      for (const evidence of evaluateDocument(target, doc)) {
        const list = byEmail.get(evidence.email) ?? [];
        list.push(evidence);
        byEmail.set(evidence.email, list);
      }
    }
    const out: { email: string; rule: AcceptanceRule; websiteUrl: string | null }[] = [];
    for (const [email, evidence] of byEmail) {
      const decision = decideAcceptance(target, email, evidence);
      if (decision.accepted && decision.rule) out.push({ email, rule: decision.rule, websiteUrl: decision.websiteUrl ?? null });
    }
    return out;
  }
}

export function getContactEnrichmentProvider(): ContactEnrichmentProvider | null {
  if (!isContactEnrichmentConfigured()) return null;
  return new BraveSearchEmailProvider((process.env.BRAVE_SEARCH_API_KEY ?? "").trim());
}
