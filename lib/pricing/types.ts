/**
 * Pricing-domein types (Fase 8).
 *
 * KERNPRINCIPE: de PricingEngine bevat NOOIT hardcoded bedragen. Alle
 * commerciële waarden komen uit de centrale PricingConfiguration (onderdeel
 * van de AgencyConfiguration / latere Master Configuration). Is die leeg,
 * dan is de status CONFIGURATION_MISSING — er wordt nooit een (fallback-)
 * bedrag verzonnen.
 */

export interface PricingPackage {
  key: string;
  label: string;
  basePrice: number;
  includedPages?: number | null;
  description?: string;
  features?: string[];
}

export interface PricingAddOn {
  key: string;
  label: string;
  price: number;
  description?: string;
}

/**
 * Centrale prijsconfiguratie — wordt LATER gevuld door Silvijn via de
 * Master Configuration. Alle bedragen optioneel; leeg = onbekend.
 */
export interface PricingConfiguration {
  currency: string; // bijv. "EUR"
  pricingVersion: string; // bijv. "2026.09" — herleidbaarheid van indicaties
  packages: Record<string, PricingPackage>;
  addOns: Record<string, PricingAddOn>;
  extraPagePrice?: number | null;
  minimumPrice?: number | null;
  maximumPrice?: number | null;
  customProjectThreshold?: number | null;
  humanApprovalThreshold?: number | null; // boven dit bedrag: altijd menselijke goedkeuring
  priceRangeDeviation?: number | null; // bijv. 0.1 = ±10% indicatieruimte
  vatRate?: number | null; // bijv. 0.21 — pas zodra geconfigureerd
  pricingRules: string[];
  customProjectRules: string[];
  discountRules?: string[];
  paymentRules?: string[];
  revisionRules?: string[];
  maintenanceRules?: string[];
  hostingRules?: string[];
}

export interface PricingLineItem {
  key: string;
  label: string;
  amount: number;
  type: "base" | "addon" | "adjustment";
  explanation: string; // menselijk leesbare toelichting per regel
}

export type PriceIndicationStatus =
  | "ready"
  | "missing_information"
  | "configuration_missing"
  | "requires_human";

export interface PriceIndication {
  id: string;
  projectId: string;
  currency: string;
  pricingVersion: string;
  /** Uitlegbare berekening — regel voor regel, niet alleen een eindbedrag. */
  lineItems: PricingLineItem[];
  basePrice: number;
  addOnsTotal: number;
  adjustmentsTotal: number;
  subtotal: number;
  tax: number;
  total: number;
  priceRange: { min: number; max: number } | null;
  assumptions: string[];
  missingInformation: string[];
  status: PriceIndicationStatus;
  requiresHuman: boolean;
  escalationReasons: string[];
  calculatedAt: string;
}

export function isPricingConfigurationMissing(config: PricingConfiguration): boolean {
  return !config || !config.pricingVersion || Object.keys(config.packages ?? {}).length === 0;
}
