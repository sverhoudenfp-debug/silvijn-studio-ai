import { z } from "zod";
import type { PricingConfiguration } from "./types";
export const masterPricingSchema = z.object({
  currency: z.literal("EUR"), version: z.string().min(1),
  firstPage: z.number().positive(), extraPage: z.number().nonnegative(), webshopFrom: z.number().positive(),
  vatRate: z.number().min(0).max(1).nullable(),
  addOns: z.record(z.string(), z.number().nonnegative()).default({}),
});
export function masterPricingConfiguration(value: unknown): PricingConfiguration {
  const v = masterPricingSchema.parse(value);
  return {
    currency: v.currency, pricingVersion: v.version,
    packages: {
      business_website: { key: "business_website", label: "Custom Shopify website", basePrice: v.firstPage, includedPages: 1 },
      webshop: { key: "webshop", label: "Webshop vanafprijs, scope vereist", basePrice: v.webshopFrom, includedPages: 1 },
    },
    extraPagePrice: v.extraPage,
    addOns: Object.fromEntries(Object.entries(v.addOns).map(([key, price]) => [key, { key, label: key, price }])),
    vatRate: v.vatRate, priceRangeDeviation: null,
    pricingRules: ["Prijs op basis van scope en complexiteit, nooit branche.", "Elke prijs vereist expliciete goedkeuring van Silvijn."],
    customProjectRules: ["Niet-geconfigureerde functionaliteit vereist een concrete menselijke prijsbeoordeling."],
  };
}
