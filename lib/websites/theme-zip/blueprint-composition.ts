import type { WebsiteBlueprint, BlueprintPage, BlueprintSectionInstance } from "../blueprint/blueprint";
import type { BlueprintSectionType } from "../blueprint/section-registry";
import type { WebsiteSpecification } from "../types";
import type { WebsiteContactContext } from "../generator";
import type { ContentPlan, ContentUnit } from "../content/content-plan";
import type { ContentUnitKind } from "../content/content-slots";
import {
  buildContentPlanIndex,
  resolveSlotText,
  resolveBlockTexts,
  unitRenderText,
  type PageContentIndex,
} from "../content/content-plan-consumption";

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
  /** Sectieritme: aantal secties dat deterministisch een contrastvlak kreeg. */
  rhythmAdjustments: number;
}

export interface CompositionNavigationItem {
  label: string;
  /** URL zoals die in het thema komt: "/" of "/pages/<slug>". */
  url: string;
  /** Blueprint-pagina waar dit item naar verwijst (nooit een niet-bestaande). */
  pageKey: string;
}

export interface ComposedSitePage {
  key: string;
  title: string;
  slug: string;
  /** Templatepad in het thema. */
  template: string;
  /** URL-pad dat de bezoeker ziet. */
  url: string;
  sectionCount: number;
}

export interface BlueprintCompositionResult {
  templates: ComposedTemplate[];
  notes: string[];
  /** Alle gegenereerde pagina's (één bron van waarheid voor nav en links). */
  pages: ComposedSitePage[];
  /** Navigatie die uitsluitend naar gegenereerde pagina's verwijst. */
  navigation: CompositionNavigationItem[];
}

/**
 * C3d: ContentPlan-units die per sectietype daadwerkelijk naar een
 * instantie-setting of blok-setting vertalen. Soorten die hier NIET in
 * staan (bijv. contact microcopy: themabreed via locales) worden eerlijk
 * als niet-instantieerbaar genoteerd — nooit stil weggegooid.
 */
const RENDERABLE_UNIT_KINDS: Record<BlueprintSectionType, ReadonlySet<string>> = {
  hero: new Set(["headline", "subheadline", "cta_label", "cta_secondary_label"]),
  usp_band: new Set(["item_label", "item_hint"]),
  stats: new Set(["stat_label", "stat_value"]),
  services: new Set(["item_title", "item_body"]),
  about: new Set(["heading", "body", "alt_text"]),
  process: new Set(["step_title", "step_body"]),
  gallery: new Set(["caption", "alt_text"]),
  projects: new Set(["item_title", "item_body"]),
  testimonials: new Set(["quote", "quote_author"]),
  team: new Set(["member_name", "member_role"]),
  benefits: new Set(["item_text"]),
  faq: new Set(["faq_question", "faq_answer"]),
  rates: new Set(["item_title", "rate_value"]),
  newsletter: new Set(["heading", "body", "cta_label"]),
  booking: new Set(["heading", "subheading", "cta_label"]),
  cta: new Set(["cta_label", "body"]),
  contact: new Set(["heading", "subheading"]),
  rich_text: new Set(["heading", "body"]),
};

/** C3d: klassificatie van één instantie-pad voor de rapportage. */
interface ContentApplicationLog {
  appliedPaths: Set<string>;
  appliedCount: number;
  fixedCount: number;
  customerSlots: string[];
  merchantSlots: string[];
  unrenderable: string[];
  skippedPaths: string[];
  /** W5: aantal dubbele blokken dat deterministisch is verwijderd. */
  duplicateBlocksRemoved?: number;
}

interface CompositionContext {
  spec: WebsiteSpecification;
  contact: WebsiteContactContext;
  trust: WebsiteBlueprint["trustElements"];
  pageKeyToSlug: Map<string, string>;
  contactPageSlug: string | null;
  /** Pagina die nu gecomponeerd wordt (bepaalt de hero-fallback). */
  currentPageKey?: string;
  currentPageTitle?: string | null;
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
    ...(instance.composition ? { composition: instance.composition.variant, composition_density: instance.composition.density } : {}),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Richtext-wrap: één tekstregel → één alinea. */
function paragraphHtml(value: string | null): string | null {
  return value != null && value.trim().length > 0 ? `<p>${escapeHtml(value)}</p>` : null;
}

/**
 * Instantie → Shopify-template-sectie-entry (settings + blocks + block_order).
 * Volledig deterministisch: geen AI, geen toeval, geen ongeplande secties.
 *
 * C3d: wanneer een ContentPlan-unit bestaat voor exact dit pad
 * ("<pageKey>/<sectionIndex>") is de unit authoritatief voor zijn slot:
 * - generated/fixed → de unit-tekst (evidence-gedragen c.q. verbatim);
 * - customer_slot/merchant_slot → null (bewust leeg, invulbaar voor
 *   klant/merchant — nooit als verzonnen tekst weergegeven);
 * - géén unit → de bestaande specification-flow (legacy, byte-identiek).
 * De blueprint-architectuur (types, volgorde, layouts, CTA-doelen) blijft
 * onverkort leidend; content vult alléén de bestaande slots.
 */
function instanceToSectionEntry(
  instance: BlueprintSectionInstance,
  ctx: CompositionContext,
  units: ReadonlyMap<ContentUnitKind, readonly ContentUnit[]> | null
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
          // W3-LES (Veld & Vorm, 2026-11-05): viel de paginakop weg (bijv. omdat
          // de G-poort hem nog tegenhoudt), dan viel de subpagina terug op de
          // HOMEPAGE-kop. Daardoor hadden diensten/faq/contact exact dezelfde
          // H1 als home. De fallback is nu de paginatitel zelf; alleen de
          // homepage gebruikt de specificatiekop.
          heading: resolveSlotText(
            units,
            "headline",
            ctx.currentPageKey && !isHomeKey(ctx.currentPageKey)
              ? ctx.currentPageTitle ?? spec.content.headline
              : spec.content.headline
          ),
          subheading: resolveSlotText(units, "subheadline", spec.content.subheadline ?? spec.content.valueProposition),
          cta_label: resolveSlotText(units, "cta_label", instance.cta?.label ?? spec.content.ctaPrimaryText),
          cta_link: ctaLink ?? "/pages/contact",
          cta_secondary_label: resolveSlotText(units, "cta_secondary_label", spec.content.ctaSecondaryText),
          image_alt: firstMedia?.alt ?? (firstMedia ? `Sfeerbeeld bij ${spec.business.businessName}` : null),
        },
      };
    }
    case "usp_band": {
      // Echte USP's alléén: trustElements.usps hebben een verplichte bron
      // (requirements|questionnaire|lead_notes). Geen USP's = lege,
      // bewerkbare blokken; nooit verzonnen argumenten. C3d: fact-locked
      // item_label/item_hint-units zijn verbatim authoritatief.
      const usps = ctx.trust.usps;
      const planned = instance.blocks.length;
      const labels = resolveBlockTexts(units, "item_label", planned, usps.map((u) => u.label));
      const hints = resolveBlockTexts(units, "item_hint", planned, usps.map(() => null));
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      const count = Math.max(planned, labels.length, hints.length);
      for (let i = 0; i < count; i += 1) {
        const key = `usp_${i + 1}`;
        blocks[key] = { type: "usp", settings: { label: labels[i] ?? null, description: hints[i] ?? null } };
        order.push(key);
      }
      return {
        type: SECTION_FILE_NAMES.usp_band,
        settings: { ...variantSettings(instance, "surface") },
        blocks,
        block_order: order,
      };
    }
    case "stats": {
      // Echte cijfers alléén uit trustElements.stats (bron-verplicht);
      // de registry verbiedt expliciet het verzinnen van statistieken.
      const stats = ctx.trust.stats;
      const planned = instance.blocks.length;
      const labels = resolveBlockTexts(units, "stat_label", planned, stats.map((s) => s.label));
      const values = resolveBlockTexts(units, "stat_value", planned, stats.map((s) => s.value));
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      const count = Math.max(planned, labels.length, values.length);
      for (let i = 0; i < count; i += 1) {
        const key = `stat_${i + 1}`;
        blocks[key] = { type: "stat", settings: { label: labels[i] ?? null, value: values[i] ?? null } };
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
      const titles = resolveBlockTexts(units, "item_title", planned, services.map((s) => s.title));
      const bodies = resolveBlockTexts(units, "item_body", planned, services.map((s) => s.description));
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      const count = Math.max(planned, titles.length, bodies.length);
      for (let i = 0; i < count; i += 1) {
        const key = `service_${i + 1}`;
        blocks[key] = {
          type: "service",
          settings: { title: titles[i] ?? null, description: bodies[i] ?? null },
        };
        order.push(key);
      }
      return {
        type: SECTION_FILE_NAMES.services,
        settings: {
          ...variantSettings(instance, "default"),
          heading: resolveSlotText(units, "heading", "Onze diensten"),
          subheading: resolveSlotText(units, "subheading", null),
        },
        blocks,
        block_order: order,
      };
    }
    case "about": {
      const firstMedia = instance.media[0] ?? null;
      const bodyRaw = resolveSlotText(units, "body", spec.content.about ?? null);
      return {
        type: SECTION_FILE_NAMES.about,
        settings: {
          ...variantSettings(instance, "surface"),
          heading: resolveSlotText(units, "heading", `Over ${spec.business.businessName}`),
          body: paragraphHtml(bodyRaw),
          image_position: "right",
          // W4: alt-tekst is verplicht zodra er een afbeelding staat; zonder
          // tekst in het plan valt hij terug op een neutrale, feitelijke
          // omschrijving (geen verzonnen beeldinhoud).
          image_alt:
            resolveSlotText(units, "alt_text", firstMedia?.alt ?? null) ??
            (firstMedia ? `Sfeerbeeld bij ${spec.business.businessName}` : null),
        },
      };
    }
    case "process": {
      const planned = instance.blocks.length;
      const titles = resolveBlockTexts(units, "step_title", planned, []);
      const bodies = resolveBlockTexts(units, "step_body", planned, []);
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      const count = Math.max(planned, titles.length, bodies.length);
      for (let i = 0; i < count; i += 1) {
        const key = `step_${i + 1}`;
        blocks[key] = { type: "step", settings: { title: titles[i] ?? null, description: bodies[i] ?? null } };
        order.push(key);
      }
      return {
        type: SECTION_FILE_NAMES.process,
        settings: { ...variantSettings(instance, "default"), heading: "Zo werken wij" },
        blocks,
        block_order: order,
      };
    }
    case "gallery": {
      const planned = instance.blocks.length;
      const captions = resolveBlockTexts(units, "caption", planned, []);
      const alts = resolveBlockTexts(units, "alt_text", planned, instance.blocks.map((b, i) => instance.media[i]?.alt ?? b.hint ?? null));
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      const count = Math.max(planned, captions.length, alts.length);
      for (let i = 0; i < count; i += 1) {
        const key = `image_${i + 1}`;
        blocks[key] = {
          type: "gallery_image",
          settings: { caption: captions[i] ?? null, alt: alts[i] ?? null },
        };
        order.push(key);
      }
      return {
        type: SECTION_FILE_NAMES.gallery,
        settings: { ...variantSettings(instance, "default"), heading: "Impressie", subheading: null },
        blocks,
        block_order: order,
      };
    }
    case "projects": {
      const planned = instance.blocks.length;
      const titles = resolveBlockTexts(units, "item_title", planned, []);
      const bodies = resolveBlockTexts(units, "item_body", planned, []);
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      const count = Math.max(planned, titles.length, bodies.length);
      for (let i = 0; i < count; i += 1) {
        const key = `project_${i + 1}`;
        blocks[key] = { type: "project", settings: { title: titles[i] ?? null, description: bodies[i] ?? null } };
        order.push(key);
      }
      return {
        type: SECTION_FILE_NAMES.projects,
        settings: { ...variantSettings(instance, "default"), heading: "Ons werk" },
        blocks,
        block_order: order,
      };
    }
    case "testimonials": {
      // Echte uitspraken alléén; auteur blijft leeg tenzij echt bekend.
      const quotes = spec.content.testimonials.filter((q) => q.trim().length > 0);
      const planned = instance.blocks.length;
      const quoteTexts = resolveBlockTexts(units, "quote", planned, quotes);
      const authors = resolveBlockTexts(units, "quote_author", planned, []);
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      const count = Math.max(quoteTexts.length, authors.length);
      for (let i = 0; i < count; i += 1) {
        const key = `testimonial_${i + 1}`;
        blocks[key] = {
          type: "testimonial",
          settings: { quote: quoteTexts[i] ?? null, author: authors[i] ?? null },
        };
        order.push(key);
      }
      return {
        type: SECTION_FILE_NAMES.testimonials,
        settings: { ...variantSettings(instance, "surface"), heading: "Wat klanten zeggen" },
        ...(order.length > 0 ? { blocks, block_order: order } : {}),
      };
    }
    case "team": {
      const planned = instance.blocks.length;
      const names = resolveBlockTexts(units, "member_name", planned, []);
      const roles = resolveBlockTexts(units, "member_role", planned, []);
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      const count = Math.max(planned, names.length, roles.length);
      for (let i = 0; i < count; i += 1) {
        const key = `member_${i + 1}`;
        blocks[key] = { type: "member", settings: { name: names[i] ?? null, role: roles[i] ?? null } };
        order.push(key);
      }
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
      const texts = resolveBlockTexts(units, "item_text", planned, benefits);
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      const count = Math.max(planned, texts.length);
      for (let i = 0; i < count; i += 1) {
        const key = `benefit_${i + 1}`;
        blocks[key] = { type: "benefit", settings: { text: texts[i] ?? null } };
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
      const questions = resolveBlockTexts(units, "faq_question", planned, faq.map((f) => f.question));
      const answersRaw = resolveBlockTexts(units, "faq_answer", planned, faq.map((f) => f.answer));
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      const count = Math.max(planned, questions.length, answersRaw.length);
      for (let i = 0; i < count; i += 1) {
        const key = `question_${i + 1}`;
        blocks[key] = {
          type: "question",
          settings: {
            question: questions[i] ?? null,
            answer: paragraphHtml(answersRaw[i] ?? null),
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
      const planned = instance.blocks.length;
      const services = resolveBlockTexts(units, "item_title", planned, []);
      const prices = resolveBlockTexts(units, "rate_value", planned, []);
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      const count = Math.max(planned, services.length, prices.length);
      for (let i = 0; i < count; i += 1) {
        const key = `rate_${i + 1}`;
        blocks[key] = { type: "rate_item", settings: { service: services[i] ?? null, price: prices[i] ?? null } };
        order.push(key);
      }
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
          heading: resolveSlotText(units, "heading", "Blijf op de hoogte"),
          subheading: resolveSlotText(units, "body", null),
          button_label: resolveSlotText(units, "cta_label", null),
        },
      };
    }
    case "booking": {
      return {
        type: SECTION_FILE_NAMES.booking,
        settings: {
          ...variantSettings(instance, "default"),
          heading: resolveSlotText(units, "heading", instance.cta?.label ?? "Maak een afspraak"),
          subheading: resolveSlotText(units, "subheading", spec.content.contactIntro),
          cta_label: resolveSlotText(units, "cta_label", instance.cta?.label ?? spec.content.ctaPrimaryText),
          cta_link: ctaLink ?? (ctx.contactPageSlug ? `/pages/${ctx.contactPageSlug}` : "#contact"),
        },
      };
    }
    case "cta": {
      return {
        type: SECTION_FILE_NAMES.cta,
        settings: {
          ...variantSettings(instance, "default"),
          heading: resolveSlotText(units, "cta_label", instance.cta?.label ?? spec.content.ctaPrimaryText),
          subheading: resolveSlotText(units, "body", spec.content.contactIntro),
          cta_label: resolveSlotText(units, "cta_label", instance.cta?.label ?? spec.content.ctaPrimaryText),
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
          heading: resolveSlotText(units, "heading", "Contact"),
          intro: resolveSlotText(units, "subheading", spec.content.contactIntro),
          phone: contact.phone,
          email: contact.email,
          address: [contact.address, contact.city].filter(Boolean).join(", ") || null,
          show_form: instance.layout !== "minimal",
        },
      };
    }
    case "rich_text": {
      const planned = instance.blocks.length;
      const headingText = resolveSlotText(units, "heading", null);
      const bodyTexts = resolveBlockTexts(units, "body", planned, []);
      const paragraphs: { body: string | null }[] = [];
      if (headingText != null) paragraphs.push({ body: `<h2>${escapeHtml(headingText)}</h2>` });
      for (const text of bodyTexts) paragraphs.push({ body: paragraphHtml(text) });
      const count = Math.max(planned, paragraphs.length);
      const blocks: Record<string, Record<string, unknown>> = {};
      const order: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const key = `paragraph_${i + 1}`;
        blocks[key] = { type: "paragraph", settings: { body: paragraphs[i]?.body ?? null } };
        order.push(key);
      }
      return {
        type: SECTION_FILE_NAMES.rich_text,
        settings: { ...variantSettings(instance, "default") },
        ...(order.length > 0 ? { blocks, block_order: order } : {}),
      };
    }
  }
}

/**
 * C3d: classificeert alle units op één pad voor de rapportage — één bron
 * van waarheid voor "toegepast / wacht op klant / wacht op merchant /
 * niet-instantieerbaar".
 */
function logPathApplication(
  path: string,
  type: BlueprintSectionType,
  units: ReadonlyMap<string, readonly ContentUnit[]>,
  log: ContentApplicationLog
): void {
  const renderable = RENDERABLE_UNIT_KINDS[type];
  for (const [kind, list] of units) {
    for (const unit of list) {
      const label = `${path}/${kind}`;
      if (unit.status === "customer_slot") {
        log.customerSlots.push(label);
      } else if (unit.status === "merchant_slot") {
        log.merchantSlots.push(label);
      } else if (!renderable.has(kind)) {
        log.unrenderable.push(label);
      } else if (unitRenderText(unit) != null) {
        log.appliedPaths.add(path);
        log.appliedCount += 1;
        if (unit.status === "fixed") log.fixedCount += 1;
      }
    }
  }
}

/** Één blueprint-pagina → Shopify JSON-template (sections + order). */
function composePage(
  page: BlueprintPage,
  ctx: CompositionContext,
  pageContent: PageContentIndex | null,
  pageKey: string,
  log: ContentApplicationLog
): ComposedTemplate {
  const isHome = isHomeKey(page.key);
  // De hero-fallback moet weten op welke pagina hij staat (zie de hero-case).
  const pageCtx: CompositionContext = { ...ctx, currentPageKey: page.key, currentPageTitle: page.title ?? null };
  // Slug komt uit de context-map: die is al deterministisch gedupliceerd
  // (één bron van waarheid; CTA-resolutie en template-pad delen dezelfde slug).
  const slug = ctx.pageKeyToSlug.get(page.key) ?? "";

  const sections: Record<string, Record<string, unknown>> = {};
  const order: string[] = [];
  const typeCounters = new Map<string, number>();

  // Paginakop (W1): een subpagina die niet met een hero begint krijgt een
  // eigen kop met de H1. Zonder deze stap heeft zo'n pagina geen enkele H1
  // (de secties eronder renderen H2) — slecht voor SEO en voor de
  // toegankelijkheidsboom. Homepage heeft al een hero met H1.
  const firstType = page.sectionInstances[0]?.type ?? null;
  if (!isHome && firstType !== "hero") {
    sections.page_header = {
      type: "page-header",
      settings: {
        heading: page.title ?? page.key,
        subheading: page.purpose ?? null,
        background: "default",
        motion: "none",
      },
    } as unknown as Record<string, unknown>;
    order.push("page_header");
  }

  // Sectieritme (Rendering-stap 1, 2026-09-19) — een RENDERING-besluit,
  // geen herplanning: wanneer twee aangrenzende secties allebei op de
  // neutrale "default"-achtergrond staan (het blueprint plant zelf geen
  // contrast), krijgt de tweede deterministisch het contrastvlak
  // "surface". De sectievolgorde, sectiekeuze en expliciete AI-keuzes
  // (surface/accent_band/image) blijven exact gehandhaafd.
  let rhythmAdjustments = 0;
  let previousBackground: string | null = null;

  // C3d: paden met units die naar een niet-bestaande instantie verwijzen
  // (zou C3a-consistency al uitsluiten) worden eerlijk gerapporteerd.
  const unitsByPath = pageContent?.unitsByPath ?? null;
  const consumedPaths = new Set<string>();

  for (let index = 0; index < page.sectionInstances.length; index += 1) {
    const instance = page.sectionInstances[index];
    const path = `${pageKey}/${index}`;
    const units = unitsByPath?.get(path) ?? null;
    if (units) {
      consumedPaths.add(path);
      logPathApplication(path, instance.type, units, log);
    }
    // W5 (6 november 2026): elke subpagina begon met dezelfde hero en twee
    // CTA's, waardoor vijf pagina's als één sjabloon aanvoelden. Een subpagina
    // krijgt nu een paginakop die bij zijn eigen type past: eigen kop, eigen
    // intro, geen tweede knoppaar. De homepage houdt de volledige hero.
    if (!isHome && index === 0 && instance.type === "hero") {
      const headline = resolveSlotText(units, "headline", page.title ?? page.key);
      const intro = resolveSlotText(units, "subheading", page.purpose ?? null);
      const eyebrow = ctx.spec.seo.localArea ?? null;
      sections.page_header = {
        type: "page-header",
        settings: {
          eyebrow: eyebrow ?? "",
          heading: headline ?? page.title ?? page.key,
          subheading: intro ?? "",
          background: "default",
          motion: "none",
        },
      } as unknown as Record<string, unknown>;
      order.push("page_header");
      previousBackground = "default";
      continue;
    }

    const entry = instanceToSectionEntry(instance, pageCtx, units);
    const background = typeof entry.settings.background === "string" ? entry.settings.background : "default";
    if (background === "default" && previousBackground === "default") {
      entry.settings.background = "surface";
      rhythmAdjustments += 1;
    }
    previousBackground =
      typeof entry.settings.background === "string" ? entry.settings.background : "default";

    const n = (typeCounters.get(entry.type) ?? 0) + 1;
    typeCounters.set(entry.type, n);
    // Section-ID's in Shopify-templates mogen GEEN hyfens bevatten (docs: alleen
    // alfanumeriek; Dawn gebruikt underscores, het type zelf mag kebab blijven).
    const idBase = entry.type.replace(/-/g, "_");
    const key = n === 1 ? idBase : `${idBase}_${n}`;
    sections[key] = entry as unknown as Record<string, unknown>;
    order.push(key);
  }

  // Sluitende CTA (W1): een subpagina die zelf geen conversiesectie plant,
  // eindigt zonder actie. Determinant toegevoegd als COMPOSITIE-regel (net als
  // de paginakop), met het echte CTA-doel uit het plan — nooit met verzonnen
  // tekst. De homepage houdt exact wat het blueprint plant.
  const lastType = order.length > 0 ? ((sections[order[order.length - 1]] as { type?: string }).type ?? null) : null;
  const conversionTypes = new Set(["cta", "contact", "booking"]);
  if (!isHome && lastType !== null && !conversionTypes.has(lastType)) {
    const ctaKey = sections.cta ? "cta_2" : "cta";
    sections[ctaKey] = {
      type: "cta",
      settings: {
        heading: ctx.spec.content.ctaPrimaryText,
        subheading: ctx.spec.content.contactIntro,
        cta_label: ctx.spec.content.ctaPrimaryText,
        cta_link: ctx.contactPageSlug ? `/pages/${ctx.contactPageSlug}` : "/",
        layout: "band",
        background: "surface",
        motion: "none",
      },
    };
    order.push(ctaKey);
  }

  // W5: dubbele inhoud binnen één pagina (dezelfde USP of zin in twee
  // secties) is een contentfout, geen stijlkeuze. Deterministisch opruimen:
  // de eerste voorkomen blijft staan, latere duplicaten verdwijnen.
  const seenBlockTexts = new Set<string>();
  const normalizeBlockText = (value: unknown): string =>
    typeof value === "string"
      ? value.toLowerCase().replace(/<[^>]+>/g, " ").replace(/[^a-z0-9]+/g, " ").trim()
      : "";
  let removedDuplicates = 0;
  for (const key of order) {
    const section = sections[key] as unknown as {
      blocks?: Record<string, { settings?: Record<string, unknown> }>;
      block_order?: string[];
    };
    if (!section?.blocks || !section.block_order) continue;
    const kept: string[] = [];
    for (const blockId of section.block_order) {
      const settings = section.blocks[blockId]?.settings ?? {};
      const fingerprint = ["title", "heading", "text", "body", "question", "label"]
        .map((field) => normalizeBlockText(settings[field]))
        .filter((value) => value.length > 12)
        .join("|");
      if (fingerprint.length > 0 && seenBlockTexts.has(fingerprint)) {
        delete section.blocks[blockId];
        removedDuplicates += 1;
        continue;
      }
      if (fingerprint.length > 0) seenBlockTexts.add(fingerprint);
      kept.push(blockId);
    }
    section.block_order = kept;
  }
  if (removedDuplicates > 0) {
    log.duplicateBlocksRemoved = (log.duplicateBlocksRemoved ?? 0) + removedDuplicates;
  }

  if (unitsByPath) {
    for (const path of unitsByPath.keys()) {
      if (!consumedPaths.has(path)) log.skippedPaths.push(path);
    }
  }

  return {
    path: isHome ? "templates/index.json" : `templates/page.${slug}.json`,
    data: { sections, order },
    rhythmAdjustments,
  };
}

/**
 * Volledige blueprint → alle pagina-templates. Homepage én subpagina's komen
 * allebei uit het blueprint; de volgorde en sectiekeuze zijn exact.
 *
 * C3d (2026-09-20): een actueel completed ContentPlan vult per exact pad
 * de content-slots (generated/fixed = tekst, customer/merchant_slot =
 * bewust leeg). Zonder ContentPlan (of zonder blueprint) is de output
 * byte-identiek aan de pre-C3d-flow: volledige backward compatibility.
 */

/**
 * W1 — navigatie uit de werkelijk gegenereerde pagina's.
 *
 * Regel: volgorde en labels komen uit het Design Plan, maar een item zonder
 * gegenereerde pagina vervalt, en elke gegenereerde pagina komt in de
 * navigatie (home vooraan, contact achteraan). Zo wijst de navigatie nooit
 * naar een pagina die niet bestaat.
 */
export function composeSiteNavigation(input: {
  pages: readonly ComposedSitePage[];
  plannedNavigation?: readonly { label: string; pageKey: string }[] | null;
}): CompositionNavigationItem[] {
  const { pages } = input;
  const byKey = new Map<string, ComposedSitePage>();
  for (const page of pages) {
    byKey.set(page.key.trim().toLowerCase(), page);
    byKey.set(page.slug.trim().toLowerCase(), page);
  }

  const home = pages.find((page) => page.url === "/");
  const contact = pages.find((page) => page.key.trim().toLowerCase() === "contact");
  const ordered: CompositionNavigationItem[] = [];
  const used = new Set<string>();

  const push = (page: ComposedSitePage, label: string) => {
    if (used.has(page.key)) return;
    used.add(page.key);
    ordered.push({ label, url: page.url, pageKey: page.key });
  };

  if (home) push(home, "Home");

  for (const item of input.plannedNavigation ?? []) {
    const page = byKey.get(item.pageKey.trim().toLowerCase());
    if (!page || page === contact) continue;
    push(page, item.label.trim());
  }

  for (const page of pages) {
    if (page === home || page === contact) continue;
    push(page, page.title);
  }

  if (contact) push(contact, "Contact");

  return ordered.slice(0, 8);
}

export function composeBlueprintTemplates(input: {
  blueprint: WebsiteBlueprint;
  spec: WebsiteSpecification;
  contact: WebsiteContactContext;
  /** C3d: optioneel — het actuele, geverifieerde ContentPlan. */
  contentPlan?: ContentPlan | null;
  /**
   * W1: de door de AI geplande navigatie (Design Plan.navigation). Alleen de
   * VOLGORDE en labels worden overgenomen; een item zonder gegenereerde
   * pagina vervalt, en pagina's die het plan niet noemt worden aangevuld.
   */
  plannedNavigation?: readonly { label: string; pageKey: string }[] | null;
}): BlueprintCompositionResult {
  const { blueprint, spec, contact } = input;
  const contentPlan = input.contentPlan ?? null;
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

  // C3d: deterministische unit-index (puur; herbruikbaar en testbaar).
  const contentIndex = contentPlan ? buildContentPlanIndex(contentPlan, { gateGContent: true }) : null;
  const log: ContentApplicationLog = {
    appliedPaths: new Set<string>(),
    appliedCount: 0,
    fixedCount: 0,
    customerSlots: [],
    merchantSlots: [],
    unrenderable: [],
    skippedPaths: [],
  };

  const composedPages: ComposedSitePage[] = blueprint.pages.map((page) => {
    const slug = pageKeyToSlug.get(page.key) ?? "";
    const isHome = slug === "";
    return {
      key: page.key,
      title: page.title ?? page.key,
      slug: slug || "home",
      template: isHome ? "index" : `page.${slug}`,
      url: isHome ? "/" : `/pages/${slug}`,
      sectionCount: page.sectionInstances.length,
    };
  });

  const templates: ComposedTemplate[] = [];
  for (const page of blueprint.pages) {
    const pageContent = contentIndex?.get(page.key) ?? null;
    if (contentIndex && !pageContent) {
      notes.push(
        `ContentPlan dekt pagina "${page.key}" niet — de sectiecontent van deze pagina valt terug op de specificatie (niets verzonnen).`
      );
    }
    templates.push(composePage(page, ctx, pageContent, page.key, log));
  }

  // C3d: paginas met pagina-SEO uit het plan eerlijk noteren (het theme
  // kent geen per-pagina SEO-velden; handover zet ze in de Shopify-admin).
  if (contentIndex) {
    for (const [key, pageContent] of contentIndex) {
      if (pageContent.seo.title != null || pageContent.seo.metaDescription != null) {
        notes.push(
          `Pagina-SEO voor "${key}" staat in het ContentPlan (title/metaDescription) — wordt bij de handover in de Shopify-admin gezet; het theme bevat geen per-pagina SEO-velden.`
        );
      }
    }
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
  const rhythmTotal = templates.reduce((sum, t) => sum + t.rhythmAdjustments, 0);
  if (rhythmTotal > 0) {
    notes.push(
      `Sectieritme: ${rhythmTotal} sectie(s) kreeg deterministisch het contrastvlak "surface" waar het blueprint aangrenzende "default"-secties plande (sectievolgorde en expliciete keuzes ongewijzigd).`
    );
  }

  // C3d-rapportage: alleen wanneer er daadwerkelijk een plan werd geconsumeerd.
  if (contentPlan) {
    notes.push(
      `ContentPlan-consumptie: ${log.appliedCount} unit(s) toegepast op ${log.appliedPaths.size} sectie-instantie(s) (${log.fixedCount} fact-locked verbatim, ${log.appliedCount - log.fixedCount} evidence-gedragen); de blueprint-volgorde en sectiekeuze zijn exact ongewijzigd.`
    );
    if (log.customerSlots.length > 0) {
      notes.push(
        `${log.customerSlots.length} slot(s) wachten op klantcontent en zijn bewust leeg gelaten (invulbaar; nooit als verzonnen tekst weergegeven): ${log.customerSlots.slice(0, 8).join(", ")}${log.customerSlots.length > 8 ? ", …" : ""}.`
      );
    }
    if (log.merchantSlots.length > 0) {
      notes.push(
        `${log.merchantSlots.length} slot(s) laten bewust ruimte voor de merchant (beeld/keuze in de theme editor): ${log.merchantSlots.slice(0, 8).join(", ")}${log.merchantSlots.length > 8 ? ", …" : ""}.`
      );
    }
    if (log.unrenderable.length > 0) {
      notes.push(
        `${log.unrenderable.length} unit(s) hebben geen instantie-setting in deze sectie (themabreed geregeld via locales/defaults) en zijn niet afzonderlijk gerenderd: ${log.unrenderable.slice(0, 8).join(", ")}${log.unrenderable.length > 8 ? ", …" : ""}.`
      );
    }
    if (log.skippedPaths.length > 0) {
      notes.push(
        `ContentPlan verwijst naar ${log.skippedPaths.length} niet-bestaand sectie-pad — genegeerd, de blueprint-architectuur is leidend: ${log.skippedPaths.slice(0, 5).join(", ")}.`
      );
    }
  }

  const navigation = composeSiteNavigation({
    pages: composedPages,
    plannedNavigation: input.plannedNavigation ?? null,
  });
  if (composedPages.length > 1) {
    notes.push(
      `Navigatie: ${navigation.length} item(s), uitsluitend naar gegenereerde pagina's (${composedPages.length} pagina('s), home inbegrepen).`
    );
  }

  return { templates, notes, pages: composedPages, navigation };
}
