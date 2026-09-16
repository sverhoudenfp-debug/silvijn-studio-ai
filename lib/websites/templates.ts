import type { WebsiteTemplateType } from "./types";

/**
 * WebsiteTemplateRegistry (Fase 9) — één centrale plek om templates te
 * definiëren. Nieuwe templates toevoegen = één entry hier; de generator,
 * de renderer en de preview-route hoeven daarna niet te worden aangepast.
 * Stylingpatronen zijn overgenomen van het DemoWebsite-systeem (Fase 3).
 */

export interface WebsiteTemplateConfig {
  key: WebsiteTemplateType;
  name: string;
  description: string;
  /** Hero-gradient en accentkleur-klassen (Tailwind, uit het demo-systeem). */
  hero: string;
  accent: string;
  /** Volgorde van de content-sections tussen hero en contact. */
  sectionOrder: Array<"services" | "about" | "benefits" | "faq" | "cta">;
  /** Standaard visuele stijl-hints voor de AI-planning. */
  visualStyle: string;
  /** Branche-hints: keywords die (bij afwezigheid van expliciete keuze) dit template rechtvaardigen. */
  industryHints: string[];
}

export const websiteTemplateRegistry: Record<WebsiteTemplateType, WebsiteTemplateConfig> = {
  local_service: {
    key: "local_service",
    name: "Local Service",
    description: "Warm, direct en lokaal — voor ambachtslieden en dienstverleners in de buurt.",
    hero: "from-sky-800 to-slate-950",
    accent: "bg-sky-600",
    sectionOrder: ["services", "about", "cta"],
    visualStyle: "Toegankelijk en lokaal, warme uitstraling",
    industryHints: ["schoonheidssalon", "kapsalon", "bakker", "fysiotherapie", "taxi", "hondenuitlaat"],
  },
  professional_service: {
    key: "professional_service",
    name: "Professional Service",
    description: "Zakelijk en betrouwbaar — voor technische en professionele dienstverleners.",
    hero: "from-indigo-800 to-zinc-950",
    accent: "bg-indigo-500",
    sectionOrder: ["about", "services", "faq", "cta"],
    visualStyle: "Zakelijk, professioneel, veel witruimte",
    industryHints: ["advocaten", "accountants", "consultants", "it", "verzekeringen", "notaris"],
  },
  home_improvement: {
    key: "home_improvement",
    name: "Home Improvement",
    description: "Rustiek en warm — voor bouw, dakwerk en woonverbetering.",
    hero: "from-stone-700 to-stone-950",
    accent: "bg-amber-600",
    sectionOrder: ["services", "about", "benefits", "cta"],
    visualStyle: "Rustiek, degelijk, warme aardetinten",
    industryHints: ["dakwerk", "bouw", "schilderwerk", "timmerwerk", "isolatie", "hovenier", "vloeren"],
  },
  business_standard: {
    key: "business_standard",
    name: "Business Standard",
    description: "Nuchter en professioneel — breed inzetbaar voor elk bedrijf.",
    hero: "from-emerald-800 to-zinc-950",
    accent: "bg-emerald-600",
    sectionOrder: ["services", "about", "cta"],
    visualStyle: "Nuchter, modern, professioneel",
    industryHints: [],
  },
};

export function getWebsiteTemplateConfig(
  template: WebsiteTemplateType
): WebsiteTemplateConfig {
  return websiteTemplateRegistry[template] ?? websiteTemplateRegistry.business_standard;
}

/** Deterministische template-keuze op basis van branche (fallback: business_standard). */
export function selectTemplateForIndustry(industry: string): WebsiteTemplateType {
  const normalized = industry.toLowerCase();
  for (const config of Object.values(websiteTemplateRegistry)) {
    if (config.industryHints.some((hint) => normalized.includes(hint))) return config.key;
  }
  return "business_standard";
}

export function isWebsiteTemplateType(value: string): value is WebsiteTemplateType {
  return value in websiteTemplateRegistry;
}
