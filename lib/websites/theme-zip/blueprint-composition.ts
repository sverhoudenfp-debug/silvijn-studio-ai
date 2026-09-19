import type { WebsiteBlueprint, BlueprintPage, BlueprintSectionInstance } from "../blueprint/blueprint";
import type { BlueprintSectionType } from "../blueprint/section-registry";
import type { WebsiteSpecification } from "../types";
import type { WebsiteContactContext } from "../generator";

/**
 * BLUEPRINT-COMPOSITIE (Fase C, 2026-09-19) — de deterministische vertaling
 * van blueprint.pages[].sectionInstances naar Shopify JSON-templates.
 *
 * ARCHITECTUUR:
 * - Uitsluitend sectietypes/layouts/blokken uit de gesloten SECTION-REGISTRY;
 *   het blueprint is al Zod- + consistency-gevalideerd vóór deze vertaling.
 * - De volgorde van sectionInstances is heilig: template "order" volgt exact
 *   de blueprint-volgorde; er worden GEEN ongeplande secties toegevoegd.
 * - Content komt uitsluitend uit de gevalideerde WebsiteSpecification en de
 *   blueprint-trustElements (bron-verplicht): de compositie verzint NIETS.
 *   Secties zonder echte databron krijgen lege, bewerkbare blokken voor de
 *   merchant (de content-pass vult later echte copy onder het
 *   fabricatie-contract).
 * - Elke instantie zet zijn layoutvariant, achtergrond en motion als
 *   section-settings: de varianten zijn daadwerkelijk zichtbaar in Shopify
 *   (klasse per layout in theme.css, geen AI-CSS).
 * - Deterministisch: dezelfde input levert byte-identieke templates.
 */

/** Homepage-aliaskeys (gespiegeld aan blueprint.ts — dezelfde set). */
const HOME_KEYS = new Set(["home", "index", "start", "homepage"]);

/**
 * Blueprint-sectietype → Shopify-sectiebestand (zonder .liquid).
 * Registry-key's zijn snake_case; Shopify-conventie voor bestandsnamen is
 * kebab-case. Dit is de ÉÉN vertaaltabel tussen beide werelden.
 */
const SECTION_FILE_NAMES: Record<BlueprintSectionType, string> = {
  hero: "hero",
  usp_band: "usp-band",
  stats: "stats",
  services: "services",
  about: "about",
  process: "process",
  gallery: "gallery",
  projects: "projects",
  testimonials: "testimonials",
  team: "team",
  benefits: "benefits",
  faq: "faq",
  rates: "rates",
  newsletter: "newsletter",
  booking: "booking",
  cta: "cta",
  contact: "contact",
  rich_text: "rich-text",
};

export function shopifySectionType(type: BlueprintSectionType): string {
  return SECTION_FILE_NAMES[type];
}

/**
 * Deterministische paginaslug — identiek aan de slugifyKey in de theme-builder
 * (legacy subpagina's en blueprint-subpagina's moeten dezelfde slug krijgen).
 */
export function slugifyPageKey(key: string): string {
  const cleaned = key
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "pagina";
}

export interface ComposedTemplate {
  /** ZIP-pad, bijv. "templates/index.json". */
  path: string;
  /** Parsed JSON-data (niet geserialiseerd; jsonFile() doet dat). */
  data: unknown;
}

export interface BlueprintCompositionResult {
  templates: ComposedTemplate[];
  notes: string[];
}

interface CompositionContext {
  spec: WebsiteSpecification;
  contact: WebsiteContactContext;
  trust: WebsiteBlueprint["trustElements"];
  pageKeyToSlug: Map<string, string>;
  contactPageSlug: string | null;
}

function isHomeKey(key: string): boolean {
  return HOME_KEYS.has(key.trim().toLowerCase());
}

function resolveCtaTarget(target: string, ctx: CompositionContext): string {
  if (isHomeKey(target)) return "/";
  const slug = ctx.pageKeyToSlug.get(target);
  if (slug !== undefined) return slug === "" ? "/" : `/pages/${slug}`;
  if (target === "form") return ctx.contactPageSlug ? `/pages/${ctx.contactPageSlug}` : "#contact";
  // '#anker', mailto:, tel:, /pad en http(s)-URL's gaan ongewijzigd door
  // (uitvoerbaarheid is al bewezen door validateBlueprintConsistency).
  return target;
}

/** Altijd aanwezige variant-settings op elke blueprint-instantie. */
function variantSettings(instance: BlueprintSectionInstance, backgroundDefault: string): Record<string, unknown> {
  return {
    layout: instance.layout,
    background: instance.background || backgroundDefault,
    motion: instance.motion || "none",
  };
}

/**
 * Instantie → Shopify-template-sectie-entry (settings + blocks + block_order).
 * Volledig deterministisch: geen AI, geen toeval, geen ongeplande secties.
 */
function instanceToSectionEntry(
  instance: BlueprintSectionInstance,
  ctx: CompositionContext
): { type: string; settings: Record<string, unknown>; blocks?: Record<string, Record<string, unknown>>; block_order?: string[] } {
  const { spec, contact } = ctx;
  const ctaLink = instance.cta ? resolveCtaTarget(instance.cta.target, ctx) : null;

  switch (instance.type) {
    case "hero": {
      const firstMedia = instance.media[0] ?? null;
      return {
        type: SECTION_FILE_NAMES.hero,
        settings: {
          ...variantSettings(instance, "default"),
          eyebrow: spec.seo.localArea ?? `${spec.business.industry} in ${spec.business.city}`,
          heading: spec.content.headline,
          subheading: spec.content.subheadline ?? spec.content.valueProposition,
          cta_label: instance.cta?.label ?? spec.content.ctaPrimaryText,
          cta_link: ctaLink ?? "/pages/contact",
          cta_secondary_label: spec.content.ctaSecondaryText,
          cta_secondary_link: "#main-content",
          image_alt: firstMedia?.alt ?? null,
        },
      };
    }
    case "usp_band": {
      // Echte USP's alléén: trustElements.usps hebben een verplichte bron
      // (requirements|questionnaire|lead_notes). Geen USP's = lege,
      // bewerkbare blokken; nooit verzonnen argumenten.
      const usps = ctx.trust.usps;
      const planned = instance.blocks.length;
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      const count = Math.max(usps.length, planned);
      for (let i = 0; i < count; i += 1) {
        const key = `usp-${i + 1}`;
        blocks[key] = { type: "usp", settings: { label: usps[i]?.label ?? null, description: null } };
        order.push(key);
      }
      return {
        type: SECTION_FILE_NAMES.usp_band,
        settings: { ...variantSettings(instance, "surface"), heading: "Waarom klanten voor ons kiezen" },
        blocks,
        block_order: order,
      };
    }
    case "stats": {
      // Echte cijfers alléén uit trustElements.stats (bron-verplicht);
      // de registry verbiedt expliciet het verzinnen van statistieken.
      const stats = ctx.trust.stats;
      const planned = instance.blocks.length;
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      const count = Math.max(stats.length, planned);
      for (let i = 0; i < count; i += 1) {
        const key = `stat-${i + 1}`;
        blocks[key] = { type: "stat", settings: { label: stats[i]?.label ?? null, value: stats[i]?.value ?? null } };
        order.push(key);
      }
      return {
        type: SECTION_FILE_NAMES.stats,
        settings: { ...variantSettings(instance, "surface"), heading: "In cijfers" },
        blocks,
        block_order: order,
      };
    }
    case "services": {
      const services = spec.content.services;
      const planned = instance.blocks.length;
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      const count = Math.max(services.length, planned);
      for (let i = 0; i < count; i += 1) {
        const key = `service-${i + 1}`;
        const source = services[i] ?? null;
        blocks[key] = {
          type: "service",
          settings: { title: source?.title ?? null, description: source?.description ?? null },
        };
        order.push(key);
      }
      return {
        type: SECTION_FILE_NAMES.services,
        settings: { ...variantSettings(instance, "default"), heading: "Onze diensten", subheading: null },
        blocks,
        block_order: order,
      };
    }
    case "about": {
      const firstMedia = instance.media[0] ?? null;
      return {
        type: SECTION_FILE_NAMES.about,
        settings: {
          ...variantSettings(instance, "surface"),
          heading: `Over ${spec.business.businessName}`,
          body: spec.content.about ? `<p>${escapeHtml(spec.content.about)}</p>` : null,
          image_position: "right",
          image_alt: firstMedia?.alt ?? null,
        },
      };
    }
    case "process": {
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      instance.blocks.forEach((_, i) => {
        const key = `step-${i + 1}`;
        blocks[key] = { type: "step", settings: { title: null, description: null } };
        order.push(key);
      });
      return {
        type: SECTION_FILE_NAMES.process,
        settings: { ...variantSettings(instance, "default"), heading: "Zo werken wij" },
        blocks,
        block_order: order,
      };
    }
    case "gallery": {
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      instance.blocks.forEach((block, i) => {
        const key = `image-${i + 1}`;
        blocks[key] = {
          type: "gallery_image",
          settings: { caption: null, alt: instance.media[i]?.alt ?? block.hint ?? null },
        };
        order.push(key);
      });
      return {
        type: SECTION_FILE_NAMES.gallery,
        settings: { ...variantSettings(instance, "default"), heading: "Impressie", subheading: null },
        blocks,
        block_order: order,
      };
    }
    case "projects": {
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      instance.blocks.forEach((_, i) => {
        const key = `project-${i + 1}`;
        blocks[key] = { type: "project", settings: { title: null, description: null } };
        order.push(key);
      });
      return {
        type: SECTION_FILE_NAMES.projects,
        settings: { ...variantSettings(instance, "default"), heading: "Ons werk" },
        blocks,
        block_order: order,
      };
    }
    case "testimonials": {
      // Echte uitspraken alléén (content.testimonials); auteur blijft leeg.
      const quotes = spec.content.testimonials.filter((q) => q.trim().length > 0);
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      quotes.forEach((quote, i) => {
        const key = `testimonial-${i + 1}`;
        blocks[key] = { type: "testimonial", settings: { quote, author: null } };
        order.push(key);
      });
      return {
        type: SECTION_FILE_NAMES.testimonials,
        settings: { ...variantSettings(instance, "surface"), heading: "Wat klanten zeggen" },
        ...(order.length > 0 ? { blocks, block_order: order } : {}),
      };
    }
    case "team": {
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      instance.blocks.forEach((_, i) => {
        const key = `member-${i + 1}`;
        blocks[key] = { type: "member", settings: { name: null, role: null } };
        order.push(key);
      });
      return {
        type: SECTION_FILE_NAMES.team,
        settings: { ...variantSettings(instance, "default"), heading: "Ons team" },
        blocks,
        block_order: order,
      };
    }
    case "benefits": {
      const benefits = spec.content.benefits;
      const planned = instance.blocks.length;
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      const count = Math.max(benefits.length, planned);
      for (let i = 0; i < count; i += 1) {
        const key = `benefit-${i + 1}`;
        blocks[key] = { type: "benefit", settings: { text: benefits[i] ?? null } };
        order.push(key);
      }
      return {
        type: SECTION_FILE_NAMES.benefits,
        settings: { ...variantSettings(instance, "default"), heading: "Waarom klanten voor ons kiezen" },
        blocks,
        block_order: order,
      };
    }
    case "faq": {
      const faq = spec.content.faq;
      const planned = instance.blocks.length;
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      const count = Math.max(faq.length, planned);
      for (let i = 0; i < count; i += 1) {
        const key = `question-${i + 1}`;
        const source = faq[i] ?? null;
        blocks[key] = {
          type: "question",
          settings: {
            question: source?.question ?? null,
            answer: source ? `<p>${escapeHtml(source.answer)}</p>` : null,
          },
        };
        order.push(key);
      }
      return {
        type: SECTION_FILE_NAMES.faq,
        settings: { ...variantSettings(instance, "surface"), heading: "Veelgestelde vragen" },
        blocks,
        block_order: order,
      };
    }
    case "rates": {
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      instance.blocks.forEach((_, i) => {
        const key = `rate-${i + 1}`;
        blocks[key] = { type: "rate_item", settings: { service: null, price: null } };
        order.push(key);
      });
      return {
        type: SECTION_FILE_NAMES.rates,
        settings: { ...variantSettings(instance, "default"), heading: "Tarieven" },
        blocks,
        block_order: order,
      };
    }
    case "newsletter": {
      return {
        type: SECTION_FILE_NAMES.newsletter,
        settings: {
          ...variantSettings(instance, "surface"),
          heading: "Blijf op de hoogte",
          subheading: null,
        },
      };
    }
    case "booking": {
      return {
        type: SECTION_FILE_NAMES.booking,
        settings: {
          ...variantSettings(instance, "default"),
          heading: instance.cta?.label ?? "Maak een afspraak",
          subheading: spec.content.contactIntro,
          cta_label: instance.cta?.label ?? spec.content.ctaPrimaryText,
          cta_link: ctaLink ?? (ctx.contactPageSlug ? `/pages/${ctx.contactPageSlug}` : "#contact"),
        },
      };
    }
    case "cta": {
      return {
        type: SECTION_FILE_NAMES.cta,
        settings: {
          ...variantSettings(instance, "default"),
          heading: instance.cta?.label ?? spec.content.ctaPrimaryText,
          subheading: spec.content.contactIntro,
          cta_label: instance.cta?.label ?? spec.content.ctaPrimaryText,
          cta_link: ctaLink ?? "/pages/contact",
        },
      };
    }
    case "contact": {
      // DETERMINISTIEKE injectie van échte contactgegevens (registry-belofte):
      // nooit AI-verzonnen; show_form volgt de layoutvariant (minimal = geen).
      return {
        type: SECTION_FILE_NAMES.contact,
        settings: {
          ...variantSettings(instance, "surface"),
          heading: "Contact",
          intro: spec.content.contactIntro,
          phone: contact.phone,
          email: contact.email,
          address: [contact.address, contact.city].filter(Boolean).join(", ") || null,
          show_form: instance.layout !== "minimal",
        },
      };
    }
    case "rich_text": {
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      instance.blocks.forEach((_, i) => {
        const key = `paragraph-${i + 1}`;
        blocks[key] = { type: "paragraph", settings: { body: null } };
        order.push(key);
      });
      return {
        type: SECTION_FILE_NAMES.rich_text,
        settings: { ...variantSettings(instance, "default") },
        ...(order.length > 0 ? { blocks, block_order: order } : {}),
      };
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Één blueprint-pagina → Shopify JSON-template (sections + order). */
function composePage(page: BlueprintPage, ctx: CompositionContext): ComposedTemplate {
  const isHome = isHomeKey(page.key);
  // Slug komt uit de context-map: die is al deterministisch gedupliceerd
  // (één bron van waarheid; CTA-resolutie en template-pad delen dezelfde slug).
  const slug = ctx.pageKeyToSlug.get(page.key) ?? "";

  const sections: Record<string, Record<string, unknown>> = {};
  const order: string[] = [];
  const typeCounters = new Map<string, number>();

  for (const instance of page.sectionInstances) {
    const entry = instanceToSectionEntry(instance, ctx);
    const n = (typeCounters.get(entry.type) ?? 0) + 1;
    typeCounters.set(entry.type, n);
    const key = n === 1 ? entry.type : `${entry.type}_${n}`;
    sections[key] = entry as unknown as Record<string, unknown>;
    order.push(key);
  }

  return {
    path: isHome ? "templates/index.json" : `templates/page.${slug}.json`,
    data: { sections, order },
  };
}

/**
 * Volledige blueprint → alle pagina-templates. Homepage én subpagina's komen
 * allebei uit het blueprint; de volgorde en sectiekeuze zijn exact.
 */
export function composeBlueprintTemplates(input: {
  blueprint: WebsiteBlueprint;
  spec: WebsiteSpecification;
  contact: WebsiteContactContext;
}): BlueprintCompositionResult {
  const { blueprint, spec, contact } = input;
  const notes: string[] = [];

  // Paginaslug-map voor CTA-resolutie (home → "/").
  const pageKeyToSlug = new Map<string, string>();
  const usedSlugs = new Set<string>();
  for (const page of blueprint.pages) {
    if (isHomeKey(page.key)) {
      pageKeyToSlug.set(page.key, "");
      continue;
    }
    const base = slugifyPageKey(page.key);
    let candidate = base;
    let n = 2;
    while (usedSlugs.has(candidate)) {
      candidate = `${base}-${n}`;
      n += 1;
    }
    usedSlugs.add(candidate);
    pageKeyToSlug.set(page.key, candidate);
  }

  // Contactpagina-resolutie voor "form"-doelen: de eerste niet-home pagina
  // met een contact-instantie, anders een pagina met key "contact".
  let contactPageSlug: string | null = null;
  for (const page of blueprint.pages) {
    if (isHomeKey(page.key)) continue;
    if (page.sectionInstances.some((s) => s.type === "contact")) {
      contactPageSlug = pageKeyToSlug.get(page.key) ?? null;
      break;
    }
  }
  if (contactPageSlug === null && pageKeyToSlug.has("contact")) {
    contactPageSlug = pageKeyToSlug.get("contact") ?? null;
  }

  const ctx: CompositionContext = { spec, contact, trust: blueprint.trustElements, pageKeyToSlug, contactPageSlug };
  const templates: ComposedTemplate[] = [];
  for (const page of blueprint.pages) {
    templates.push(composePage(page, ctx));
  }

  // Notities (eerlijk, deterministisch — voor ZIP-rapportage/QC-inzage).
  notes.push(
    `Blueprint-compositie: ${templates.length} pagina-template(s) uitsluitend uit het machine-blueprint opgebouwd (types/layouts uit de SECTION-REGISTRY; volgorde exact; geen ongeplande secties).`
  );
  if (contactPageSlug !== null) {
    notes.push(`CTA-doelen naar "form" verwijzen deterministisch naar de contactpagina /pages/${contactPageSlug}.`);
  }
  const trust = blueprint.trustElements;
  if (trust.usps.length === 0 && trust.stats.length === 0 && trust.badges.length === 0) {
    notes.push("Geen trust-elements in het blueprint (geen echte USP's/cijfers bekend) — trust-secties ontbreken daardoor, niets verzonnen.");
  }

  return { templates, notes };
}
