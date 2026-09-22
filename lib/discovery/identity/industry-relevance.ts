/**
 * Deterministic industry relevance for Google Places candidates.
 *
 * Google Text Search matches loosely ("schilder" also returns a diamond-painting
 * hobby shop). This closed registry maps the owner's Dutch industry term to
 * Google place types that genuinely represent that trade. It never invents
 * data: a candidate is only excluded when Google supplied types AND none of
 * them belongs to the registry entry. Unknown industries or candidates without
 * types stay "unknown" and are kept, because absence of a type is no proof.
 */

const INDUSTRY_TYPE_REGISTRY: Readonly<Record<string, readonly string[]>> = {
  schilder: ["painter"],
  schildersbedrijf: ["painter"],
  loodgieter: ["plumber"],
  installateur: ["plumber", "electrician"],
  elektricien: ["electrician"],
  dakdekker: ["roofing_contractor"],
  aannemer: ["general_contractor"],
  bouwbedrijf: ["general_contractor"],
  kapper: ["hair_salon", "hair_care", "barber_shop"],
  kapsalon: ["hair_salon", "hair_care", "barber_shop"],
  barbier: ["barber_shop", "hair_salon"],
  schoonheidssalon: ["beauty_salon", "spa"],
  nagelstudio: ["nail_salon", "beauty_salon"],
  massage: ["massage", "spa"],
  fysiotherapeut: ["physiotherapist"],
  fysiotherapie: ["physiotherapist"],
  tandarts: ["dentist", "dental_clinic"],
  dierenarts: ["veterinary_care"],
  restaurant: ["restaurant"],
  cafe: ["cafe", "coffee_shop", "bar"],
  bakker: ["bakery"],
  bakkerij: ["bakery"],
  slager: ["butcher_shop"],
  slagerij: ["butcher_shop"],
  bloemist: ["florist"],
  garage: ["car_repair"],
  autobedrijf: ["car_repair", "car_dealer"],
  autoschade: ["car_repair"],
  makelaar: ["real_estate_agency"],
  advocaat: ["lawyer"],
  accountant: ["accounting"],
  boekhouder: ["accounting"],
  sportschool: ["gym", "fitness_center"],
  dierenwinkel: ["pet_store"],
  fietsenmaker: ["bicycle_store"],
  fietsenwinkel: ["bicycle_store"],
  verhuisbedrijf: ["moving_company"],
  slotenmaker: ["locksmith"],
  kleermaker: ["tailor"],
  verzekeringsadviseur: ["insurance_agency"],
};

export type IndustryRelevance = "relevant" | "mismatch" | "unknown";

export function normalizeIndustryTerm(industry: string | null | undefined): string {
  return (industry ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, " ")
    .trim()
    .split(/\s+/)[0] ?? "";
}

export function knownIndustryTypes(industry: string | null | undefined): readonly string[] | null {
  const key = normalizeIndustryTerm(industry);
  return key && key in INDUSTRY_TYPE_REGISTRY ? INDUSTRY_TYPE_REGISTRY[key] : null;
}

export function assessIndustryRelevance(
  industry: string | null | undefined,
  googleTypes: readonly string[] | null | undefined
): IndustryRelevance {
  const allowed = knownIndustryTypes(industry);
  if (!allowed) return "unknown";
  const types = (googleTypes ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (types.length === 0) return "unknown";
  return types.some((t) => allowed.includes(t)) ? "relevant" : "mismatch";
}
