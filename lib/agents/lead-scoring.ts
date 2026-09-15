import type { Lead } from "@/lib/types";

/**
 * Lead Scoring Agent — berekent een score 0-100 per lead.
 * De weging is volledig configureerbaar via ScoringWeights,
 * zodat de eigenaar later eigen regels kan instellen.
 * Fase 2: rule-based, geen echte AI API calls.
 */

export interface ScoringWeights {
  noWebsite: number;
  reviewVolume: number;
  reviewRating: number;
  contactAvailability: number;
  industryPotential: number;
}

export const defaultScoringWeights: ScoringWeights = {
  noWebsite: 30,
  reviewVolume: 20,
  reviewRating: 15,
  contactAvailability: 15,
  industryPotential: 20,
};

export interface ScoreFactor {
  label: string;
  earned: number;
  max: number;
}

export interface LeadScoreResult {
  score: number;
  reason: string;
  factors: ScoreFactor[];
}

const industryPotential: Record<string, number> = {
  Dakwerken: 0.9,
  Loodgieters: 0.9,
  Elektriciens: 0.85,
  Installatietechniek: 0.85,
  Bouwbedrijven: 0.85,
  Hoveniers: 0.8,
  Schilders: 0.8,
  Autogarages: 0.8,
  Keukenzaken: 0.8,
  Schoonmaak: 0.65,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export type ScorableLead = Pick<
  Lead,
  "websiteStatus" | "reviewCount" | "googleRating" | "email" | "phone" | "industry" | "city"
>;

export function scoreLead(
  lead: ScorableLead,
  weights: ScoringWeights = defaultScoringWeights
): LeadScoreResult {
  const factors: ScoreFactor[] = [];

  const websiteFactor =
    lead.websiteStatus === "no_website"
      ? 1
      : lead.websiteStatus === "website_poor"
        ? 0.5
        : lead.websiteStatus === "unknown"
          ? 0.25
          : 0;
  factors.push({
    label: "Geen website",
    earned: websiteFactor * weights.noWebsite,
    max: weights.noWebsite,
  });

  const volume = lead.reviewCount ? clamp(lead.reviewCount / 150, 0, 1) : 0;
  factors.push({
    label: "Aantal reviews",
    earned: Math.round(volume * weights.reviewVolume),
    max: weights.reviewVolume,
  });

  const rating = lead.googleRating ? clamp((lead.googleRating - 3.5) / 1.5, 0, 1) : 0;
  factors.push({
    label: "Review score",
    earned: Math.round(rating * weights.reviewRating),
    max: weights.reviewRating,
  });

  const contact = lead.email ? 1 : lead.phone ? 0.5 : 0;
  factors.push({
    label: "Contactgegevens beschikbaar",
    earned: contact * weights.contactAvailability,
    max: weights.contactAvailability,
  });

  const industry = industryPotential[lead.industry] ?? 0.7;
  factors.push({
    label: "Commercieel branchepotentieel",
    earned: Math.round(industry * weights.industryPotential),
    max: weights.industryPotential,
  });

  const score = Math.round(factors.reduce((sum, factor) => sum + factor.earned, 0));

  const reason =
    lead.websiteStatus === "no_website"
      ? `Established ${lead.industry.toLowerCase()} company in ${lead.city} with ${lead.reviewCount ?? 0} reviews (${lead.googleRating ?? "unknown"} rating), no website and ${lead.email ? "public e-mail" : "phone number"} available — strong commercial potential for a first website.`
      : `${lead.industry} company in ${lead.city} with ${lead.websiteStatus === "has_website" ? "an existing website" : "an underperforming or unknown website"} — lower priority for outreach in the current phase.`;

  return { score, reason, factors };
}
