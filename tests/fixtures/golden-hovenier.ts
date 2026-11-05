import { designPlanSchema } from "../../lib/websites/design-plan";
import { WebsiteSpecificationSchema } from "../../lib/ai/schemas";
import { websiteBlueprintSchema } from "../../lib/websites/blueprint/blueprint";
import type { WebsiteContactContext } from "../../lib/websites/generator";

/**
 * GOLDEN FIXTURE — VAN DIJK HOVENIERS (nulmeting, 2026-11-05)
 *
 * Bevroren input voor elke visuele vergelijking: dezelfde bedrijfsgegevens,
 * hetzelfde Design Plan en dezelfde contactcontext als de website die als
 * nulmeting is vastgelegd. Elke fase genereert opnieuw uit DEZE fixture,
 * zodat een verschil in de uitkomst een verschil in de engine is en niet in
 * de input.
 *
 * HARD: wijzig dit bestand niet om een fase mooier te laten lijken. Nieuwe
 * scenariocases horen in een eigen fixture.
 */

export const GOLDEN_BUSINESS_NAME = "Van Dijk Hoveniers";

const NAME = "Van Dijk Hoveniers";

export const goldenSpecification = WebsiteSpecificationSchema.parse({
  template: "home_improvement",
  business: { businessName: NAME, industry: "hovenier", city: "Utrecht", province: "Utrecht", description: null, targetAudience: null },
  branding: { primaryColor: "#3F5F4F", secondaryColor: "#2D4439", accentColor: "#C9A55A", backgroundStyle: null, typographyStyle: null, visualStyle: null },
  structure: {
    pages: [{ key: "home", title: "Home" }, { key: "over-ons", title: "Over ons" }, { key: "contact", title: "Contact" }],
    navigation: ["Home", "Over ons", "Contact"], sections: [],
  },
  content: {
    headline: "Een tuin die over tien jaar nog klopt",
    subheadline: "Ontwerp, aanleg en onderhoud door één team.",
    valueProposition: "Van eerste schets tot de laatste snoeironde.",
    services: [
      { title: "Tuinontwerp", description: "Een plan op schaal met beplanting die past bij grond, licht en gebruik." },
      { title: "Aanleg", description: "Bestrating, schuttingen en beplanting, uitgevoerd door vaste mensen." },
      { title: "Onderhoud", description: "Vast onderhoud per seizoen, zodat de tuin blijft zoals hij bedoeld is." },
      { title: "Beplanting", description: "Sortiment gekozen op bodem en standplaats." },
    ],
    about: "Wij zijn een hoveniersbedrijf uit Utrecht met een vast team van vier mensen.",
    benefits: ["Vaste mensen", "Plan op schaal", "Eén aanspreekpunt"],
    faq: [{ question: "Hoe lang duurt een aanleg?", answer: "Dat hangt af van de omvang; na de opname weten we dat." }],
    testimonials: [],
    contactIntro: "Vertel kort wat je zoekt.",
    ctaPrimaryText: "Plan een gesprek",
    ctaSecondaryText: null,
  },
  conversion: { primaryCta: "contact", secondaryCta: null, contactMethods: [], leadCapture: true },
  media: { imageRequirements: [], imageDescriptions: [], imagePlaceholders: [] },
  seo: { title: `${NAME} — hovenier in Utrecht`, metaDescription: "Ontwerp, aanleg en onderhoud van tuinen in Utrecht en omgeving.", keywords: [], localArea: "Utrecht" },
  missingInformation: [],
});

export const goldenDesignPlan = designPlanSchema.parse({
  goals: { primaryGoal: "Contact", secondaryGoals: [], conversionGoal: null },
  audience: { primaryAudience: "Particuliere tuineigenaren", secondaryAudiences: [], toneOfVoice: "nuchter" },
  navigation: {
    items: [
      { label: "Home", pageKey: "home" },
      { label: "Over ons", pageKey: "over-ons" },
      { label: "Diensten", pageKey: "diensten" },
      { label: "FAQ", pageKey: "faq" },
      { label: "Contact", pageKey: "contact" },
    ],
    structure: null,
  },
  pageStructure: [
    { key: "home", title: "Home", purpose: "Landingspagina", sections: ["hero", "services", "about", "cta"] },
    { key: "over-ons", title: "Over ons", purpose: "Vertrouwen", sections: ["about", "cta"] },
    { key: "diensten", title: "Diensten", purpose: "Uitleg van het aanbod", sections: ["services", "benefits", "cta"] },
    { key: "faq", title: "Veelgestelde vragen", purpose: "Twijfel wegnemen", sections: ["faq", "cta"] },
    { key: "contact", title: "Contact", purpose: "Conversie", sections: ["contact"] },
  ],
  visualHierarchy: { strategy: "editorial", aboveTheFold: ["hero"] },
  branding: { styleDirection: "editorial", mood: ["ambachtelijk"], existingBrandAssets: null, preferredColors: [], dislikedColors: [], restrictions: [] },
  typography: { pairing: "editorial_serif", scale: "expressive", weights: [], rationale: null },
  colors: { primary: "#3F5F4F", secondary: "#2D4439", accent: "#C9A55A", neutrals: [], usageGuidance: null },
  spacing: { scale: "spacious", density: "spacious" },
  components: [{ key: "hero", purpose: "Eerste indruk", notes: null }],
  ctaStrategy: { primary: "contact", secondary: null, placement: [], leadCapture: true },
  imagery: { style: "natural", requirements: [], placeholderStrategy: null },
  responsive: { mobile: null, tablet: null, desktop: null, breakpoints: [] },
  animation: { strategy: "subtle", allowed: [], restrictions: [] },
  functionality: { features: [], integrations: [] },
  accessibility: { contrast: "WCAG AA-contrast", focusAndKeyboard: "volledig", semantics: "semantische HTML", formsAndLabels: "labels en foutmeldingen", guidelines: [] },
  seoPerformance: { titleStrategy: "Titel met bedrijfsnaam en plaats", metaStrategy: "Unieke meta per pagina", localSeo: "LocalBusiness JSON-LD met Utrecht", performanceBudget: "Onder 100 KB CSS", imageOptimization: "WebP met srcset" },
  basis: { sources: ["requirements"] },
  visualContract: { fontPairing: "editorial_serif", paletteMood: "warm_organic", typographicCurve: "expressive", density: "spacious", motionLevel: "subtle" },
  artDirection: { concept: "Ambachtelijke hovenier: rust, materiaal en seizoenen centraal, met een editoriale typografie.", composition: "editorial", brandPersonality: "warm_friendly", headerStyle: "minimal", heroTreatment: "split", cardTreatment: "bordered", imageryBalance: "balanced", imageStyle: "framed", decorativeStyle: "none", sectionTransition: "hard_cut", motionStyle: "fade" },
  blueprint: websiteBlueprintSchema.parse({
    version: 2,
    pages: [
      { key: "home", title: "Home", purpose: "Landingspagina", seo: null, sectionInstances: [
        { type: "hero", layout: "split", blocks: [], media: [], cta: { label: "Plan een gesprek", target: "contact", prominence: "primary" }, background: "default", motion: "fade_up", contentHints: null },
        { type: "services", layout: "cards", blocks: [{ kind: "service", hint: "Tuinontwerp" }, { kind: "service", hint: "Aanleg" }, { kind: "service", hint: "Onderhoud" }, { kind: "service", hint: "Beplanting" }], media: [], cta: null, background: "surface", motion: "none", contentHints: null },
        { type: "about", layout: "split", blocks: [], media: [], cta: null, background: "default", motion: "none", contentHints: null },
        { type: "cta", layout: "band", blocks: [], media: [], cta: { label: "Neem contact op", target: "contact", prominence: "primary" }, background: "accent_band", motion: "none", contentHints: null },
      ]},
      { key: "over-ons", title: "Over ons", purpose: "Vertrouwen", seo: null, sectionInstances: [
        { type: "about", layout: "split", blocks: [], media: [], cta: null, background: "default", motion: "none", contentHints: null },
      ]},
      { key: "diensten", title: "Diensten", purpose: "Wat we doen, per dienst", seo: null, sectionInstances: [
        { type: "services", layout: "cards", blocks: [{ kind: "service", hint: "Tuinontwerp" }, { kind: "service", hint: "Aanleg" }, { kind: "service", hint: "Onderhoud" }, { kind: "service", hint: "Beplanting" }], media: [], cta: null, background: "default", motion: "none", contentHints: null },
        { type: "benefits", layout: "checklist", blocks: [{ kind: "benefit", hint: "Vaste ploeg" }, { kind: "benefit", hint: "Eigen materiaal" }, { kind: "benefit", hint: "Planmatig onderhoud" }], media: [], cta: null, background: "surface", motion: "none", contentHints: null },
        { type: "cta", layout: "band", blocks: [], media: [], cta: { label: "Vraag een tuinplan aan", target: "contact", prominence: "primary" }, background: "accent_band", motion: "none", contentHints: null },
      ]},
      { key: "faq", title: "Veelgestelde vragen", purpose: "Antwoorden op de vragen die klanten het vaakst stellen", seo: null, sectionInstances: [
        { type: "faq", layout: "accordion", blocks: [{ kind: "faq", hint: "Wat kost een tuinontwerp?" }, { kind: "faq", hint: "Werken jullie in heel Utrecht?" }, { kind: "faq", hint: "Hoe lang duurt een aanleg?" }], media: [], cta: null, background: "default", motion: "none", contentHints: null },
        { type: "cta", layout: "band", blocks: [], media: [], cta: { label: "Stel je vraag", target: "contact", prominence: "primary" }, background: "surface", motion: "none", contentHints: null },
      ]},
      { key: "contact", title: "Contact", purpose: "Conversie", seo: null, sectionInstances: [
        { type: "contact", layout: "split", blocks: [], media: [], cta: null, background: "default", motion: "none", contentHints: null },
      ]},
    ],
    trustElements: { usps: [{ label: "Vaste mensen", source: "requirements" }], stats: [], badges: [] },
    conversionPlan: { primaryGoal: "Contact", leadCapture: true, contactPreference: "form" },
    missingInformation: [],
  }),
  missingInformation: [],
});

export const goldenContact: WebsiteContactContext = {
  email: "info@vandijkhoveniers.nl",
  phone: "030 000 00 00",
  city: "Utrecht",
  province: "Utrecht",
  address: null,
};

/** Template → bestandsnaam van de gerenderde pagina. */
export const GOLDEN_PAGES = [
  { template: "index", slug: "home" },
  { template: "page.over-ons", slug: "over-ons" },
  { template: "page.diensten", slug: "diensten" },
  { template: "page.faq", slug: "faq" },
  { template: "page.contact", slug: "contact" },
] as const;
