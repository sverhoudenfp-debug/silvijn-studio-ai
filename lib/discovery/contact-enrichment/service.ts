import "server-only";
import type { Lead } from "@/lib/types";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getContactEnrichmentProvider, type ContactEnrichmentProvider } from "./provider";

/**
 * Contactverrijking — service-wrapper rond de provider. Nooit throwen:
 * verrijking is een verbetering van de lead, geen harde eis. Een lead zonder
 * e-mailadres bestaat gewoon (eerlijk) verder als "handmatig contact"; de
 * bestaande UI-logica (lib/outreach/contactability.ts) toont dat al.
 *
 * Schrijfgedrag (additief, auditeerbaar):
 *   - email gevonden  → leads.email bijgewerkt + notitie met bron-URL en regel
 *   - niet gevonden  → notitie dat er gecontroleerd is gezocht
 *   - blocked/fout    → géén mutatie; de run telt de uitkomst.
 */

export type ContactEnrichmentOutcome =
  | "already_has_email"
  | "email_found"
  | "no_email_found"
  | "blocked_external_configuration"
  | "provider_error";

export interface ContactEnrichmentAttempt {
  outcome: ContactEnrichmentOutcome;
  leadId: string;
  email: string | null;
  sourceUrl: string | null;
}

function notePrefix(): string {
  return `Contactverrijking (${new Date().toISOString().slice(0, 10)}, bron: brave-search)`;
}

/** Audit-notitie bij een geaccepteerd adres (zelfde formaat als de lead-write-pad). */
export function contactEnrichmentFoundNote(email: string, sourceUrl: string | null, rule: string): string {
  return `${notePrefix()}: zakelijk e-mailadres ${email} gevonden via ${sourceUrl ?? "onbekende bron"} (regel: ${rule}).`;
}

/**
 * Website-markering bij verrijking (Silvijn-goedkeuring 2026-10-06, optie 1):
 * een via route B aantoonbaar gevonden eigen bedrijfswebsite corrigeert de
 * lead eerlijk — de lead blijft in de pool, blijft outreach-eligible en
 * behoudt alle bron-/auditinformatie. Alleen een wettig bewezen eigen site
 * markeert; social-profielen, directory-/platformpagina's en onbevestigde
 * domeinen veranderen de status nooit. Puur en side-effectvrij.
 */
export function websiteUpdateAfterEnrichment(
  lead: Pick<Lead, "websiteStatus">,
  websiteUrl: string | null
): { websiteStatus: "has_website"; note: string } | null {
  if (!websiteUrl) return null;
  if (lead.websiteStatus !== "no_website" && lead.websiteStatus !== "unknown") return null;
  return {
    websiteStatus: "has_website",
    note: `${notePrefix()}: eigen website aanwezig (${websiteUrl}) — website-status gewijzigd van '${lead.websiteStatus}' naar 'has_website'. Bestaande website: mogelijke redesign/professionalisering.`,
  };
}

export async function attemptContactEnrichment(
  lead: Lead,
  options?: { provider?: ContactEnrichmentProvider }
): Promise<ContactEnrichmentAttempt> {
  const base: ContactEnrichmentAttempt = { outcome: "no_email_found", leadId: lead.id, email: null, sourceUrl: null };
  if (lead.email && lead.email.trim()) {
    return { ...base, outcome: "already_has_email" };
  }
  const provider = options?.provider ?? getContactEnrichmentProvider();
  if (!provider) {
    return { ...base, outcome: "blocked_external_configuration" };
  }
  try {
    const result = await provider.attempt({
      businessName: lead.businessName,
      city: lead.city,
      phone: lead.phone,
    });
    if (!result.email) {
      const repository = getLeadRepository();
      await repository.updateContact(lead.id, {
        notes: [
          ...lead.notes,
          `${notePrefix()}: geen openbaar zakelijk e-mailadres gevonden (${result.reason}).`,
        ],
      });
      return base;
    }
    const repository = getLeadRepository();
    const websiteUpdate = websiteUpdateAfterEnrichment(lead, result.websiteUrl ?? null);
    await repository.updateContact(lead.id, {
      email: result.email,
      ...(websiteUpdate ? { websiteStatus: websiteUpdate.websiteStatus } : {}),
      notes: [
        ...lead.notes,
        contactEnrichmentFoundNote(result.email, result.sourceUrl, String(result.rule)),
        ...(websiteUpdate ? [websiteUpdate.note] : []),
      ],
    });
    return { outcome: "email_found", leadId: lead.id, email: result.email, sourceUrl: result.sourceUrl };
  } catch (error) {
    console.warn("[ContactEnrichment] providerfout:", error instanceof Error ? error.message : error);
    return { ...base, outcome: "provider_error" };
  }
}

export interface ContactEnrichmentRunSummary {
  attempted: number;
  emailFound: number;
  noEmailFound: number;
  blocked: number;
  errors: number;
  notAttempted: number;
}

const MAX_ENRICH_PER_RUN = 8;
const CONCURRENCY = 4;

/**
 * Verrijkt de in deze discovery-run AANGEMAAKTE leads zonder e-mail,
 * begrensd per run. Bestaande leads en duplicaten worden nooit aangeraakt;
 * de aanmaakketen (dedupe) is al voltooid voordat dit draait.
 */
export async function enrichCreatedLeads(
  leads: Lead[],
  options?: { provider?: ContactEnrichmentProvider; max?: number }
): Promise<ContactEnrichmentRunSummary> {
  const eligible = leads.filter((lead) => !lead.email || !lead.email.trim()).slice(0, options?.max ?? MAX_ENRICH_PER_RUN);
  const summary: ContactEnrichmentRunSummary = {
    attempted: 0,
    emailFound: 0,
    noEmailFound: 0,
    blocked: 0,
    errors: 0,
    notAttempted: Math.max(0, leads.filter((lead) => !lead.email || !lead.email.trim()).length - eligible.length),
  };
  if (eligible.length === 0) return summary;

  // "attempted" betekent: de provider is werkelijk geraadpleegd. Een blocked
  // (geen configuratie) of already-lead telt eerlijk maar is geen poging.
  for (let i = 0; i < eligible.length; i += CONCURRENCY) {
    const batch = eligible.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((lead) => attemptContactEnrichment(lead, options)));
    for (const result of results) {
      if (result.outcome === "blocked_external_configuration") {
        summary.blocked += 1;
        continue;
      }
      summary.attempted += 1;
      if (result.outcome === "email_found") summary.emailFound += 1;
      else if (result.outcome === "no_email_found") summary.noEmailFound += 1;
      else if (result.outcome === "provider_error") summary.errors += 1;
    }
  }
  return summary;
}

export interface CandidateContactEnrichmentOutcome {
  outcome: "email_found" | "no_email_found" | "blocked_external_configuration" | "provider_error";
  email: string | null;
  sourceUrl: string | null;
  rule: string | null;
  reason: string;
}

/**
 * Kandidaat-niveau verrijking voor email-required discovery (2026-10-03):
 * zoekt met de bestaande provider + bestaande verificatieregels
 * (own_page_slug / phone_cross_check / second_source) naar een geverifieerd
 * zakelijk adres, maar schrijft NIETS — geen lead, geen notitie, geen
 * mutatie. De caller (LeadDiscoveryService) beslist of de kandidaat pas een
 * lead wordt. Nooit raden, nooit verzinnen; zonder geconfigureerde provider
 * is de uitkomst blocked (eerlijk, geen gok).
 */
export async function enrichCandidateContact(
  target: { businessName: string; city: string | null; phone: string | null },
  options?: { provider?: ContactEnrichmentProvider }
): Promise<CandidateContactEnrichmentOutcome> {
  const provider = options?.provider ?? getContactEnrichmentProvider();
  if (!provider) {
    return {
      outcome: "blocked_external_configuration",
      email: null,
      sourceUrl: null,
      rule: null,
      reason: "geen zoekprovider geconfigureerd",
    };
  }
  try {
    const result = await provider.attempt({
      businessName: target.businessName,
      city: target.city,
      phone: target.phone,
    });
    if (!result.email) {
      return { outcome: "no_email_found", email: null, sourceUrl: null, rule: null, reason: result.reason };
    }
    return {
      outcome: "email_found",
      email: result.email,
      sourceUrl: result.sourceUrl,
      rule: result.rule,
      reason: result.reason,
    };
  } catch {
    return { outcome: "provider_error", email: null, sourceUrl: null, rule: null, reason: "providerfout" };
  }
}
