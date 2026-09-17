/**
 * AgencyConfiguration — de architecturale voorbereiding op de toekomstige
 * Master Configuration. Alle velden zijn optioneel en worden LATER gevuld
 * door Silvijn via de Master Configuration-vragenlijst — nu dus NIET.
 *
 * Elke agent (outreach, sales, qualification, pricing, website generation,
 * quality control) leest zijn regels hieruit in plaats van dezelfde regels
 * per agent te dupliceren.
 */

import type { PricingConfiguration } from "@/lib/pricing/types";

export interface AgencyConfiguration {
  companyName?: string;
  companyDescription?: string;
  targetMarket?: string;
  idealCustomerProfile?: string;
  industries?: string[];
  geographicTargeting?: string;
  services?: string[];
  websitePackages?: string[];
  /** Gestructureerde prijsconfiguratie (Fase 8) — LATER gevuld via de Master Configuration; nu leeg. */
  pricingConfiguration?: PricingConfiguration | null;
  revisionRules?: string;
  paymentRules?: string;
  communicationTone?: string;
  outreachRules?: string[];
  salesRules?: string[];
  qualificationRules?: string[];
  demoRules?: string[];
  websiteDesignRules?: string[];
  technologyRules?: string[];
  forbiddenClaims?: string[];
  approvalRequirements?: string[];
  escalationRules?: string[];
  aiBehaviorRules?: string[];
}

/**
 * Verplicht neutrale fallback-regels — deze gelden totdat de Master
 * Configuration wordt ingevuld. Geen verzonnen bedrijfsdetails.
 */
export const DEFAULT_OUTREACH_RULES: string[] = [
  "Gebruik uitsluitend informatie uit de aangeleverde leaddata; verzin niets.",
  "Noem geen contactpersoon bij naam; er is geen contactpersoon bekend.",
  "Doe geen claims die niet uit de leaddata volgen (bijv. verlies van klanten).",
  "Noem de demo-website alleen als die in de input staat.",
  "Nederlandse, neutrale, professionele toon; korte e-mail.",
  "Vermeld nooit richting de ontvanger dat de tekst AI-gegenereerd is.",
  "Beloof geen prijzen, contracten of resultaten.",
];

export function getAgencyConfiguration(): AgencyConfiguration {
  // Master Configuration (latere fase) vult deze waarden centraal.
  // TECHNISCHE OVERRIDE (Fase 11): zolang de Master Configuration er nog
  // niet is, kan AGENCY_CONFIG_JSON als volledige configuratie dienen
  // (bijv. voor lokale tests). Leeg/ongeldig → {} → alle velden UNKNOWN.
  // Er worden nooit defaults of fallbacks verzonnen.
  const raw = (process.env.AGENCY_CONFIG_JSON ?? "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as AgencyConfiguration;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    // Ongeldige JSON → bewust leeg (fail-safe), nooit gokken.
    return {};
  }
}

/**
 * De actieve prijsconfiguratie voor de PricingEngine. Nu LEEG (config.missing):
 * zolang de Master Configuration niet is ingevuld, berekent de engine geen
 * bedragen maar returned die CONFIGURATION_MISSING. Geen fallback-bedragen.
 */
export async function getPricingConfiguration(): Promise<PricingConfiguration> {
  const { getSupabaseServerClient } = await import("@/lib/supabase/server");
  const { masterPricingConfiguration } = await import("@/lib/pricing/master-config");
  const { data, error } = await getSupabaseServerClient().from("studio_settings").select("value").eq("key", "pricing").single();
  if (error || !data) throw new Error("BLOCKED_EXTERNAL_CONFIGURATION: centrale prijsconfiguratie ontbreekt");
  return masterPricingConfiguration(data.value);
}

/**
 * Regels die de outreach-prompt afdwingt: de expliciete outreachRules
 * uit de config, anders de neutrale defaults.
 */
export function getOutreachRules(): string[] {
  const config = getAgencyConfiguration();
  return config.outreachRules && config.outreachRules.length > 0
    ? config.outreachRules
    : DEFAULT_OUTREACH_RULES;
}
