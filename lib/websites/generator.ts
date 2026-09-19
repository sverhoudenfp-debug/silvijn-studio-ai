import { getWebsiteTemplateConfig } from "./templates";
import type { GeneratedSectionData, GeneratedWebsiteContent, WebsiteSpecification, WebsiteTemplateType } from "./types";

/**
 * Deterministische website-generator (Fase 9) met provider-abstraction.
 *
 * KERNPRINCIPE: de AI levert alléén de (Zod-gevalideerde) WebsiteSpecification.
 * Deze generator vertaalt die deterministisch naar gestructureerde section-data
 * die door VOORAF GECONTROLEERDE React-componenten wordt gerenderd.
 * Er wordt nooit AI-code uitgevoerd en er wordt nooit vrije code gegenereerd.
 *
 * Providers: NextJsWebsiteGenerator en ShopifyWebsiteGenerator (beide
 * geïmplementeerd; Fase I.2) — de service kiest via deze interface.
 */

/** Echte contactgegevens — door de GENERATOR zelf ingevoegd (nooit door de AI ge-echo'd). */
export interface WebsiteContactContext {
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string;
  province: string | null;
}

export interface WebsiteGeneratorResult {
  framework: "nextjs" | "shopify";
  content: GeneratedWebsiteContent;
  notes: string[];
}

export interface WebsiteGeneratorProvider {
  readonly framework: "nextjs" | "shopify";
  /** Genereert gestructureerde content uit een gevalideerde specification. */
  generate(specification: WebsiteSpecification, contact: WebsiteContactContext): WebsiteGeneratorResult;
}

export class WebsiteGenerationNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebsiteGenerationNotSupportedError";
  }
}

function buildWebsiteSections(
  specification: WebsiteSpecification,
  contact: WebsiteContactContext
): { sections: GeneratedSectionData[]; notes: string[] } {
  const templateConfig = getWebsiteTemplateConfig(specification.template);
  const notes: string[] = [];
  const sections: GeneratedSectionData[] = [];

  // 1) Header — navigatie + bedrijfsnaam
  sections.push({
    type: "header",
    data: {
      businessName: specification.business.businessName,
      navigation: specification.structure.navigation.length > 0 ? specification.structure.navigation : ["Home", "Diensten", "Contact"],
      phone: contact.phone,
      ctaText: specification.content.ctaPrimaryText,
    },
  });

  // 2) Hero — headline/subheadline + CTA + placeholder-beeld
  sections.push({
    type: "hero",
    data: {
      headline: specification.content.headline,
      subheadline: specification.content.subheadline,
      valueProposition: specification.content.valueProposition,
      ctaPrimary: specification.content.ctaPrimaryText,
      ctaSecondary: specification.content.ctaSecondaryText,
      city: specification.business.city,
      province: specification.business.province,
      imagePlaceholder:
        specification.media.imageRequirements.find((req) => req.key === "hero")?.description ?? null,
      gradient: templateConfig.hero,
      accent: templateConfig.accent,
    },
  });

  // 3) Content-sections in de template-volgorde
  for (const section of templateConfig.sectionOrder) {
    switch (section) {
      case "services":
        if (specification.content.services.length > 0) {
          sections.push({
            type: "services",
            data: {
              services: specification.content.services,
              accent: templateConfig.accent,
            },
          });
        }
        break;
      case "about":
        sections.push({
          type: "about",
          data: {
            about: specification.content.about,
            targetAudience: specification.business.targetAudience,
            benefits: specification.content.benefits,
            industry: specification.business.industry,
            city: specification.business.city,
          },
        });
        break;
      case "benefits":
        if (specification.content.benefits.length > 0) {
          sections.push({
            type: "benefits",
            data: {
              benefits: specification.content.benefits,
              accent: templateConfig.accent,
            },
          });
        }
        break;
      case "faq":
        if (specification.content.faq.length > 0) {
          sections.push({
            type: "faq",
            data: { items: specification.content.faq },
          });
        }
        break;
      case "cta":
        sections.push({
          type: "cta",
          data: {
            headline: specification.content.ctaPrimaryText,
            secondary: specification.content.ctaSecondaryText,
            leadCapture: specification.conversion.leadCapture,
            accent: templateConfig.accent,
          },
        });
        break;
      default:
        break;
    }
  }

  // 4) Contact — echte gegevens komen DETERMINISTISCH uit de lead-context.
  //    Eerlijk over wat de bezoeker ziet: het formulier hangt aan
  //    conversion.leadCapture (productiebug 2026-09-19: de note claimde een
  //    formulier dat er bij leadCapture=false niet is).
  if (!contact.phone && !contact.email) {
    notes.push(
      specification.conversion.leadCapture
        ? "Geen echte contactgegevens bekend — de contactsectie toont alleen het contactformulier."
        : "Geen echte contactgegevens bekend en lead-capture staat uit — de contactsectie toont géén contactformulier."
    );
  }
  sections.push({
    type: "contact",
    data: {
      intro: specification.content.contactIntro,
      phone: contact.phone,
      email: contact.email,
      address: contact.address,
      city: contact.city,
      province: contact.province,
      methods: specification.conversion.contactMethods,
      leadCapture: specification.conversion.leadCapture,
    },
  });

  // 5) Footer
  sections.push({
    type: "footer",
    data: {
      businessName: specification.business.businessName,
      city: specification.business.city,
      phone: contact.phone,
      email: contact.email,
      seoLocalArea: specification.seo.localArea,
    },
  });

  if (specification.missingInformation.length > 0) {
    notes.push(`${specification.missingInformation.length} ontbrekende informatiepunten doorgegeven aan QC (geen content verzonnen).`);
  }

  return { sections, notes };
}

/**
 * Next.js-provider (Fase 9): vertaalt de specification deterministisch naar
 * gestructureerde section-data voor de interne React-preview.
 */
export class NextJsWebsiteGenerator implements WebsiteGeneratorProvider {
  readonly framework = "nextjs" as const;

  generate(specification: WebsiteSpecification, contact: WebsiteContactContext): WebsiteGeneratorResult {
    const { sections, notes } = buildWebsiteSections(specification, contact);
    const templateConfig = getWebsiteTemplateConfig(specification.template);
    const content: GeneratedWebsiteContent = {
      template: specification.template,
      branding: specification.branding,
      sections,
      seo: specification.seo,
      missingInformation: specification.missingInformation,
    };
    notes.unshift(
      `Website gegenereerd via ${templateConfig.name}-template met ${sections.length} gecontroleerde componenten (framework: Next.js/React).`
    );
    return { framework: "nextjs", content, notes };
  }
}

/**
 * Shopify-provider (Fase I.2): levert dezelfde deterministische section-data
 * (de bron voor QC + interne preview) én markeert dat de echte productie-
 * output het theme-ZIP is (lib/websites/theme-zip), dat na de build uit de
 * WebsiteSpecification + Design Plan wordt gebouwd.
 */
export class ShopifyWebsiteGenerator implements WebsiteGeneratorProvider {
  readonly framework = "shopify" as const;

  generate(specification: WebsiteSpecification, contact: WebsiteContactContext): WebsiteGeneratorResult {
    const { sections, notes } = buildWebsiteSections(specification, contact);
    const templateConfig = getWebsiteTemplateConfig(specification.template);
    const content: GeneratedWebsiteContent = {
      template: specification.template,
      branding: specification.branding,
      sections,
      seo: specification.seo,
      missingInformation: specification.missingInformation,
    };
    notes.unshift(
      `Website gegenereerd via ${templateConfig.name}-template met ${sections.length} gecontroleerde componenten (framework: Shopify — theme-ZIP volgt na de build).`
    );
    return { framework: "shopify", content, notes };
  }
}

export function getWebsiteGeneratorProvider(framework: "nextjs" | "shopify"): WebsiteGeneratorProvider {
  return framework === "shopify" ? new ShopifyWebsiteGenerator() : new NextJsWebsiteGenerator();
}

/** Template-type helper voor externe consumers. */
export type { WebsiteTemplateType };
