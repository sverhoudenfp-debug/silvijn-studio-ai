// Gedeelde theme-fixtures — exact dezelfde inhoud als voorheen in
// theme-zip.test.ts (geen verzonnen bedrijfsfeiten). Memory-mode:
// verwijdert de Supabase-env vóór enige import (nooit productie raken).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import { buildShopifyTheme } from "../../lib/websites/theme-zip/theme-builder";
import { designPlanSchema, type DesignPlan } from "../../lib/websites/design-plan";
import { WebsiteSpecificationSchema } from "../../lib/ai/schemas";
import type { WebsiteSpecification } from "../../lib/websites/types";
import type { WebsiteContactContext } from "../../lib/websites/generator";
import type { ProjectRequirements } from "../../lib/projects/types";
import type { ThemeFile } from "../../lib/websites/theme-zip/theme-structure";

export const REQUIREMENTS: ProjectRequirements = {
  websiteType: "business_website",
  numberOfPages: 3,
  designLevel: "standard",
  ecommerce: false,
  copywriting: true,
};

export const SPECIFICATION: WebsiteSpecification = WebsiteSpecificationSchema.parse({
  template: "local_service",
  business: {
    businessName: "Hovenier van Dijk",
    industry: "hovenier",
    city: "Apeldoorn",
    province: "Gelderland",
    description: null,
    targetAudience: "Particuliere tuineigenaren in Apeldoorn en omstreken",
  },
  branding: {
    primaryColor: null,
    secondaryColor: null,
    accentColor: null,
    backgroundStyle: null,
    typographyStyle: null,
    visualStyle: null,
  },
  structure: {
    pages: [
      { key: "home", title: "Home" },
      { key: "diensten", title: "Diensten" },
      { key: "contact", title: "Contact" },
    ],
    navigation: ["Home", "Diensten", "Contact"],
    sections: ["hero", "services", "about", "cta", "contact"],
  },
  content: {
    headline: "Onderhoud en aanleg van tuinen in Apeldoorn",
    subheadline: "Van sneeuwvrij tot complete tuinontwerpen — vakwerk, op tijd",
    valueProposition: "Meer dan tien jaar ervaring met tuinen in Gelderland",
    services: [
      { title: "Tuinaanleg", description: "Complete aanleg van nieuwe tuinen, van ontwerp tot oplevering." },
      { title: "Tuinonderhoud", description: "Structureel onderhoud: snoei, borders en gazons." },
    ],
    about: "Hovenier van Dijk is een lokaal bedrijf uit Apeldoorn.",
    benefits: ["Persoonlijk contact", "Vrijblijvende offerte"],
    faq: [
      { question: "Werken jullie ook buiten Apeldoorn?", answer: "We werken in Apeldoorn en directe omgeving." },
    ],
    testimonials: [],
    contactIntro: "Vraag een vrijblijvende offerte aan.",
    ctaPrimaryText: "Vraag een offerte aan",
    ctaSecondaryText: "Bekijk onze diensten",
  },
  conversion: {
    primaryCta: "offerte",
    secondaryCta: "diensten",
    contactMethods: ["telefoon"],
    leadCapture: true,
  },
  media: {
    imageRequirements: [
      { key: "hero", description: "Sfeerbeeld van een aangelegde tuin", required: true },
    ],
    imageDescriptions: ["Sfeerbeeld van een aangelegde tuin"],
    imagePlaceholders: ["placeholder-hero"],
  },
  seo: {
    title: "Hovenier van Dijk — Apeldoorn",
    metaDescription: "Hovenier van Dijk verzorgt tuinaanleg en tuinonderhoud in Apeldoorn en omgeving.",
    keywords: ["hovenier apeldoorn", "tuinontwerp gelderland"],
    localArea: "Apeldoorn",
  },
  missingInformation: [],
}) as WebsiteSpecification;

export const DESIGN_PLAN: DesignPlan = designPlanSchema.parse({
  goals: {
    primaryGoal: "Meer offerteaanvragen uit Apeldoorn en omstreken",
    secondaryGoals: ["Telefonische bereikbaarheid benadrukken"],
    conversionGoal: "Offerteaanvraag via contactformulier of telefoon",
  },
  audience: {
    primaryAudience: "Particuliere tuineigenaren in Apeldoorn",
    secondaryAudiences: [],
    toneOfVoice: "Nederlands, concreet en lokaal",
  },
  navigation: {
    items: [
      { label: "Home", pageKey: "home" },
      { label: "Diensten", pageKey: "diensten" },
      { label: "Contact", pageKey: "contact" },
    ],
    structure: "Horizontale hoofdnavigatie met drie items",
  },
  pageStructure: [
    { key: "home", title: "Home", purpose: "Landingspagina met hoofd-CTA", sections: ["hero", "diensten", "contact"] },
    { key: "diensten", title: "Diensten", purpose: "Overzicht van diensten", sections: ["intro", "diensten"] },
    { key: "contact", title: "Contact", purpose: "Contactgegevens en formulier", sections: ["gegevens", "formulier"] },
  ],
  visualHierarchy: {
    strategy: "Grote hero-kop, daarna rustige secties met kaarten",
    aboveTheFold: ["Hoofdkop", "Subkop", "Primair CTA"],
  },
  branding: {
    styleDirection: "Rustig, groen, vakmanschap",
    mood: ["natuurlijk", "betrouwbaar"],
    existingBrandAssets: null,
    preferredColors: ["groen"],
    dislikedColors: [],
    restrictions: [],
  },
  typography: {
    pairing: "Serif-koppen met sans-serif lopende tekst",
    scale: "1.25 major third",
    weights: ["400", "600"],
    rationale: "Serif onderstreept vakmanschap",
  },
  colors: {
    primary: "#2f5233",
    secondary: "#7a8f6d",
    accent: "#c9a55a",
    neutrals: ["#ffffff", "#f4f6f2", "#22301f", "#5b6657", "#dfe4dc"],
    usageGuidance: "Groen voor koppen en CTA, goudkleur als accent",
  },
  spacing: { scale: "8px-basis", density: "ruim" },
  components: [
    { key: "hero", purpose: "Eerste indruk met hoofd-CTA", notes: "Sfeerbeeld van tuin" },
    { key: "contact", purpose: "Contactformulier", notes: null },
  ],
  ctaStrategy: {
    primary: "Vraag een offerte aan",
    secondary: "Bekijk onze diensten",
    placement: ["Hero", "Eindsectie"],
    leadCapture: true,
  },
  imagery: {
    style: "Natuurlijke sfeerbeelden van tuinen",
    requirements: ["Eigen fotomateriaal van uitgevoerde tuinen"],
    placeholderStrategy: "Neutrale SVG-placeholder tot fotomateriaal beschikbaar is",
  },
  responsive: {
    mobile: "Eénkoloms met navigatie-uitklapper",
    tablet: "Tweekoloms",
    desktop: "Driekoloms",
    breakpoints: ["760px", "1024px"],
  },
  animation: {
    strategy: "Minimaal: hover-states",
    allowed: ["hover"],
    restrictions: ["geen parallax"],
  },
  functionality: {
    features: [{ key: "contactformulier", description: "Contactformulier", source: "requirements" }],
    integrations: [],
  },
  accessibility: {
    contrast: "Minimaal 4.5:1 lichaamstekst",
    focusAndKeyboard: "Zichtbare focus-states",
    semantics: "Semantische koppenstructuur",
    formsAndLabels: "Elk veld een label",
    guidelines: ["WCAG 2.2 AA"],
  },
  seoPerformance: {
    titleStrategy: "Plaats + vak in de titel",
    metaStrategy: "Lokale beschrijving met CTA",
    localSeo: "Apeldoorn en omgeving benoemen",
    performanceBudget: "Geen externe fonts, systeemstack",
    imageOptimization: "Responsive images met lazy loading",
  },
  basis: { sources: ["lead", "project", "requirements"] },
  missingInformation: [],
});

export const CONTACT: WebsiteContactContext = {
  phone: "+31555012345",
  email: "info@hovandijk.example",
  address: "Tuinstraat 12",
  city: "Apeldoorn",
  province: "Gelderland",
};

export function builtTheme(): ThemeFile[] {
  return buildShopifyTheme({
    specification: SPECIFICATION,
    designPlan: DESIGN_PLAN,
    contact: CONTACT,
  }).files;
}
