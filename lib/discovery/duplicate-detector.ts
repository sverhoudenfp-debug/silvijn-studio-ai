import type { Lead } from "@/lib/types";
import type { DiscoveryCandidate } from "./types";
import { WebsiteDiscoveryService } from "./website-service";

/**
 * DuplicateDetector — ZEER belangrijk: een bestaande lead mag nooit
 * zomaar opnieuw worden aangemaakt. Vijf signalen:
 *   1. genormaliseerde website (host-level)
 *   2. e-mail (case-insensitive)
 *   3. telefoon (laatste 9 cijfers)
 *   4. genormaliseerde bedrijfsnaam + stad (rechtsvorm/spacing/diacritics eraf)
 *   5. source + external ID
 *
 * Werkt tegen bestaande leads én tegen leads die eerder in dezelfde
 * discovery-batch zijn aangemaakt (batch-bewust).
 */

const LEGAL_SUFFIXES = ["bv", "b.v.", "vof", "cv", "nv", "holding"];

export function normalizeBusinessName(name: string): string {
  let normalized = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "en")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const suffix of LEGAL_SUFFIXES) {
    if (normalized.endsWith(` ${suffix}`)) normalized = normalized.slice(0, -(suffix.length + 1));
  }
  return normalized;
}

export function normalizePhoneKey(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : digits || null;
}

export interface DuplicateCheckInput {
  candidate: DiscoveryCandidate;
  existingLeads: Lead[];
  batchLeads: Lead[];
}

export type DuplicateSignal =
  | "duplicate_website"
  | "duplicate_email"
  | "duplicate_phone"
  | "duplicate_business_city"
  | "duplicate_source_id";

export function findDuplicate({ candidate, existingLeads, batchLeads }: DuplicateCheckInput): DuplicateSignal | null {
  const all = [...existingLeads, ...batchLeads];

  const website = candidate.website;
  const email = candidate.email?.trim().toLowerCase() ?? null;
  const phoneKey = normalizePhoneKey(candidate.phone);
  const nameKey = normalizeBusinessName(candidate.businessName);
  const cityKey = candidate.city?.trim().toLowerCase() ?? "";

  for (const lead of all) {
    if (website && lead.website && WebsiteDiscoveryService.isSameWebsite(website, lead.website)) {
      return "duplicate_website";
    }
    if (email && lead.email && lead.email.trim().toLowerCase() === email) {
      return "duplicate_email";
    }
    if (phoneKey && lead.phone) {
      const leadPhoneKey = normalizePhoneKey(lead.phone);
      if (leadPhoneKey && leadPhoneKey === phoneKey) return "duplicate_phone";
    }
    if (
      nameKey &&
      cityKey &&
      lead.city.trim().toLowerCase() === cityKey &&
      normalizeBusinessName(lead.businessName) === nameKey
    ) {
      return "duplicate_business_city";
    }
    if (
      candidate.externalId &&
      lead.externalId &&
      candidate.source === lead.source &&
      lead.externalId === candidate.externalId
    ) {
      return "duplicate_source_id";
    }
  }

  return null;
}
