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
  return {};
}

/**
 * De actieve prijsconfiguratie voor de PricingEngine. Nu LEEG (config.missing):
 * zolang de Master Configuration niet is ingevuld, berekent de engine geen
 * bedragen maar returned die CONFIGURATION_MISSING. Geen fallback-bedragen.
 */
export function getPricingConfiguration(): PricingConfiguration {
  const config = getAgencyConfiguration();
  return config.pricingConfiguration ?? emptyPricingConfiguration();
}

function emptyPricingConfiguration(): PricingConfiguration {
  return {
    currency: "EUR",
    pricingVersion: "",
    packages: {},
    addOns: {},
    extraPagePrice: null,
    minimumPrice: null,
    maximumPrice: null,
    customProjectThreshold: null,
    humanApprovalThreshold: null,
    priceRangeDeviation: null,
    vatRate: null,
    pricingRules: [],
    customProjectRules: [],
    discountRules: [],
    paymentRules: [],
    revisionRules: [],
    maintenanceRules: [],
    hostingRules: [],
  };
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
