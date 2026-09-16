import { isPricingConfigurationMissing, type PriceIndication, type PricingConfiguration, type PricingLineItem } from "./types";
import type { ProjectRequirements } from "@/lib/projects/types";

/**
 * PricingEngine (Fase 8) — deterministisch, geen AI, geen hardcoded bedragen.
 *
 *   BASE PACKAGE (uit configuratie)
 *   + EXTRA PAGINA'S (uit configuratie)
 *   + ADD-ONS (uit configuratie)
 *   = PRICE INDICATION (met uitlegbare regel-items)
 *
 * Ontbreekt de configuratie → CONFIGURATION_MISSING zonder bedrag.
 * Ontbreekt vereiste requirements → MISSING_INFORMATION zonder bedrag.
 * De engine verzint nooit iets; alles komt uit de PricingConfiguration.
 */

/** Add-on-sleutels die de engine kent (structurele mapping, bedragen uit config). */
const REQUIREMENT_ADDON_KEYS: { requirementKey: keyof ProjectRequirements; addOnKey: string; label: string }[] = [
  { requirementKey: "seo", addOnKey: "seo", label: "SEO" },
  { requirementKey: "copywriting", addOnKey: "copywriting", label: "Tekstschrijving" },
  { requirementKey: "photography", addOnKey: "photography", label: "Fotografie" },
  { requirementKey: "hosting", addOnKey: "hosting", label: "Hosting" },
  { requirementKey: "maintenance", addOnKey: "maintenance", label: "Onderhoud" },
  { requirementKey: "cms", addOnKey: "cms", label: "CMS" },
];

/** Structurele regel: e-commerce betekent bij voorkeur een webshop-pakket. */
const ECOMMERCE_PACKAGE_KEYS = ["webshop", "ecommerce", "e_commerce"];

export interface PricingCalculationInput {
  projectId: string;
  requirements: ProjectRequirements;
}

function buildLineItems(config: PricingConfiguration, requirements: ProjectRequirements): {
  lineItems: PricingLineItem[];
  missingInformation: string[];
  assumptions: string[];
} {
  const lineItems: PricingLineItem[] = [];
  const missingInformation: string[] = [];
  const assumptions: string[] = [];

  // 1) Bepaal het pakket — alléén via de configuratie, nooit gegokt
  let packageKey: string | null = null;
  if (requirements.ecommerce === true) {
    const ecommerceKey = ECOMMERCE_PACKAGE_KEYS.find((key) => config.packages[key]);
    if (ecommerceKey) {
      packageKey = ecommerceKey;
      assumptions.push("E-commerce aangevraagd — webshop-pakket uit de configuratie gehanteerd.");
    }
  }
  if (!packageKey && requirements.websiteType) {
    const direct = Object.keys(config.packages).find(
      (key) => key.toLowerCase() === String(requirements.websiteType).toLowerCase()
    );
    if (direct) packageKey = direct;
  }
  if (!packageKey) {
    if (!requirements.websiteType) {
      missingInformation.push("Type website (pakket) is onbekend — vereist voor een betrouwbare prijsindicatie.");
    } else {
      const matching = Object.values(config.packages).find(
        (p) => p.key.toLowerCase().includes(String(requirements.websiteType).toLowerCase()) ||
               p.label.toLowerCase().includes(String(requirements.websiteType).toLowerCase())
      );
      if (matching) {
        packageKey = matching.key;
        assumptions.push(`Pakket "${matching.label}" gekozen op basis van website type "${requirements.websiteType}".`);
      } else {
        missingInformation.push(`Voor website type "${requirements.websiteType}" bestaat geen pakket in de prijsconfiguratie.`);
      }
    }
  }

  if (!packageKey) {
    return { lineItems, missingInformation, assumptions };
  }

  const selectedPackage = config.packages[packageKey];
  lineItems.push({
    key: `package:${selectedPackage.key}`,
    label: `Basispakket — ${selectedPackage.label}`,
    amount: selectedPackage.basePrice,
    type: "base",
    explanation: selectedPackage.description ?? `Basisprijs pakket ${selectedPackage.label} uit de prijsconfiguratie.`,
  });

  // 2) Extra pagina's — alléén indien extraPagePrice geconfigureerd
  const includedPages = selectedPackage.includedPages ?? null;
  if (config.extraPagePrice != null && config.extraPagePrice > 0) {
    if (requirements.numberOfPages != null && includedPages != null) {
      const extraPages = Math.max(0, requirements.numberOfPages - includedPages);
      if (extraPages > 0) {
        lineItems.push({
          key: "extra_pages",
          label: `Extra pagina's (${extraPages})`,
          amount: extraPages * config.extraPagePrice,
          type: "addon",
          explanation: `${extraPages} pagina's boven de ${includedPages} inbegrepen pagina's, à € ${config.extraPagePrice.toFixed(2)} per pagina.`,
        });
      }
    } else {
      missingInformation.push("Aantal pagina's is onbekend — vereist zodra extra pagina's geprijsd zijn.");
    }
  }

  // 3) Add-ons op basis van requirements (bedragen 100% uit de configuratie)
  for (const mapping of REQUIREMENT_ADDON_KEYS) {
    if (requirements[mapping.requirementKey] !== true) continue;
    const addOn = config.addOns[mapping.addOnKey];
    if (!addOn) continue; // geen prijs bekend → geen bedrag verzinnen
    lineItems.push({
      key: `addon:${addOn.key}`,
      label: `Add-on — ${addOn.label}`,
      amount: addOn.price,
      type: "addon",
      explanation: addOn.description ?? `Add-on ${addOn.label} uit de prijsconfiguratie.`,
    });
  }

  // E-commerce zonder webshop-pakket: alleen prijzen indien een add-on bestaat
  if (requirements.ecommerce === true && !ECOMMERCE_PACKAGE_KEYS.includes(packageKey)) {
    const ecommerceAddOn = config.addOns["ecommerce"];
    if (ecommerceAddOn) {
      lineItems.push({
        key: "addon:ecommerce",
        label: `Add-on — ${ecommerceAddOn.label}`,
        amount: ecommerceAddOn.price,
        type: "addon",
        explanation: ecommerceAddOn.description ?? "E-commerce add-on uit de prijsconfiguratie.",
      });
    } else {
      missingInformation.push("E-commerce aangevraagd maar niet geprijsd in de configuratie — menselijke beoordeling nodig.");
    }
  }

  return { lineItems, missingInformation, assumptions };
}

export function calculatePriceIndication(
  input: PricingCalculationInput,
  config: PricingConfiguration,
  now: string = new Date().toISOString()
): PriceIndication {
  const base: Omit<PriceIndication, "status" | "requiresHuman" | "escalationReasons"> = {
    id: `price-${input.projectId}-${Date.now()}`,
    projectId: input.projectId,
    currency: config.currency || "EUR",
    pricingVersion: config.pricingVersion,
    lineItems: [],
    basePrice: 0,
    addOnsTotal: 0,
    adjustmentsTotal: 0,
    subtotal: 0,
    tax: 0,
    total: 0,
    priceRange: null,
    assumptions: [],
    missingInformation: [],
    calculatedAt: now,
  };

  // 1) Configuratie ontbreekt → nooit een bedrag verzinnen
  if (isPricingConfigurationMissing(config)) {
    return {
      ...base,
      pricingVersion: "",
      status: "configuration_missing",
      requiresHuman: true,
      escalationReasons: ["Pricing configuration is nog niet ingesteld — geen prijs berekend."],
    };
  }

  const { lineItems, missingInformation, assumptions } = buildLineItems(config, input.requirements);

  // 2) Ontbrekende vereiste informatie → geen betrouwbaar bedrag
  if (lineItems.length === 0 || missingInformation.length > 0) {
    return {
      ...base,
      lineItems,
      assumptions,
      missingInformation,
      status: "missing_information",
      requiresHuman: missingInformation.length === 0 && lineItems.length === 0,
      escalationReasons:
        missingInformation.length === 0 && lineItems.length === 0
          ? ["Requirements zijn te onvolledig voor een prijsindicatie."]
          : [],
    };
  }

  // 3) Deterministische optelling
  const basePrice = lineItems.filter((item) => item.type === "base").reduce((sum, item) => sum + item.amount, 0);
  const addOnsTotal = lineItems.filter((item) => item.type === "addon").reduce((sum, item) => sum + item.amount, 0);
  const subtotal = basePrice + addOnsTotal;

  const escalationReasons: string[] = [];

  // 4) Grenzen uit de configuratie
  if (config.minimumPrice != null && subtotal < config.minimumPrice) {
    escalationReasons.push(`Indicatie (€ ${subtotal.toFixed(2)}) ligt onder het geconfigureerde minimum van € ${config.minimumPrice.toFixed(2)}.`);
  }
  if (config.maximumPrice != null && subtotal > config.maximumPrice) {
    escalationReasons.push(`Indicatie (€ ${subtotal.toFixed(2)}) ligt boven het geconfigureerde maximum van € ${config.maximumPrice.toFixed(2)}.`);
  }
  if (config.humanApprovalThreshold != null && subtotal > config.humanApprovalThreshold) {
    escalationReasons.push(`Indicatie boven de goedkeuringsdrempel van € ${config.humanApprovalThreshold.toFixed(2)} — menselijke goedkeuring verplicht.`);
  }

  // 5) Custom functionaliteit → alleen menselijke beoordeling
  const hasCustomWork = Boolean(
    input.requirements.customFunctionality?.trim() ||
    (input.requirements.integrations && input.requirements.integrations.length > 0)
  );
  if (hasCustomWork) {
    escalationReasons.push("Custom functionaliteit/integraties aangevraagd — geen standaardprijs, menselijke beoordeling verplicht.");
  }

  const vatRate = config.vatRate ?? null;
  const tax = vatRate != null ? subtotal * vatRate : 0;
  const total = subtotal + tax;

  const priceRange =
    config.priceRangeDeviation != null && config.priceRangeDeviation > 0
      ? { min: Math.round(total * (1 - config.priceRangeDeviation)), max: Math.round(total * (1 + config.priceRangeDeviation)) }
      : null;

  return {
    ...base,
    lineItems,
    basePrice,
    addOnsTotal,
    adjustmentsTotal: 0,
    subtotal,
    tax,
    total,
    priceRange,
    assumptions: [
      ...assumptions,
      ...(vatRate == null ? ["Bedragen exclusief btw — btw-regels volgen zodra geconfigureerd."] : []),
      "Dit is een PRIJSINDICATIE, geen definitieve offerte; pas na menselijke goedkeuring bindend.",
    ],
    missingInformation,
    status: escalationReasons.length > 0 ? "requires_human" : "ready",
    requiresHuman: escalationReasons.length > 0,
    escalationReasons,
  };
}
