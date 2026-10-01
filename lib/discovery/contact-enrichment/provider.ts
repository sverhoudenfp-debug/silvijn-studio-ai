import "server-only";
import type { AcceptanceRule, DocumentEvidence, EnrichmentTarget } from "@/lib/leads/contact-enrichment";
import { decideAcceptance, evaluateDocument, extractEmails, rankAcceptedCandidates, type SourceDocument } from "@/lib/leads/contact-enrichment";

/**
 * Contactverrijkingsprovider — zoekt in OPENBARE bronnen naar een zakelijk
 * e-mailadres voor een lead zonder e-mail. Configuratie: Google Custom Search
 * JSON API (GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX). Zonder configuratie wordt
 * er NIET gezocht (blocked) — een lead zonder e-mail blijft dan eerlijk
 * "handmatig contact". Er bestaat geen ander, radend pad.
 *
 * Begrenzing per lead: max. 2 zoekopdrachten + max. 3 bronpagina's, timeouts
 * per request, maximale responsegrootte. De provider verstuurt niets en
 * muteert niets: hij levert alleen kandidaten mét bewijs; de beslissing ligt
 * in de pure regels van lib/leads/contact-enrichment.ts.
 */

const SEARCH_TIMEOUT_MS = 5000;
const PAGE_TIMEOUT_MS = 4000;
const MAX_PAGE_BYTES = 400 * 1024;
const MAX_PAGE_FETCHES = 3;
const SEARCH_RESULTS_PER_QUERY = 6;

export interface EmailSearchResult {
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

export function isContactEnrichmentConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  // Zelfde conventie als lib/supabase/server.ts: unit-tests raken nooit
  // externe API's, ook niet als de shell toevallig sleutels bevat.
  if (process.env.NODE_ENV !== "production" && Boolean(process.env.NODE_TEST_CONTEXT)) return false;
  return Boolean((env.GOOGLE_CSE_API_KEY ?? "").trim() && (env.GOOGLE_CSE_CX ?? "").trim());
}

function buildQueries(target: EnrichmentTarget): string[] {
  const name = target.businessName.trim();
  const queries = [`"${name}" ${target.city ?? ""} contact email`.replace(/\s+/g, " ").trim(), `"${name}" email`];
  return queries.filter((q, i) => q.length > 10 && queries.indexOf(q) === i);
}

interface CseItem {
  title?: string;
  link?: string;
  snippet?: string;
}

interface CseResponse {
  items?: CseItem[];
  error?: { message?: string };
}

async function fetchJson(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "SilvijnStudio-ContactEnrichment/1.0" } });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body: JSON.parse(body) as unknown };
  } catch {
    return { ok: false, status: 0, body: null };
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
 * Zoekt per lead: eerst zoeksnippets, daarna (alleen indien nodig) een klein
 * aantal bronpagina's. Acceptatie verloopt uitsluitend via de pure regels.
 */
export class GoogleCustomSearchEmailProvider implements ContactEnrichmentProvider {
  readonly id = "google-cse";
  readonly live = true;

  constructor(
    private readonly apiKey: string,
    private readonly cseId: string
  ) {}

  async attempt(target: EnrichmentTarget): Promise<EmailSearchResult> {
    const queries = buildQueries(target);
    const documents: SourceDocument[] = [];
    const pageUrls: string[] = [];

    for (const query of queries) {
      const url =
        `https://customsearch.googleapis.com/customsearch/v1?key=${encodeURIComponent(this.apiKey)}` +
        `&cx=${encodeURIComponent(this.cseId)}&num=${SEARCH_RESULTS_PER_QUERY}&gl=nl&hl=nl&q=${encodeURIComponent(query)}`;
      const { ok, body } = await fetchJson(url, SEARCH_TIMEOUT_MS);
      if (!ok || !body) continue;
      const parsed = body as CseResponse;
      if (parsed.error) continue; // quota/fout: geen kandidaten, geen gok
      for (const item of parsed.items ?? []) {
        if (!item.link || !/^https?:\/\//i.test(item.link)) continue;
        const snippet = `${item.title ?? ""} — ${item.snippet ?? ""}`;
        documents.push({ url: item.link, text: snippet });
        if (!pageUrls.includes(item.link)) pageUrls.push(item.link);
      }
    }

    let accepted = this.evaluateDocuments(target, documents);
    let pagesFetched = 0;

    // Alleen als er (nog) geen geaccepteerd adres is: paar bronpagina's
    // ophalen. De volledige pagina bevat vaak wél het telefoonnummer dat de
    // kruischeck mogelijk maakt; de snippet zelden.
    if (accepted.length === 0) {
      for (const pageUrl of pageUrls.slice(0, MAX_PAGE_FETCHES)) {
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
        reason: documents.length === 0 ? "geen zoekresultaten beschikbaar" : "geen adres voldoet aan de verificatieregels",
        queries,
        pagesFetched,
      };
    }
    const best = rankAcceptedCandidates(accepted)[0];
    const evidence = documents.find((d) => extractEmails(d.text).includes(best.email));
    return { email: best.email, sourceUrl: evidence?.url ?? null, rule: best.rule, reason: "", queries, pagesFetched };
  }

  private evaluateDocuments(target: EnrichmentTarget, documents: SourceDocument[]): { email: string; rule: AcceptanceRule }[] {
    const byEmail = new Map<string, DocumentEvidence[]>();
    for (const doc of documents) {
      for (const evidence of evaluateDocument(target, doc)) {
        const list = byEmail.get(evidence.email) ?? [];
        list.push(evidence);
        byEmail.set(evidence.email, list);
      }
    }
    const out: { email: string; rule: AcceptanceRule }[] = [];
    for (const [email, evidence] of byEmail) {
      const decision = decideAcceptance(target, email, evidence);
      if (decision.accepted && decision.rule) out.push({ email, rule: decision.rule });
    }
    return out;
  }
}

export function getContactEnrichmentProvider(): ContactEnrichmentProvider | null {
  if (!isContactEnrichmentConfigured()) return null;
  return new GoogleCustomSearchEmailProvider(
    (process.env.GOOGLE_CSE_API_KEY ?? "").trim(),
    (process.env.GOOGLE_CSE_CX ?? "").trim()
  );
}
