import type { DemoTemplate } from "@/lib/types";

/**
 * Template-systeem voor demo-websites.
 * Een nieuwe template toevoegen = één entry hier; de DemoRenderer
 * en de preview-route hoeven daarna niet te worden aangepast.
 */

export interface DemoTemplateConfig {
  key: DemoTemplate;
  name: string;
  description: string;
  hero: string;
  accent: string;
  sectionOrder: Array<"services" | "about" | "cta">;
}

export const demoTemplates: Record<DemoTemplate, DemoTemplateConfig> = {
  theme_page: {
    key: "theme_page",
    name: "Eigen thema (één pagina)",
    description: "G4: gerenderd uit ons eigen Shopify-thema als zelfstandig HTML-document; uitsluitend leadfeiten plus neutrale placeholders.",
    hero: "from-slate-800 to-slate-950",
    accent: "bg-slate-700",
    sectionOrder: ["services", "about", "cta"],
  },
  local_service: {
    key: "local_service",
    name: "Local Service",
    description: "Warm, direct en lokaal — ideal voor ambachtslieden en dienstverleners in de buurt.",
    hero: "from-sky-800 to-slate-950",
    accent: "bg-sky-600",
    sectionOrder: ["services", "about", "cta"],
  },
  professional_service: {
    key: "professional_service",
    name: "Professional Service",
    description: "Zakelijk en betrouwbaar — voor technische en professionele dienstverleners.",
    hero: "from-indigo-800 to-zinc-950",
    accent: "bg-indigo-500",
    sectionOrder: ["about", "services", "cta"],
  },
  home_improvement: {
    key: "home_improvement",
    name: "Home Improvement",
    description: "Rustiek en warm — voor bouw, dakwerk en woonverbetering.",
    hero: "from-stone-700 to-stone-950",
    accent: "bg-amber-600",
    sectionOrder: ["services", "about", "cta"],
  },
  business_standard: {
    key: "business_standard",
    name: "Business Standard",
    description: "Nuchter en professioneel — breed inzetbaar voor elk bedrijf.",
    hero: "from-emerald-800 to-zinc-950",
    accent: "bg-emerald-600",
    sectionOrder: ["services", "about", "cta"],
  },
};
