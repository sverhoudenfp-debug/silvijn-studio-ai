import type { WebsiteSpecification } from "../types";

/**
 * Media-slots (R1 — Media & beelden) — de DETERMINISTISCHE brug tussen wat de
 * AI al plant (WebsiteSpecification.media.imageRequirements /
 * imageDescriptions en Design Plan.imagery) en wat de theme-builder
 * daadwerkelijk aan beeldsloten rendert via snippets/theme-media.liquid.
 *
 * HARD REGELS:
 * - Geen enkel gepland beeld wordt verzonnen of gevuld: zonder echte
 *   afbeelding (image_picker-setting) rendert het thema een abstracte,
 *   token-afgeleide placeholder die duidelijk geen echte foto simuleert.
 * - De mapping is puur: zelfde specification + plan → zelfde slots.
 * - Alleen de AI-planning bepaalt WELKE beeldsloten nodig zijn; deze module
 *   vertaalt slechts keys (bijv. "hero", "portfolio") naar gecontroleerde
 *   sloten — hij voegt zelf nooit contentbedrijven toe.
 */

export type MediaSlotKey = "hero" | "about" | "services" | "gallery";

/**
 * Gecontroleerde placeholder-variant, afgeleid uit
 * Design Plan.imagery.placeholderStrategy (vrije tekst → deterministische
 * keyword-mapping, zelfde patroon als heroLayoutFor()).
 */
export type PlaceholderVariant = "abstract_geometric" | "gradient_soft" | "minimal_mono";

/** Aspect-ratio's die theme.css kent (anti-CLS: gereserveerde ruimte). */
export type MediaAspect = "wide" | "landscape" | "square";

export interface MediaSlotPlan {
  /** Gecontroleerde slot-key; bepaalt placeholder-asset + aspect. */
  key: MediaSlotKey;
  /** Asset-bestandsnaam van de abstracte placeholder (assets/<naam>). */
  placeholderAsset: string;
  /** CSS aspect-ratio-variant (zie .theme-media--* in theme.css). */
  aspect: MediaAspect;
  /** sizes-attribuut voor de srcset van echte afbeeldingen. */
  sizes: string;
  /** srcset-breedtes voor image_tag (Shopify genereeert de werkelijke URL's). */
  widths: readonly number[];
  /**
   * Start-alt voor een latere echte afbeelding — uit
   * spec.media.imageDescriptions (AI-planning), NOOIT zelf verzonnen.
   * Placeholders zelf renderen decoratief (alt="", role="presentation").
   */
  alt: string | null;
  /** Hero is above-the-fold: eager + fetchpriority high; de rest lazy. */
  loading: "eager" | "lazy";
  fetchpriority: "high" | "auto";
}

const GALLERY_KEY_PATTERN =
  /(gallery|galerij|gallerij|portfolio|projecten|werk|fotos|foto's|fotograf|beelden|impressie|showcase)/i;
const ABOUT_KEY_PATTERN = /(about|over\s*ons|over\s*het\s*bedrijf|team|bedrijf|pand|locatie)/i;

const VARIANT_KEYWORDS: ReadonlyArray<readonly [RegExp, PlaceholderVariant]> = [
  [/gradient|soft|zacht|zachte|rustig|luchtig|airy|dreamy/i, "gradient_soft"],
  [/mono|minimal|minimaal|nuchter|clean|strak|sobere/i, "minimal_mono"],
];

/**
 * Deterministische vertaling van imagery.placeholderStrategy naar een
 * gecontroleerde placeholder-variant. Onbekend → abstract_geometric (de
 * standaardcompositie).
 */
export function placeholderVariantFor(strategy: string | null | undefined): PlaceholderVariant {
  if (!strategy) return "abstract_geometric";
  for (const [pattern, variant] of VARIANT_KEYWORDS) {
    if (pattern.test(strategy)) return variant;
  }
  return "abstract_geometric";
}

/**
 * Alle beeldsloten die het thema voor deze specification rendert:
 * - hero: ALTIJD (above-the-fold; eager).
 * - about: als er about-content is.
 * - services: als er diensten zijn (media-slot boven elke dienstkaart).
 * - gallery: uitsluitend als de AI een gallery-achtig imageRequirement heeft
 *   gepland — anders wordt er geen gallery-sectie geinstantieerd.
 */
export function mediaSlotsFor(spec: WebsiteSpecification): MediaSlotPlan[] {
  const slots: MediaSlotPlan[] = [
    {
      key: "hero",
      placeholderAsset: "placeholder-hero.svg",
      aspect: "wide",
      sizes: "(min-width: 990px) 50vw, 100vw",
      widths: [480, 750, 1100, 1500],
      alt:
        spec.media.imageDescriptions[0] ??
        spec.media.imageRequirements.find((r) => r.key === "hero")?.description ??
        null,
      loading: "eager",
      fetchpriority: "high",
    },
  ];

  if (spec.content.about) {
    slots.push({
      key: "about",
      placeholderAsset: "placeholder-about.svg",
      aspect: "landscape",
      sizes: "(min-width: 990px) 480px, 100vw",
      widths: [480, 750, 1100],
      alt:
        spec.media.imageDescriptions[1] ??
        spec.media.imageRequirements.find((r) => ABOUT_KEY_PATTERN.test(r.key))?.description ??
        null,
      loading: "lazy",
      fetchpriority: "auto",
    });
  }

  if (spec.content.services.length > 0) {
    slots.push({
      key: "services",
      placeholderAsset: "placeholder-service.svg",
      aspect: "landscape",
      sizes: "(min-width: 990px) 360px, 100vw",
      widths: [360, 480, 750],
      alt: null, // dienstkaart-media is decoratief; geen eigen beschrijving gepland
      loading: "lazy",
      fetchpriority: "auto",
    });
  }

  if (hasGalleryRequirement(spec)) {
    slots.push({
      key: "gallery",
      placeholderAsset: "placeholder-gallery.svg",
      aspect: "square",
      sizes: "(min-width: 990px) 33vw, (min-width: 750px) 50vw, 100vw",
      widths: [480, 750, 1100],
      alt: spec.media.imageDescriptions[2] ?? null,
      loading: "lazy",
      fetchpriority: "auto",
    });
  }

  return slots;
}

/** Heeft de AI een gallery-achtig beeldvereiste gepland? */
export function hasGalleryRequirement(spec: WebsiteSpecification): boolean {
  return spec.media.imageRequirements.some((r) => GALLERY_KEY_PATTERN.test(r.key));
}

/** Heeft de specificatie ECHTE testimonial-teksten (nooit anders geinstantieerd)? */
export function hasRealTestimonials(spec: WebsiteSpecification): boolean {
  return spec.content.testimonials.some((t) => t.trim().length > 0);
}

/**
 * Aantal gallery-blokken: gelijk aan het aantal geplande beeldbeschrijvingen
 * (gekapd op 6), anders default 4 — de merchant vult de beelden zelf.
 */
export function galleryBlockCount(spec: WebsiteSpecification): number {
  const descriptions = spec.media.imageDescriptions.filter((d) => d.trim().length > 0);
  return Math.min(6, descriptions.length > 0 ? descriptions.length : 4);
}

/**
 * Volledige media-config voor de builder: sloten + placeholder-variant in
 * één deterministisch object (geen verborgen toestand).
 */
export interface MediaPlan {
  slots: MediaSlotPlan[];
  variant: PlaceholderVariant;
}

export function mediaPlanFor(
  spec: WebsiteSpecification,
  placeholderStrategy: string | null
): MediaPlan {
  return {
    slots: mediaSlotsFor(spec),
    variant: placeholderVariantFor(placeholderStrategy),
  };
}

/** Zoek één slot op key (puur hulpje voor de builder). */
export function findSlot(slots: ReadonlyArray<MediaSlotPlan>, key: MediaSlotKey): MediaSlotPlan {
  const slot = slots.find((s) => s.key === key);
  // Fallback mag nooit voorkomen (hero zit er altijd in); expliciet hard failen.
  if (!slot) throw new Error(`Onbekend media-slot "${key}"`);
  return slot;
}

/** Start-alt voor een slot: expliciete setting > geplande beschrijving > null. */
export function slotAlt(slot: MediaSlotPlan, setting: string | null | undefined): string | null {
  const value = (setting ?? "").trim();
  return value.length > 0 ? value : slot.alt;
}
