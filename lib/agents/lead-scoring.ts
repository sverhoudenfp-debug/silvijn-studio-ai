import type { Lead } from "@/lib/types";

/**
 * Lead Scoring Agent — berekent een score 0-100 per lead.
 * De weging is volledig configureerbaar via ScoringWeights,
 * zodat de eigenaar later eigen regels kan instellen.
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
  Dakdekkers: 0.9,
  Loodgieters: 0.9,
  Elektriciens: 0.85,
  Garages: 0.8,
  Hoveniers: 0.8,
  Schilders: 0.8,
  Kappers: 0.75,
  "Schoonheidssalons": 0.75,
  Restaurants: 0.7,
  Schoonmaak: 0.65,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function scoreLead(
  lead: Lead,
  weights: ScoringWeights = defaultScoringWeights
): LeadScoreResult {
  const factors: ScoreFactor[] = [];

  factors.push({
    label: "Geen website",
    earned: lead.website ? 0 : weights.noWebsite,
    max: weights.noWebsite,
  });

  const volume = lead.reviewCount ? clamp(lead.reviewCount / 150, 0, 1) : 0;
  factors.push({
    label: "Aantal reviews",
    earned: Math.round(volume * weights.reviewVolume),
    max: weights.reviewVolume,
  });

  const rating = lead.rating ? clamp((lead.rating - 3.5) / 1.5, 0, 1) : 0;
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

  const industry = industryPotential[lead.category] ?? 0.7;
  factors.push({
    label: "Commercieel branchepotentieel",
    earned: Math.round(industry * weights.industryPotential),
    max: weights.industryPotential,
  });

  const score = Math.round(factors.reduce((sum, factor) => sum + factor.earned, 0));

  const reason =
    lead.website
      ? `${lead.category} in ${lead.location} met een bestaande website — lager prioriteit voor outreach.`
      : `Gevestigd ${lead.category.toLowerCase()}bedrijf in ${lead.location} met ${lead.reviewCount ?? 0} reviews (${lead.rating ?? "onbekende"} sterren), geen website en ${lead.email ? "openbare e-mail" : "telefoonnummer"} beschikbaar — sterk commercieel potentieel voor een eerste website.`;

  return { score, reason, factors };
}
