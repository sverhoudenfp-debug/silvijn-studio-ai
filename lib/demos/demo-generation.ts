import "server-only";
import { createHash } from "node:crypto";
import { WebsiteSpecificationSchema } from "@/lib/ai/schemas";
import { designPlanSchema, type DesignPlan } from "@/lib/websites/design-plan";
import type { WebsiteSpecification } from "@/lib/websites/types";
import type { WebsiteContactContext } from "@/lib/websites/generator";
import { selectTemplateForIndustry } from "@/lib/websites/templates";
import { buildShopifyTheme } from "@/lib/websites/theme-zip/theme-builder";
import { validateThemeFiles } from "@/lib/websites/theme-zip/theme-validation";
import { renderThemePageHtml } from "@/lib/websites/theme-zip/html-preview";
import { slugifyBusinessName } from "@/lib/websites/slug";
import type { Lead } from "@/lib/types";

/**
 * G4 — Gratis één-pagina-demo (masterconfig Part 2).
 *
 * Regels die hier hard gelden:
 * - Precies één volledige pagina (homepage) uit ons EIGEN Shopify-thema,
 *   gerenderd naar een zelfstandig HTML-document. Geen legacy React-template.
 * - Uitsluitend betrouwbare leadfeiten (naam, branche, plaats, provincie,
 *   bekende telefoon/e-mail/adres). Alle overige tekst is een zichtbaar
 *   neutrale VOORBEELDTEKST-placeholder; er wordt niets verzonnen: geen
 *   diensten, prijzen, ervaring, reviews, garanties of openingstijden.
 * - Geen AI-call nodig: de demo is deterministisch en gratis reproduceerbaar.
 *   AI-copy kan later als aparte, door Silvijn gecontroleerde stap komen.
 * - Geen prijs, betaling, leadstatus- of productiepoort wordt aangeraakt.
 */

export const DEMO_PLACEHOLDER_PREFIX = "Voorbeeldtekst";

export class DemoGenerationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "DemoGenerationError";
  }
}

export interface DemoThemeInputs {
  specification: WebsiteSpecification;
  designPlan: DesignPlan;
  contact: WebsiteContactContext;
  /** Feitelijke bronwaarden die in de demo mogen voorkomen (voor de fabricatiescan). */
  trustedClaims: string[];
  /** Eerlijke lijst van wat ontbreekt, voor Silvijn en de demo-notities. */
  missingInformation: string[];
}

function clean(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : null;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Bouwt deterministisch de thema-invoer uit uitsluitend leadfeiten. */
export function buildDemoThemeInputs(lead: Lead): DemoThemeInputs {
  const businessName = clean(lead.businessName);
  const industry = clean(lead.industry);
  const city = clean(lead.city);
  if (!businessName || businessName.length < 2) throw new DemoGenerationError("LEAD_NAME_MISSING", "Lead heeft geen bruikbare bedrijfsnaam.");
  if (!industry || industry.length < 2) throw new DemoGenerationError("LEAD_INDUSTRY_MISSING", "Lead heeft geen bruikbare branche.");
  if (!city || city.length < 2) throw new DemoGenerationError("LEAD_CITY_MISSING", "Lead heeft geen bruikbare plaats.");

  const province = clean(lead.province);
  const phone = clean(lead.phone);
  const email = clean(lead.email);
  const address = clean(lead.address);
  const industryLabel = industry.toLowerCase();

  const missingInformation: string[] = [];
  if (!phone) missingInformation.push("Telefoonnummer onbekend: contact via formulier in de demo.");
  if (!email) missingInformation.push("E-mailadres onbekend: niet getoond in de demo.");
  if (!address) missingInformation.push("Bezoekadres onbekend: niet getoond in de demo.");
  missingInformation.push("Diensten, over-ons-tekst en beeldmateriaal zijn neutrale voorbeeldplaceholders; nog geen klantinput.");

  const contactMethods: string[] = ["formulier"];
  if (phone) contactMethods.push("telefoon");
  if (email) contactMethods.push("e-mail");

  const headline = `${businessName}: ${industryLabel} in ${city}`;
  const placeholder = (what: string) => `${DEMO_PLACEHOLDER_PREFIX}: ${what}`;

  const specification = WebsiteSpecificationSchema.parse({
    template: selectTemplateForIndustry(industry),
    business: {
      businessName,
      industry,
      city,
      province,
      description: null,
      targetAudience: null,
    },
    branding: { primaryColor: null, secondaryColor: null, accentColor: null, backgroundStyle: null, typographyStyle: null, visualStyle: null },
    structure: {
      pages: [{ key: "home", title: "Home" }],
      navigation: ["Home", "Contact"],
      sections: ["hero", "services", "about", "cta", "contact"],
    },
    content: {
      headline,
      subheadline: placeholder("hier komt uw eigen introductie over wat u doet en voor wie."),
      valueProposition: null,
      services: [
        { title: "Dienst 1", description: placeholder("korte omschrijving van deze dienst.") },
        { title: "Dienst 2", description: placeholder("korte omschrijving van deze dienst.") },
        { title: "Dienst 3", description: placeholder("korte omschrijving van deze dienst.") },
      ],
      about: placeholder(`hier komt het verhaal van ${businessName} uit ${city}.`),
      benefits: [],
      faq: [],
      testimonials: [],
      contactIntro: phone ? `Bel ${phone} of gebruik het formulier.` : "Gebruik het formulier om contact op te nemen.",
      ctaPrimaryText: "Neem contact op",
      ctaSecondaryText: null,
    },
    conversion: { primaryCta: "contact", secondaryCta: null, contactMethods, leadCapture: true },
    media: {
      imageRequirements: [{ key: "hero", description: `Eigen sfeerbeeld van ${businessName}`, required: true }],
      imageDescriptions: [`Eigen sfeerbeeld van ${businessName}`],
      imagePlaceholders: ["placeholder-hero"],
    },
    seo: {
      title: `${businessName} | ${capitalize(industryLabel)} in ${city}`,
      metaDescription: `${businessName} is een ${industryLabel} in ${city}. Deze pagina is een voorbeeldontwerp van Silvijn Studio.`.slice(0, 200),
      keywords: [`${industryLabel} ${city.toLowerCase()}`],
      localArea: city,
    },
    missingInformation,
  }) as WebsiteSpecification;

  const designPlan = designPlanSchema.parse({
    goals: {
      primaryGoal: `Laten zien hoe een eigen website voor ${businessName} kan aanvoelen`,
      secondaryGoals: [],
      conversionGoal: "Contactaanvraag via formulier" + (phone ? " of telefoon" : ""),
    },
    audience: { primaryAudience: `Klanten van een ${industryLabel} in ${city} en omgeving`, secondaryAudiences: [], toneOfVoice: "Nederlands, helder en lokaal" },
    navigation: { items: [{ label: "Home", pageKey: "home" }, { label: "Contact", pageKey: "home" }], structure: "Eén pagina met ankernavigatie naar het contactblok" },
    pageStructure: [{ key: "home", title: "Home", purpose: "Eén-pagina-demo met hero, diensten, over ons, CTA en contact", sections: ["hero", "diensten", "over", "cta", "contact"] }],
    visualHierarchy: { strategy: "Grote hero-kop met bedrijfsnaam, daarna rustige secties", aboveTheFold: ["Bedrijfsnaam", "Branche en plaats", "Primaire CTA"] },
    branding: { styleDirection: "Rustig, professioneel, lokaal", mood: ["betrouwbaar", "helder"], existingBrandAssets: null, preferredColors: [], dislikedColors: [], restrictions: ["Geen verzonnen claims"] },
    typography: { pairing: "Sans-serif koppen en lopende tekst", scale: "1.25 major third", weights: ["400", "600"], rationale: "Neutraal en goed leesbaar zonder merkinput" },
    colors: { primary: "#1f3a5f", secondary: "#4f6d8f", accent: "#c8873a", neutrals: ["#ffffff", "#f5f7fa", "#1b2430", "#5b6673", "#dde3ea"], usageGuidance: "Blauw voor koppen en CTA, warm accent spaarzaam" },
    spacing: { scale: "8px-basis", density: "ruim" },
    components: [
      { key: "hero", purpose: "Eerste indruk met bedrijfsnaam en CTA", notes: "Neutrale placeholder tot eigen beeld beschikbaar is" },
      { key: "contact", purpose: "Contactformulier" + (phone ? " en telefoonnummer" : ""), notes: null },
    ],
    ctaStrategy: { primary: "Neem contact op", secondary: null, placement: ["Hero", "Eindsectie"], leadCapture: true },
    imagery: { style: "Neutrale placeholders", requirements: ["Eigen fotomateriaal van het bedrijf"], placeholderStrategy: "Neutrale SVG-placeholder tot fotomateriaal beschikbaar is" },
    responsive: { mobile: "Eénkoloms met navigatie-uitklapper", tablet: "Tweekoloms", desktop: "Driekoloms", breakpoints: ["760px", "1024px"] },
    animation: { strategy: "Minimaal: hover-states", allowed: ["hover"], restrictions: ["geen parallax"] },
    functionality: { features: [{ key: "contactformulier", description: "Contactformulier (inert in de demo)", source: "requirements" }], integrations: [] },
    accessibility: { contrast: "Minimaal 4.5:1 lichaamstekst", focusAndKeyboard: "Zichtbare focus-states", semantics: "Semantische koppenstructuur", formsAndLabels: "Elk veld een label", guidelines: ["WCAG 2.2 AA"] },
    seoPerformance: { titleStrategy: "Bedrijfsnaam, branche en plaats", metaStrategy: "Feitelijke lokale beschrijving", localSeo: `${city} benoemen`, performanceBudget: "Zelfstandig document zonder externe requests", imageOptimization: "Placeholders als inline SVG" },
    basis: { sources: ["lead"] },
    missingInformation,
  });

  const contact: WebsiteContactContext = { phone, email, address, city, province };
  const trustedClaims = [businessName, industry, city, province, phone, email, address].filter((v): v is string => Boolean(v));
  return { specification, designPlan, contact, trustedClaims, missingInformation };
}

export interface GeneratedDemoPage {
  slug: string;
  html: string;
  sha256: string;
  sectionTypes: string[];
  notes: string[];
  missingInformation: string[];
  headline: string;
  description: string;
}

function demoBannerHtml(businessName: string): string {
  const name = businessName.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<div style="position:sticky;top:0;z-index:9999;background:#111827;color:#f9fafb;font:500 13px/1.4 system-ui,sans-serif;padding:8px 16px;text-align:center">Voorbeeldontwerp voor ${name} door Silvijn Studio. Teksten met “${DEMO_PLACEHOLDER_PREFIX}” zijn placeholders; dit is geen live website.</div>`;
}

/** Bouwt en rendert de één-pagina-demo. Puur: geen opslag, geen netwerk. */
export async function generateDemoPageForLead(lead: Lead): Promise<GeneratedDemoPage> {
  const inputs = buildDemoThemeInputs(lead);
  const built = buildShopifyTheme({ specification: inputs.specification, designPlan: inputs.designPlan, contact: inputs.contact });
  const validation = validateThemeFiles(built.files, { trustedClaims: inputs.trustedClaims });
  if (!validation.passed) {
    throw new DemoGenerationError("THEME_VALIDATION_FAILED", `Demo-thema faalde op validatie: ${validation.errors.slice(0, 3).join(" | ")}`);
  }
  const rendered = await renderThemePageHtml(built.files, { template: "index", bannerHtml: demoBannerHtml(inputs.specification.business.businessName) });
  const slug = slugifyBusinessName(lead.businessName);
  if (!slug) throw new DemoGenerationError("SLUG_INVALID", "Bedrijfsnaam levert geen geldige demo-slug.");
  return {
    slug,
    html: rendered.html,
    sha256: createHash("sha256").update(rendered.html, "utf8").digest("hex"),
    sectionTypes: rendered.sectionTypes,
    notes: [...built.notes, ...rendered.warnings.map((w) => `render: ${w}`)],
    missingInformation: inputs.missingInformation,
    headline: inputs.specification.content.headline,
    description: inputs.specification.seo.metaDescription,
  };
}
