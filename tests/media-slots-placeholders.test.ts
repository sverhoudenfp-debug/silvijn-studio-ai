import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken (zelfde patroon als theme-zip-tests).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import {
  galleryBlockCount,
  hasGalleryRequirement,
  hasRealTestimonials,
  mediaSlotsFor,
  placeholderVariantFor,
  slotAlt,
  type MediaSlotPlan,
} from "../lib/websites/theme-zip/media-slots";
import { buildGenericPlaceholderSvg, buildMediaPlaceholderSvgs } from "../lib/websites/theme-zip/placeholders";
import type { ThemeDesignTokens } from "../lib/websites/theme-zip/theme-builder";
import { WebsiteSpecificationSchema } from "../lib/ai/schemas";
import type { WebsiteSpecification } from "../lib/websites/types";

// ---------------------------------------------------------------------------
// R1 — Media & beelden: pure mapping-tests (media-slots + placeholders).
// Kernregels die hier bewezen worden:
// - de AI-planning (imageRequirements/imageDescriptions) bepaalt welke sloten
//   bestaan; niets wordt zelf toegevoegd of verzonnen;
// - placeholders zijn abstracte, token-afgeleide SVG's: geen tekst, geen
//   externe verwijzingen, geen gesimuleerde foto's;
// - alles is deterministisch: zelfde input → byte-identieke output.
// ---------------------------------------------------------------------------

function specWith(patch: Record<string, unknown>): WebsiteSpecification {
  const base = {
    template: "business_standard",
    business: {
      businessName: "Testbedrijf B.V.",
      industry: "designstudio",
      city: "Utrecht",
      province: "Utrecht",
      description: null,
      targetAudience: null,
    },
    branding: {
      primaryColor: null,
      secondaryColor: null,
      accentColor: null,
      backgroundStyle: null,
      typographyStyle: null,
      visualStyle: null,
    },
    structure: { pages: [{ key: "home", title: "Home" }], navigation: ["Home"], sections: [] },
    content: {
      headline: "Kop voor de test",
      subheadline: null,
      valueProposition: null,
      services: [{ title: "Testdienst", description: "Eén dienst voor de fixture." }],
      about: null,
      benefits: [],
      faq: [],
      testimonials: [],
      contactIntro: null,
      ctaPrimaryText: "Neem contact op",
      ctaSecondaryText: null,
    },
    conversion: { primaryCta: "contact", secondaryCta: null, contactMethods: [], leadCapture: true },
    media: { imageRequirements: [], imageDescriptions: [], imagePlaceholders: [] },
    seo: {
      title: "Testbedrijf — Utrecht",
      metaDescription: "Testmeta-omschrijving voor de mediaslottest.",
      keywords: [],
      localArea: "Utrecht",
    },
    missingInformation: [],
  };
  return WebsiteSpecificationSchema.parse({
    ...base,
    ...patch,
    content: { ...base.content, ...((patch.content as Record<string, unknown>) ?? {}) },
    media: { ...base.media, ...((patch.media as Record<string, unknown>) ?? {}) },
  }) as WebsiteSpecification;
}

// ---------------------------------------------------------------------
// placeholderVariantFor — deterministische keyword-mapping
// ---------------------------------------------------------------------

test("placeholderVariantFor: null/undefined → abstract_geometric", () => {
  assert.equal(placeholderVariantFor(null), "abstract_geometric");
  assert.equal(placeholderVariantFor(undefined), "abstract_geometric");
  assert.equal(placeholderVariantFor(""), "abstract_geometric");
});

test("placeholderVariantFor: zachte gradient-sfeer → gradient_soft", () => {
  assert.equal(placeholderVariantFor("Zachte gradient-sfeer met luchtige uitstraling"), "gradient_soft");
});

test("placeholderVariantFor: nuchter/minimaal → minimal_mono", () => {
  assert.equal(placeholderVariantFor("Nuchter, minimaal en strak"), "minimal_mono");
});

test("placeholderVariantFor: onbekende strategie → abstract_geometric (geen vrije interpretatie)", () => {
  assert.equal(placeholderVariantFor("bijzondere collages van handgemaakte prints"), "abstract_geometric");
});

// ---------------------------------------------------------------------
// mediaSlotsFor — sloten volgen uitsluitend de AI-planning
// ---------------------------------------------------------------------

test("mediaSlotsFor: hero altijd; about/services/gallery volgen de content + planning", () => {
  const slots = mediaSlotsFor(specWith({}));
  assert.deepEqual(
    slots.map((s) => s.key),
    ["hero", "services"]
  );

  const withAbout = mediaSlotsFor(specWith({ content: { about: "Wij zijn een testbedrijf." } }));
  assert.deepEqual(
    withAbout.map((s) => s.key),
    ["hero", "about", "services"]
  );

  const withGallery = mediaSlotsFor(
    specWith({ media: { imageRequirements: [{ key: "portfolio", description: "Projectimpressies", required: true }] } })
  );
  assert.deepEqual(
    withGallery.map((s) => s.key),
    ["hero", "services", "gallery"]
  );
});

test("mediaSlotsFor: hero is eager + high fetchpriority; de rest lazy", () => {
  const slots = mediaSlotsFor(
    specWith({
      content: { about: "Wij zijn een testbedrijf." },
      media: { imageRequirements: [{ key: "galerij", description: "Werkimpressies", required: true }] },
    })
  );
  const hero = slots.find((s) => s.key === "hero")!;
  assert.equal(hero.loading, "eager");
  assert.equal(hero.fetchpriority, "high");
  for (const slot of slots.filter((s) => s.key !== "hero")) {
    assert.equal(slot.loading, "lazy");
    assert.equal(slot.fetchpriority, "auto");
  }
});

test("mediaSlotsFor: hero-alt komt uit de AI-planning, nooit verzonnen", () => {
  const withDesc = mediaSlotsFor(specWith({ media: { imageDescriptions: ["Sfeerbeeld van de studio"] } }));
  assert.equal(withDesc.find((s) => s.key === "hero")!.alt, "Sfeerbeeld van de studio");

  const withoutDesc = mediaSlotsFor(specWith({}));
  assert.equal(withoutDesc.find((s) => s.key === "hero")!.alt, null);
});

test("mediaSlotsFor is puur: zelfde input → zelfde slots", () => {
  const spec = specWith({ content: { about: "Wij zijn een testbedrijf." } });
  assert.deepEqual(mediaSlotsFor(spec), mediaSlotsFor(spec));
});

test("hasGalleryRequirement herkent gecontroleerde gallery-sleutels, en niets anders", () => {
  for (const key of ["portfolio", "galerij", "projecten", "fotos", "impressie"]) {
    assert.equal(hasGalleryRequirement(specWith({ media: { imageRequirements: [{ key, description: "Testbeeld voor de galerij", required: true }] } })), true, key);
  }
  assert.equal(hasGalleryRequirement(specWith({ media: { imageRequirements: [{ key: "hero", description: "Testbeeld voor de galerij", required: true }] } })), false);
  assert.equal(hasGalleryRequirement(specWith({})), false);
});

test("hasRealTestimonials: alleen échte, niet-lege uitspraken tellen", () => {
  assert.equal(hasRealTestimonials(specWith({})), false);
  assert.equal(hasRealTestimonials(specWith({ content: { testimonials: ["     "] } })), false);
  assert.equal(hasRealTestimonials(specWith({ content: { testimonials: ["Zeer betrouwbaar bedrijf."] } })), true);
});

test("galleryBlockCount: volgt de planning, gekapt op 6, default 4", () => {
  assert.equal(galleryBlockCount(specWith({})), 4);
  assert.equal(galleryBlockCount(specWith({ media: { imageDescriptions: [" Klaas ", " Berta "] } })), 2);
  assert.equal(
    galleryBlockCount(specWith({ media: { imageDescriptions: [" Klaas ", " Berta ", " Cees ", " Dora ", " Eef ", " Fien ", " Guus ", " Henk "] } })),
    6
  );
});

test("slotAlt: expliciete setting wint, anders de geplande beschrijving, anders null", () => {
  const slot: MediaSlotPlan = {
    key: "hero",
    placeholderAsset: "placeholder-hero.svg",
    aspect: "wide",
    sizes: "100vw",
    widths: [480],
    alt: "Geplande beschrijving",
    loading: "eager",
    fetchpriority: "high",
  };
  assert.equal(slotAlt(slot, "Eigen alt-tekst"), "Eigen alt-tekst");
  assert.equal(slotAlt(slot, "   "), "Geplande beschrijving");
  assert.equal(slotAlt(slot, null), "Geplande beschrijving");
  const empty: MediaSlotPlan = { ...slot, alt: null };
  assert.equal(slotAlt(empty, null), null);
});

// ---------------------------------------------------------------------
// Placeholders — abstract, token-afgeleid, deterministisch
// ---------------------------------------------------------------------

const TOKENS: ThemeDesignTokens = {
  primary: "#1f3a2e",
  secondary: "#2d4439",
  accent: "#b08d57",
  background: "#f7f7f5",
  surface: "#3b5849",
  text: "#1c2320",
  mutedText: "#5f6672",
  border: "#e5e7eb",
  headingFont: "sans",
  bodyFont: "sans",
  sectionSpacing: "96px",
  containerWidth: "1200px",
  radius: "10px",
  headingScale: 110,
  headingWeight: 700,
  bodyWeight: 400,
  heroLayout: "focused",
};

test("buildMediaPlaceholderSvgs: vaste set van 4 slot-placeholders in assets/", () => {
  const files = buildMediaPlaceholderSvgs("abstract_geometric", TOKENS);
  assert.deepEqual(
    files.map((f) => f.path),
    [
      "assets/placeholder-hero.svg",
      "assets/placeholder-about.svg",
      "assets/placeholder-service.svg",
      "assets/placeholder-gallery.svg",
    ]
  );
});

test("Placeholders zijn abstract: geen tekst, geen externe verwijzingen, geen echte foto", () => {
  for (const variant of ["abstract_geometric", "gradient_soft", "minimal_mono"] as const) {
    for (const file of buildMediaPlaceholderSvgs(variant, TOKENS)) {
      assert.equal(file.content.includes("<text"), false, `${variant}/${file.path}: geen tekst in placeholders`);
      assert.equal(/https?:\/\//.test(file.content.replace('xmlns="http://www.w3.org/2000/svg"', "")), false, `${variant}/${file.path}: geen externe URL's`);
      assert.equal(file.content.includes("<img"), false, "geen gerasterde/ingesloten foto");
      assert.ok(file.content.includes(TOKENS.primary) || file.content.includes(TOKENS.accent) || file.content.includes(TOKENS.surface), "kleuren komen uit de tokens");
    }
  }
});

test("Placeholders zijn deterministisch: twee builds zijn byte-identiek", () => {
  for (const variant of ["abstract_geometric", "gradient_soft", "minimal_mono"] as const) {
    assert.deepEqual(buildMediaPlaceholderSvgs(variant, TOKENS), buildMediaPlaceholderSvgs(variant, TOKENS));
  }
});

test("Placeholder-varianten verschillen zichtbaar (elke strategie levert een eigen compositie)", () => {
  const geo = buildMediaPlaceholderSvgs("abstract_geometric", TOKENS).find((f) => f.path === "assets/placeholder-hero.svg")!.content;
  const grad = buildMediaPlaceholderSvgs("gradient_soft", TOKENS).find((f) => f.path === "assets/placeholder-hero.svg")!.content;
  const mono = buildMediaPlaceholderSvgs("minimal_mono", TOKENS).find((f) => f.path === "assets/placeholder-hero.svg")!.content;
  assert.notEqual(geo, grad);
  assert.notEqual(geo, mono);
  assert.notEqual(grad, mono);
  assert.ok(grad.includes("linearGradient"), "gradient_soft gebruikt een gradient");
  assert.ok(mono.includes("stroke"), "minimal_mono gebruikt lijnen");
});

test("Generieke placeholder blijft bestaan (product-cards/giftcard-compatibiliteit)", () => {
  const generic = buildGenericPlaceholderSvg(TOKENS);
  assert.equal(generic.path, "assets/placeholder.svg");
  assert.ok(generic.content.includes("placeholder") === false || generic.content.includes("aria-label"));
  assert.ok(generic.content.includes(TOKENS.surface));
});
