import type { DesignPlan } from "../design-plan";
import type { WebsiteContactContext } from "../generator";
import type { WebsiteSpecification } from "../types";
import type { ThemeFile } from "./theme-structure";

/**
 * Deterministische Shopify-theme-builder (Fase I.2).
 *
 * PRINCIPE: de AI levert alléén de (gevalideerde) WebsiteSpecification en het
 * (gevalideerde) interne Design Plan. Deze builder vertaalt die 1-op-1 naar
 * Liquid/JSON volgens Shopify's gedocumenteerde themastructuur. Er is géén
 * AI-code, géén kopie van een referentie-thema en géén verzonnen content:
 * alles wat onbekend is, wordt een expliciete, bewerkbare placeholder.
 *
 * Het visuele ontwerp (kleuren, typografie, dichtheid) komt uit het Design
 * Plan van dít project — daardoor is elk thema uniek voor de klant zonder
 * dat er ooit een referentie-identiteit wordt gekopieerd.
 */

// ---------------------------------------------------------------------------
// Deterministische design-tokens
// ---------------------------------------------------------------------------

export interface ThemeDesignTokens {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  border: string;
  headingFont: string;
  bodyFont: string;
  sectionSpacing: string;
  containerWidth: string;
  radius: string;
}

const FALLBACK_TOKENS: Omit<ThemeDesignTokens, "primary" | "secondary" | "accent"> = {
  background: "#ffffff",
  surface: "#f7f7f8",
  text: "#1f2328",
  mutedText: "#5f6672",
  border: "#e5e7eb",
  headingFont: "sans",
  bodyFont: "sans",
  sectionSpacing: "normal",
  containerWidth: "1160",
  radius: "10",
};

/** Deterministische fallback-kleur wanneer het Design Plan geen kleur bevat. */
const FALLBACK_PALETTE = { primary: "#3f5f4f", secondary: "#8d9a92", accent: "#c9a55a" } as const;

function pickPlanColor(value: string | null, fallback: string): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

/** Kleur with lichtere/donkerdere variant bepalen — puur rekenkundig, geen random. */
function shade(hex: string, factor: number): string {
  const r = Math.round(Number.parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(Number.parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(Number.parseInt(hex.slice(5, 7), 16) * factor);
  const clamp = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

const FONT_STACKS: Record<string, { heading: string; body: string }> = {
  sans: {
    heading: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },
  serif: {
    heading: "Georgia, 'Times New Roman', 'Iowan Old Style', serif",
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  },
  mono: {
    heading: "'SF Mono', 'Cascadia Code', Consolas, 'Liberation Mono', monospace",
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  },
};

function fontKeyFor(pairing: string | null): "sans" | "serif" | "mono" {
  const p = (pairing ?? "").toLowerCase();
  if (/(serif|roman|klassiek|elegant|grafisch)/.test(p)) return "serif";
  if (/(mono|code|technisch)/.test(p)) return "mono";
  return "sans";
}

function spacingFor(density: string | null): string {
  const d = (density ?? "").toLowerCase();
  if (/(compact|dicht|strak)/.test(d)) return "compact";
  if (/(ruim|spacious|luchtig)/.test(d)) return "spacious";
  return "normal";
}

export function buildThemeDesignTokens(plan: DesignPlan): ThemeDesignTokens {
  const primary = pickPlanColor(plan.colors.primary, FALLBACK_PALETTE.primary);
  const accent = pickPlanColor(plan.colors.accent, FALLBACK_PALETTE.accent);
  const secondary = pickPlanColor(plan.colors.secondary, shade(primary, 0.72));
  const neutrals = plan.colors.neutrals.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));
  const fontKey = fontKeyFor(plan.typography.pairing);
  const fonts = FONT_STACKS[fontKey];
  return {
    primary,
    secondary,
    accent,
    background: neutrals[0] ?? FALLBACK_TOKENS.background,
    surface: neutrals[1] ?? shade(primary, 0.93),
    text: neutrals[2] ?? FALLBACK_TOKENS.text,
    mutedText: neutrals[3] ?? FALLBACK_TOKENS.mutedText,
    border: neutrals[4] ?? FALLBACK_TOKENS.border,
    headingFont: fonts.heading,
    bodyFont: fonts.body,
    sectionSpacing: spacingFor(plan.spacing.density),
    containerWidth: FALLBACK_TOKENS.containerWidth,
    radius: FALLBACK_TOKENS.radius,
  };
}

// ---------------------------------------------------------------------------
// Escaping helpers (deterministisch)
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugifyKey(key: string): string {
  const cleaned = key
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "pagina";
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function buildSettingsSchema(businessName: string): ThemeFile {
  const schema = [
    {
      name: "theme_info",
      theme_name: `${businessName} — Shopify-thema`,
      theme_version: "1.0.0",
      theme_author: "Silvijn Studio",
      theme_documentation_url: "https://silvijnstudio.com",
      theme_support_url: "https://silvijnstudio.com",
    },
    {
      name: "Kleuren",
      settings: [
        { type: "image_picker", id: "favicon", label: "Favicon" },
        { type: "color", id: "color_primary", label: "Primaire kleur", default: "#3f5f4f" },
        { type: "color", id: "color_accent", label: "Accentkleur", default: "#c9a55a" },
        { type: "color", id: "color_background", label: "Achtergrond", default: "#ffffff" },
        { type: "color", id: "color_text", label: "Tekstkleur", default: "#1f2328" },
      ],
    },
    {
      name: "Typografie",
      settings: [
        {
          type: "select",
          id: "font_heading",
          label: "Kopfont",
          default: "sans",
          options: [
            { value: "sans", label: "Sans-serif (systeem)" },
            { value: "serif", label: "Serif (systeem)" },
          ],
        },
        {
          type: "range",
          id: "heading_scale",
          label: "Kopgrootte",
          min: 90,
          max: 130,
          step: 5,
          unit: "%",
          default: 100,
        },
      ],
    },
    {
      name: "Layout",
      settings: [
        {
          type: "range",
          id: "page_width",
          label: "Paginabreedte",
          min: 1000,
          max: 1400,
          step: 20,
          unit: "px",
          default: 1160,
        },
        {
          type: "select",
          id: "section_spacing",
          label: "Sectiedichtheid",
          default: "normal",
          options: [
            { value: "compact", label: "Compact" },
            { value: "normal", label: "Normaal" },
            { value: "spacious", label: "Ruim" },
          ],
        },
      ],
    },
  ];
  return { path: "config/settings_schema.json", content: `${JSON.stringify(schema, null, 2)}\n` };
}

function buildSettingsData(tokens: ThemeDesignTokens): ThemeFile {
  const data = {
    current: {
      color_primary: tokens.primary,
      color_accent: tokens.accent,
      color_background: tokens.background,
      color_text: tokens.text,
      font_heading: tokens.headingFont === FONT_STACKS.serif.heading ? "serif" : "sans",
      heading_scale: 100,
      page_width: Number.parseInt(tokens.containerWidth, 10),
      section_spacing: tokens.sectionSpacing,
    },
  };
  return { path: "config/settings_data.json", content: `${JSON.stringify(data, null, 2)}\n` };
}

// ---------------------------------------------------------------------------
// Layout + snippets + assets
// ---------------------------------------------------------------------------

function buildThemeLayout(spec: WebsiteSpecification, tokens: ThemeDesignTokens): ThemeFile {
  const liquid = `{comment}
  Gegenereerd door Silvijn Studio — deterministisch thema op basis van de
  gevalideerde WebsiteSpecification en het interne Design Plan.
  Content staat in de JSON-templates; ontwerp staat in de settings.
{/comment}
<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>
      {{ page.title }}
      {%- if page.title != blank and shop.name != blank %} &middot; {% endif -%}
      {{ shop.name }}
    </title>
    {% if page.description %}<meta name="description" content="{{ page.description | escape }}">{% endif %}
    <link rel="canonical" href="{{ canonical_url }}">
    {%- if settings.favicon != blank -%}
      <link rel="icon" type="image/png" href="{{ settings.favicon | image_url: width: 48 }}">
    {%- endif -%}
    {% render 'meta-tags' %}
    {{ content_for_header }}
    {% style %}
      :root {
        --color-primary: {{ settings.color_primary }};
        --color-accent: {{ settings.color_accent }};
        --color-background: {{ settings.color_background }};
        --color-text: {{ settings.color_text }};
        --color-surface: {{ settings.color_background | color_mix: settings.color_text, 5 }};
        --color-border: {{ settings.color_background | color_mix: settings.color_text, 14 }};
        --color-muted: {{ settings.color_background | color_mix: settings.color_text, 45 }};
        --font-heading: {% if settings.font_heading == 'serif' %}${FONT_STACKS.serif.heading}{% else %}${FONT_STACKS.sans.heading}{% endif %};
        --font-body: ${tokens.bodyFont};
        --heading-scale: {{ settings.heading_scale | divided_by: 100.0 }};
        --page-width: {{ settings.page_width }}px;
        --radius: ${tokens.radius}px;
      }
    {% endstyle %}
    {{ 'theme.css' | asset_url | stylesheet_tag }}
    <script src="{{ 'theme.js' | asset_url }}" defer></script>
  </head>
  <body class="template-{{ template.name | default: 'index' }}">
    <a class="skip-link" href="#main-content">{{ 'accessibility.skip_to_content' | t }}</a>
    {% sections 'header-group' %}
    <main id="main-content" role="main">
      {{ content_for_layout }}
    </main>
    {% sections 'footer-group' %}
  </body>
</html>
`;
  return { path: "layout/theme.liquid", content: liquid };
}

function buildMetaTagsSnippet(): ThemeFile {
  const liquid = `{%- liquid
  assign og_title = page.title | default: shop.name
  assign og_description = page.description | default: shop.description
-%}
<meta property="og:site_name" content="{{ shop.name | escape }}">
<meta property="og:title" content="{{ og_title | escape }}">
<meta property="og:description" content="{{ og_description | escape }}">
<meta property="og:url" content="{{ canonical_url }}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
`;
  return { path: "snippets/meta-tags.liquid", content: liquid };
}

function buildButtonSnippet(): ThemeFile {
  const liquid = `{%- comment -%}
  Knop-tag: {% render 'button', label: ..., url: ..., variant: 'primary' %}
{%- endcomment -%}
{%- if url != blank -%}
  <a class="btn btn--{{ variant | default: 'primary' }}" href="{{ url }}">
    {{ label }}
  </a>
{%- else -%}
  <button type="{{ type | default: 'submit' }}" class="btn btn--{{ variant | default: 'primary' }}">
    {{ label }}
  </button>
{%- endif -%}
`;
  return { path: "snippets/button.liquid", content: liquid };
}

function buildThemeCss(tokens: ThemeDesignTokens): ThemeFile {
  const spacing = tokens.sectionSpacing === "compact" ? "48px" : tokens.sectionSpacing === "spacious" ? "112px" : "72px";
  const css = `/* Gegenereerd door Silvijn Studio — deterministische structurele stijlen.
   Design-tokens komen uit de settings ( zie layout/theme.liquid). */
:root {
  --section-spacing: ${spacing};
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  font-family: var(--font-body);
  font-size: 1rem;
  line-height: 1.65;
  color: var(--color-text);
  background: var(--color-background);
}
h1, h2, h3, h4 { font-family: var(--font-heading); line-height: 1.2; margin: 0 0 .6em; font-size: calc(1em * var(--heading-scale)); }
h1 { font-size: calc(2.4rem * var(--heading-scale)); }
h2 { font-size: calc(1.8rem * var(--heading-scale)); }
h3 { font-size: calc(1.25rem * var(--heading-scale)); }
p { margin: 0 0 1em; }
a { color: var(--color-primary); text-decoration-thickness: 1px; text-underline-offset: 3px; }
img { max-width: 100%; height: auto; display: block; }
.container { width: 100%; max-width: var(--page-width); margin-inline: auto; padding-inline: 20px; }
.skip-link {
  position: absolute; left: -9999px; top: 0; background: var(--color-primary); color: #fff;
  padding: 10px 16px; z-index: 100; border-radius: 0 0 var(--radius) 0;
}
.skip-link:focus { left: 0; color: #fff; }
:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 2px; }

/* Header */
.site-header { border-bottom: 1px solid var(--color-border); background: var(--color-background); position: sticky; top: 0; z-index: 10; }
.site-header__inner { display: flex; align-items: center; gap: 16px; justify-content: space-between; padding-block: 14px; }
.site-header__brand { font-family: var(--font-heading); font-weight: 700; font-size: 1.2rem; color: var(--color-text); text-decoration: none; }
.site-nav { display: flex; gap: 20px; flex-wrap: wrap; }
.site-nav a { text-decoration: none; color: var(--color-text); font-weight: 500; }
.site-nav a:hover, .site-nav a:focus { color: var(--color-primary); }
.site-header__actions { display: flex; gap: 12px; align-items: center; }
.header-nav-toggle { display: none; }

/* Hero */
.hero { padding-block: var(--section-spacing); background: linear-gradient(180deg, var(--color-surface), var(--color-background)); }
.hero__inner { display: grid; gap: 24px; max-width: 720px; }
.hero__eyebrow { text-transform: uppercase; letter-spacing: .12em; font-size: .8rem; color: var(--color-primary); font-weight: 600; margin-bottom: 8px; }
.hero p { font-size: 1.15rem; color: var(--color-muted); }
.hero__actions { display: flex; gap: 12px; flex-wrap: wrap; }

/* Buttons */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 12px 22px; border-radius: var(--radius); border: 1px solid transparent;
  font: inherit; font-weight: 600; cursor: pointer; text-decoration: none;
  transition: background-color .15s ease, color .15s ease;
}
.btn--primary { background: var(--color-primary); color: #fff; }
.btn--primary:hover, .btn--primary:focus { background: var(--color-accent); color: #fff; }
.btn--secondary { background: transparent; color: var(--color-primary); border-color: var(--color-primary); }
.btn--secondary:hover, .btn--secondary:focus { background: var(--color-surface); }

/* Sections */
.section { padding-block: var(--section-spacing); }
.section--surface { background: var(--color-surface); }
.section__header { max-width: 720px; margin-bottom: 32px; }
.section__header p { color: var(--color-muted); }

/* Cards */
.card-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.card { background: var(--color-background); border: 1px solid var(--color-border); border-radius: var(--radius); padding: 22px; }
.card h3 { margin-bottom: .4em; }
.card p { color: var(--color-muted); margin: 0; }

/* FAQ */
.faq-list { display: grid; gap: 12px; max-width: 820px; }
.faq-item { border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-background); }
.faq-item summary { cursor: pointer; padding: 16px 20px; font-weight: 600; list-style: none; display: flex; justify-content: space-between; gap: 12px; }
.faq-item summary::-webkit-details-marker { display: none; }
.faq-item summary::after { content: "+"; font-size: 1.3rem; color: var(--color-primary); }
.faq-item[open] summary::after { content: "\\2013"; }
.faq-item__body { padding: 0 20px 18px; color: var(--color-muted); }

/* Forms */
.form { display: grid; gap: 14px; max-width: 560px; }
.field label { display: block; font-weight: 600; margin-bottom: 4px; font-size: .95rem; }
.field input, .field textarea {
  width: 100%; padding: 11px 14px; border: 1px solid var(--color-border);
  border-radius: var(--radius); font: inherit; background: var(--color-background); color: var(--color-text);
}
.field input:focus-visible, .field textarea:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 0; border-color: var(--color-primary); }
.form__status { font-weight: 600; }
.form__status--success { color: var(--color-primary); }
.form__status--error { color: #b3261e; }

/* Footer */
.site-footer { background: var(--color-surface); border-top: 1px solid var(--color-border); padding-block: 40px; margin-top: var(--section-spacing); }
.site-footer__inner { display: grid; gap: 20px; }
.site-footer p { color: var(--color-muted); margin: 0; font-size: .95rem; }

/* Shop */
.product-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
.product-card { border: 1px solid var(--color-border); border-radius: var(--radius); overflow: hidden; background: var(--color-background); display: flex; flex-direction: column; }
.product-card__media { aspect-ratio: 1; background: var(--color-surface); }
.product-card__body { padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }
.product-card__title { font-weight: 600; color: var(--color-text); text-decoration: none; }
.price { font-weight: 700; color: var(--color-primary); }
.cart-table { width: 100%; border-collapse: collapse; }
.cart-table th, .cart-table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--color-border); }

/* 404 */
.error-404 { text-align: center; padding-block: var(--section-spacing); }
.error-404 h1 { font-size: 4rem; margin-bottom: .2em; }

@media (max-width: 760px) {
  .header-nav-toggle { display: inline-flex; }
  .site-nav {
    display: none; position: absolute; top: 100%; left: 0; right: 0;
    background: var(--color-background); border-bottom: 1px solid var(--color-border);
    flex-direction: column; padding: 16px 20px; gap: 14px;
  }
  .site-nav[data-open="true"] { display: flex; }
  .hero h1 { font-size: calc(1.8rem * var(--heading-scale)); }
}

@media (prefers-reduced-motion: reduce) {
  .btn { transition: none; }
}
`;
  return { path: "assets/theme.css", content: css };
}

function buildThemeJs(): ThemeFile {
  const js = `// Gegenereerd door Silvijn Studio — minimale, progressieve verbeteringen.
(function () {
  "use strict";
  document.addEventListener("DOMContentLoaded", function () {
    var toggle = document.querySelector("[data-nav-toggle]");
    var nav = document.querySelector("[data-nav]");
    if (toggle && nav) {
      toggle.addEventListener("click", function () {
        var open = nav.getAttribute("data-open") === "true";
        nav.setAttribute("data-open", open ? "false" : "true");
        toggle.setAttribute("aria-expanded", open ? "false" : "true");
      });
    }
  });
})();
`;
  return { path: "assets/theme.js", content: js };
}

function buildPlaceholderSvg(tokens: ThemeDesignTokens): ThemeFile {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" role="img" aria-label="Placeholder-afbeelding">
  <rect width="800" height="500" fill="${tokens.surface}"/>
  <circle cx="400" cy="250" r="130" fill="${tokens.primary}" opacity="0.14"/>
  <circle cx="400" cy="250" r="80" fill="${tokens.accent}" opacity="0.2"/>
  <rect x="140" y="380" width="520" height="12" rx="6" fill="${tokens.primary}" opacity="0.18"/>
</svg>
`;
  return { path: "assets/placeholder.svg", content: svg };
}

function buildLocaleFile(): ThemeFile {
  const locale = {
    accessibility: { skip_to_content: "Direct naar de inhoud" },
    general: {
      search: "Zoeken",
      menu: "Menu",
      close: "Sluiten",
      cart: "Winkelwagen",
      back_home: "Terug naar de homepage",
      learn_more: "Meer informatie",
    },
    contact: {
      title: "Contact",
      intro: "Neem contact met ons op — we reageren zo snel mogelijk.",
      name: "Naam",
      email: "E-mailadres",
      phone: "Telefoonnummer",
      message: "Bericht",
      submit: "Verstuur bericht",
      success: "Bedankt! Je bericht is verzonden.",
      error: "Het bericht kon niet worden verzonden. Probeer het nogmaals.",
      call_us: "Bel ons",
      email_us: "Mail ons",
      visit_us: "Bezoek ons",
    },
    cart: {
      title: "Winkelwagen",
      empty: "Je winkelwagen is leeg.",
      product: "Product",
      price: "Prijs",
      quantity: "Aantal",
      total: "Totaal",
      checkout: "Afrekenen",
      remove: "Verwijderen",
      subtotal: "Subtotaal",
      taxes_note: "Belastingen en verzendkosten worden berekend bij het afrekenen.",
      continue_shopping: "Verder winkelen",
    },
    search: {
      title: "Zoekresultaten",
      placeholder: "Zoek in de winkel...",
      submit: "Zoeken",
      results_count: {
        one: "{{ count }} resultaat",
        other: "{{ count }} resultaten",
      },
      no_results: "Geen resultaten gevonden.",
    },
    collections: {
      title: "Collecties",
      empty: "Er zijn geen producten gevonden.",
    },
    products: {
      add_to_cart: "Toevoegen aan winkelwagen",
      sold_out: "Uitverkocht",
      unavailable: "Niet beschikbaar",
      quantity: "Aantal",
      view_details: "Bekijk details",
      vendor: "Merk",
    },
    error_404: {
      title: "Pagina niet gevonden",
      subtext: "De pagina die je zoekt bestaat niet (meer).",
    },
  };
  return { path: "locales/nl.default.json", content: `${JSON.stringify(locale, null, 2)}\n` };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function buildHeaderSection(): ThemeFile {
  const liquid = `<header class="site-header">
  <div class="container site-header__inner">
    <a class="site-header__brand" href="/">
      {{ section.settings.brand_text | default: shop.name }}
    </a>
    <nav class="site-nav" data-nav aria-label="{{ 'general.menu' | t }}">
      {%- for block in section.blocks -%}
        <a href="{{ block.settings.link }}" {{ block.shopify_attributes }}>
          {{ block.settings.label }}
        </a>
      {%- endfor -%}
    </nav>
    <div class="site-header__actions">
      <a class="btn btn--primary" href="{{ section.settings.cta_link | default: '/pages/contact' }}">
        {{ section.settings.cta_label }}
      </a>
      <button type="button" class="btn btn--secondary header-nav-toggle" data-nav-toggle aria-expanded="false" aria-controls="site-nav">
        {{ 'general.menu' | t }}
      </button>
    </div>
  </div>
</header>

{% schema %}
{
  "name": "Header",
  "settings": [
    { "type": "text", "id": "brand_text", "label": "Merknaam", "default": "" },
    { "type": "text", "id": "cta_label", "label": "CTA-tekst", "default": "Contact" },
    { "type": "url", "id": "cta_link", "label": "CTA-link" }
  ],
  "blocks": [
    {
      "type": "nav_item",
      "name": "Navigatie-item",
      "settings": [
        { "type": "text", "id": "label", "label": "Label" },
        { "type": "url", "id": "link", "label": "Link" }
      ]
    }
  ],
  "presets": [{ "name": "Header" }]
}
{% endschema %}
`;
  return { path: "sections/header.liquid", content: liquid };
}

function buildFooterSection(): ThemeFile {
  const liquid = `<footer class="site-footer">
  <div class="container site-footer__inner">
    <div>
      <p>{{ section.settings.about_text }}</p>
    </div>
    <div>
      {%- if section.settings.phone != blank -%}
        <p>{{ 'contact.call_us' | t }}: <a href="tel:{{ section.settings.phone | remove: ' ' }}">{{ section.settings.phone }}</a></p>
      {%- endif -%}
      {%- if section.settings.email != blank -%}
        <p>{{ 'contact.email_us' | t }}: <a href="mailto:{{ section.settings.email }}">{{ section.settings.email }}</a></p>
      {%- endif -%}
      {%- if section.settings.address != blank -%}
        <p>{{ 'contact.visit_us' | t }}: {{ section.settings.address }}</p>
      {%- endif -%}
    </div>
    <div>
      <p>&copy; {{ 'now' | date: '%Y' }} {{ shop.name }}. {{ section.settings.tagline }}</p>
    </div>
  </div>
</footer>

{% schema %}
{
  "name": "Footer",
  "settings": [
    { "type": "textarea", "id": "about_text", "label": "Korte omschrijving" },
    { "type": "text", "id": "tagline", "label": "Slotregel" },
    { "type": "text", "id": "phone", "label": "Telefoonnummer" },
    { "type": "text", "id": "email", "label": "E-mailadres" },
    { "type": "text", "id": "address", "label": "Adres" }
  ],
  "presets": [{ "name": "Footer" }]
}
{% endschema %}
`;
  return { path: "sections/footer.liquid", content: liquid };
}

function buildHeroSection(): ThemeFile {
  const liquid = `<section class="hero">
  <div class="container">
    <div class="hero__inner">
      {%- if section.settings.eyebrow != blank -%}
        <p class="hero__eyebrow">{{ section.settings.eyebrow }}</p>
      {%- endif -%}
      <h1>{{ section.settings.heading }}</h1>
      {%- if section.settings.subheading != blank -%}
        <p>{{ section.settings.subheading }}</p>
      {%- endif -%}
      <div class="hero__actions">
        <a class="btn btn--primary" href="{{ section.settings.cta_link | default: '/pages/contact' }}">{{ section.settings.cta_label }}</a>
        {%- if section.settings.cta_secondary_label != blank -%}
          <a class="btn btn--secondary" href="{{ section.settings.cta_secondary_link | default: '#main-content' }}">{{ section.settings.cta_secondary_label }}</a>
        {%- endif -%}
      </div>
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Hero",
  "settings": [
    { "type": "text", "id": "eyebrow", "label": "Label boven de kop" },
    { "type": "text", "id": "heading", "label": "Hoofdkop" },
    { "type": "textarea", "id": "subheading", "label": "Subkop" },
    { "type": "text", "id": "cta_label", "label": "CTA-tekst" },
    { "type": "url", "id": "cta_link", "label": "CTA-link" },
    { "type": "text", "id": "cta_secondary_label", "label": "Secondaire CTA-tekst" },
    { "type": "url", "id": "cta_secondary_link", "label": "Secondaire CTA-link" }
  ],
  "presets": [{ "name": "Hero" }]
}
{% endschema %}
`;
  return { path: "sections/hero.liquid", content: liquid };
}

function buildServicesSection(): ThemeFile {
  const liquid = `<section class="section">
  <div class="container">
    <div class="section__header">
      <h2>{{ section.settings.heading }}</h2>
      {%- if section.settings.subheading != blank -%}
        <p>{{ section.settings.subheading }}</p>
      {%- endif -%}
    </div>
    <div class="card-grid">
      {%- for block in section.blocks -%}
        <article class="card" {{ block.shopify_attributes }}>
          <h3>{{ block.settings.title }}</h3>
          {%- if block.settings.description != blank -%}
            <p>{{ block.settings.description }}</p>
          {%- endif -%}
        </article>
      {%- endfor -%}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Diensten",
  "settings": [
    { "type": "text", "id": "heading", "label": "Kop", "default": "Onze diensten" },
    { "type": "textarea", "id": "subheading", "label": "Subkop" }
  ],
  "blocks": [
    {
      "type": "service",
      "name": "Dienst",
      "settings": [
        { "type": "text", "id": "title", "label": "Titel" },
        { "type": "textarea", "id": "description", "label": "Omschrijving" }
      ]
    }
  ],
  "presets": [
    { "name": "Diensten", "blocks": [{ "type": "service" }, { "type": "service" }, { "type": "service" }] }
  ]
}
{% endschema %}
`;
  return { path: "sections/services.liquid", content: liquid };
}

function buildAboutSection(): ThemeFile {
  const liquid = `<section class="section section--surface">
  <div class="container">
    <div class="section__header">
      <h2>{{ section.settings.heading }}</h2>
    </div>
    <div class="rte">
      {{ section.settings.body }}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Over ons",
  "settings": [
    { "type": "text", "id": "heading", "label": "Kop", "default": "Over ons" },
    { "type": "richtext", "id": "body", "label": "Tekst" }
  ],
  "presets": [{ "name": "Over ons" }]
}
{% endschema %}
`;
  return { path: "sections/about.liquid", content: liquid };
}

function buildBenefitsSection(): ThemeFile {
  const liquid = `<section class="section">
  <div class="container">
    <div class="section__header">
      <h2>{{ section.settings.heading }}</h2>
    </div>
    <div class="card-grid">
      {%- for block in section.blocks -%}
        <article class="card" {{ block.shopify_attributes }}>
          <p style="margin:0;font-size:1.4rem;color:var(--color-accent);font-weight:700;">{{ forloop.index }}</p>
          <h3>{{ block.settings.text }}</h3>
        </article>
      {%- endfor -%}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Voordelen",
  "settings": [
    { "type": "text", "id": "heading", "label": "Kop", "default": "Waarom klanten voor ons kiezen" }
  ],
  "blocks": [
    {
      "type": "benefit",
      "name": "Voordeel",
      "settings": [{ "type": "text", "id": "text", "label": "Voordeel" }]
    }
  ],
  "presets": [
    { "name": "Voordelen", "blocks": [{ "type": "benefit" }, { "type": "benefit" }, { "type": "benefit" }] }
  ]
}
{% endschema %}
`;
  return { path: "sections/benefits.liquid", content: liquid };
}

function buildFaqSection(): ThemeFile {
  const liquid = `<section class="section section--surface">
  <div class="container">
    <div class="section__header">
      <h2>{{ section.settings.heading }}</h2>
    </div>
    <div class="faq-list">
      {%- for block in section.blocks -%}
        <details class="faq-item" {{ block.shopify_attributes }}>
          <summary>{{ block.settings.question }}</summary>
          <div class="faq-item__body">{{ block.settings.answer }}</div>
        </details>
      {%- endfor -%}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "FAQ",
  "settings": [
    { "type": "text", "id": "heading", "label": "Kop", "default": "Veelgestelde vragen" }
  ],
  "blocks": [
    {
      "type": "question",
      "name": "Vraag",
      "settings": [
        { "type": "text", "id": "question", "label": "Vraag" },
        { "type": "richtext", "id": "answer", "label": "Antwoord" }
      ]
    }
  ],
  "presets": [{ "name": "FAQ", "blocks": [{ "type": "question" }, { "type": "question" }] }]
}
{% endschema %}
`;
  return { path: "sections/faq.liquid", content: liquid };
}

function buildCtaSection(): ThemeFile {
  const liquid = `<section class="section">
  <div class="container">
    <div class="section__header" style="text-align:center;margin-inline:auto;">
      <h2>{{ section.settings.heading }}</h2>
      {%- if section.settings.subheading != blank -%}
        <p>{{ section.settings.subheading }}</p>
      {%- endif -%}
      <p style="margin-top:20px;">
        <a class="btn btn--primary" href="{{ section.settings.cta_link | default: '/pages/contact' }}">{{ section.settings.cta_label }}</a>
      </p>
    </div>
  </div>
</section>

{% schema %}
{
  "name": "CTA",
  "settings": [
    { "type": "text", "id": "heading", "label": "Kop" },
    { "type": "textarea", "id": "subheading", "label": "Subkop" },
    { "type": "text", "id": "cta_label", "label": "CTA-tekst" },
    { "type": "url", "id": "cta_link", "label": "CTA-link" }
  ],
  "presets": [{ "name": "CTA" }]
}
{% endschema %}
`;
  return { path: "sections/cta.liquid", content: liquid };
}

function buildContactSection(): ThemeFile {
  const liquid = `<section class="section section--surface" id="contact">
  <div class="container">
    <div class="section__header">
      <h2>{{ section.settings.heading }}</h2>
      {%- if section.settings.intro != blank -%}
        <p>{{ section.settings.intro }}</p>
      {%- endif -%}
    </div>
    <div style="display:grid;gap:32px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));">
      <div>
        {%- if section.settings.phone != blank -%}
          <p><strong>{{ 'contact.call_us' | t }}:</strong> <a href="tel:{{ section.settings.phone | remove: ' ' }}">{{ section.settings.phone }}</a></p>
        {%- endif -%}
        {%- if section.settings.email != blank -%}
          <p><strong>{{ 'contact.email_us' | t }}:</strong> <a href="mailto:{{ section.settings.email }}">{{ section.settings.email }}</a></p>
        {%- endif -%}
        {%- if section.settings.address != blank -%}
          <p><strong>{{ 'contact.visit_us' | t }}:</strong> {{ section.settings.address }}</p>
        {%- endif -%}
      </div>
      {%- if section.settings.show_form -%}
        {%- form 'contact' -%}
          <div class="form">
            <div class="field">
              <label for="ContactFormName">{{ 'contact.name' | t }}</label>
              <input type="text" id="ContactFormName" name="contact[name]" required autocomplete="name">
            </div>
            <div class="field">
              <label for="ContactFormEmail">{{ 'contact.email' | t }}</label>
              <input type="email" id="ContactFormEmail" name="contact[email]" required autocomplete="email">
            </div>
            <div class="field">
              <label for="ContactFormPhone">{{ 'contact.phone' | t }}</label>
              <input type="tel" id="ContactFormPhone" name="contact[phone]" autocomplete="tel">
            </div>
            <div class="field">
              <label for="ContactFormMessage">{{ 'contact.message' | t }}</label>
              <textarea id="ContactFormMessage" name="contact[body]" rows="5" required></textarea>
            </div>
            {%- if form.posted_successfully? -%}
              <p class="form__status form__status--success" role="status">{{ 'contact.success' | t }}</p>
            {%- elsif form.errors -%}
              <p class="form__status form__status--error" role="alert">{{ 'contact.error' | t }}</p>
            {%- endif -%}
            <div>
              <button type="submit" class="btn btn--primary">{{ 'contact.submit' | t }}</button>
            </div>
          </div>
        {%- endform -%}
      {%- endif -%}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Contact",
  "settings": [
    { "type": "text", "id": "heading", "label": "Kop", "default": "Contact" },
    { "type": "textarea", "id": "intro", "label": "Introductietekst" },
    { "type": "text", "id": "phone", "label": "Telefoonnummer" },
    { "type": "text", "id": "email", "label": "E-mailadres" },
    { "type": "text", "id": "address", "label": "Adres" },
    { "type": "checkbox", "id": "show_form", "label": "Contactformulier tonen", "default": true }
  ],
  "presets": [{ "name": "Contact" }]
}
{% endschema %}
`;
  return { path: "sections/contact.liquid", content: liquid };
}

function buildRichTextSection(): ThemeFile {
  const liquid = `<section class="section">
  <div class="container">
    <div class="rte" style="max-width:760px;">
      {{ section.settings.body }}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Tekst",
  "settings": [
    { "type": "richtext", "id": "body", "label": "Tekst" }
  ],
  "presets": [{ "name": "Tekst" }]
}
{% endschema %}
`;
  return { path: "sections/rich-text.liquid", content: liquid };
}

function buildMainPageSection(): ThemeFile {
  const liquid = `<section class="section">
  <div class="container">
    <div class="section__header">
      <h1>{{ page.title }}</h1>
    </div>
    <div class="rte" style="max-width:760px;">
      {{ page.content }}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Pagina",
  "settings": [],
  "enabled_on": { "templates": ["page"] }
}
{% endschema %}
`;
  return { path: "sections/main-page.liquid", content: liquid };
}

function buildMain404Section(): ThemeFile {
  const liquid = `<section class="error-404">
  <div class="container">
    <h1>404</h1>
    <p><strong>{{ 'error_404.title' | t }}</strong></p>
    <p>{{ 'error_404.subtext' | t }}</p>
    <p style="margin-top:24px;">
      <a class="btn btn--primary" href="/">{{ 'general.back_home' | t }}</a>
    </p>
  </div>
</section>

{% schema %}
{
  "name": "404",
  "settings": [],
  "enabled_on": { "templates": ["404"] }
}
{% endschema %}
`;
  return { path: "sections/main-404.liquid", content: liquid };
}

function buildMainProductSection(): ThemeFile {
  const liquid = `<section class="section">
  <div class="container">
    <div style="display:grid;gap:40px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:start;">
      <div>
        {{ product.featured_image | image_url: width: 800 | image_tag: widths: '300, 500, 800', alt: product.featured_image.alt | default: product.title }}
      </div>
      <div>
        <h1>{{ product.title }}</h1>
        {%- if product.vendor != blank -%}
          <p style="color:var(--color-muted);">{{ 'products.vendor' | t }}: {{ product.vendor }}</p>
        {%- endif -%}
        <p>
          {%- if product.compare_at_price > product.price -%}
            <s style="color:var(--color-muted);">{{ product.compare_at_price | money }}</s>
          {%- endif -%}
          <span class="price">{{ product.price | money }}</span>
        </p>
        {%- form 'product', product -%}
          <div class="form">
            <div class="field">
              <label for="Quantity">{{ 'products.quantity' | t }}</label>
              <input type="number" id="Quantity" name="quantity" value="1" min="1">
            </div>
            <div>
              <button type="submit" class="btn btn--primary" {% unless product.available %}disabled{% endunless %}>
                {%- if product.available -%}
                  {{ 'products.add_to_cart' | t }}
                {%- else -%}
                  {{ 'products.sold_out' | t }}
                {%- endif -%}
              </button>
            </div>
          </div>
        {%- endform -%}
        <div class="rte" style="margin-top:24px;">
          {{ product.description }}
        </div>
      </div>
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Product",
  "settings": [],
  "enabled_on": { "templates": ["product"] }
}
{% endschema %}
`;
  return { path: "sections/main-product.liquid", content: liquid };
}

function buildMainCollectionSection(): ThemeFile {
  const liquid = `<section class="section">
  <div class="container">
    <div class="section__header">
      <h1>{{ collection.title }}</h1>
      {%- if collection.description != blank -%}
        <p>{{ collection.description }}</p>
      {%- endif -%}
    </div>
    {%- paginate collection.products by 24 -%}
      {%- if collection.products.size > 0 -%}
        <div class="product-grid">
          {%- for product in collection.products -%}
            <article class="product-card">
              <a href="{{ product.url }}" class="product-card__media">
                {%- if product.featured_image -%}
                  {{ product.featured_image | image_url: width: 500 | image_tag: widths: '250, 500', alt: product.featured_image.alt | default: product.title, loading: 'lazy' }}
                {%- else -%}
                  <img src="{{ 'placeholder.svg' | asset_url }}" alt="" width="500" height="500" loading="lazy">
                {%- endif -%}
              </a>
              <div class="product-card__body">
                <a href="{{ product.url }}" class="product-card__title">{{ product.title }}</a>
                <span class="price">{{ product.price | money }}</span>
              </div>
            </article>
          {%- endfor -%}
        </div>
      {%- else -%}
        <p>{{ 'collections.empty' | t }}</p>
      {%- endif -%}
      {%- if paginate.pages > 1 -%}
        <div style="margin-top:32px;display:flex;gap:16px;justify-content:center;">
          {%- if paginate.previous -%}
            <a href="{{ paginate.previous.url }}">&larr;</a>
          {%- endif -%}
          {%- if paginate.next -%}
            <a href="{{ paginate.next.url }}">&rarr;</a>
          {%- endif -%}
        </div>
      {%- endif -%}
    {%- endpaginate -%}
  </div>
</section>

{% schema %}
{
  "name": "Collectie",
  "settings": [],
  "enabled_on": { "templates": ["collection"] }
}
{% endschema %}
`;
  return { path: "sections/main-collection.liquid", content: liquid };
}

function buildMainCartSection(): ThemeFile {
  const liquid = `<section class="section">
  <div class="container">
    <div class="section__header">
      <h1>{{ 'cart.title' | t }}</h1>
    </div>
    {%- if cart.item_count > 0 -%}
      {%- form 'cart', cart -%}
        <table class="cart-table">
          <thead>
            <tr>
              <th scope="col">{{ 'cart.product' | t }}</th>
              <th scope="col">{{ 'cart.quantity' | t }}</th>
              <th scope="col">{{ 'cart.total' | t }}</th>
            </tr>
          </thead>
          <tbody>
            {%- for item in cart.items -%}
              <tr>
                <td>
                  <a href="{{ item.url }}">{{ item.product.title }}</a>
                  {%- if item.variant.title != 'Default Title' -%}
                    <small style="display:block;color:var(--color-muted);">{{ item.variant.title }}</small>
                  {%- endif -%}
                </td>
                <td>
                  <input type="number" name="updates[]" value="{{ item.quantity }}" min="0" aria-label="{{ 'cart.quantity' | t }}" style="width:72px;padding:8px;border:1px solid var(--color-border);border-radius:var(--radius);">
                </td>
                <td>{{ item.final_line_price | money }}</td>
              </tr>
            {%- endfor -%}
          </tbody>
        </table>
        <p style="margin-top:20px;font-weight:700;">{{ 'cart.subtotal' | t }}: {{ cart.total_price | money }}</p>
        <p style="color:var(--color-muted);font-size:.9rem;">{{ 'cart.taxes_note' | t }}</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;">
          <button type="submit" name="update" class="btn btn--secondary">{{ 'cart.remove' | t }}</button>
          <button type="submit" name="checkout" class="btn btn--primary">{{ 'cart.checkout' | t }}</button>
        </div>
      {%- endform -%}
    {%- else -%}
      <p>{{ 'cart.empty' | t }}</p>
      <p style="margin-top:16px;">
        <a class="btn btn--primary" href="{{ routes.all_products_collection_url }}">{{ 'cart.continue_shopping' | t }}</a>
      </p>
    {%- endif -%}
  </div>
</section>

{% schema %}
{
  "name": "Winkelwagen",
  "settings": [],
  "enabled_on": { "templates": ["cart"] }
}
{% endschema %}
`;
  return { path: "sections/main-cart.liquid", content: liquid };
}

function buildMainSearchSection(): ThemeFile {
  const liquid = `<section class="section">
  <div class="container">
    <div class="section__header">
      <h1>{{ 'search.title' | t }}</h1>
    </div>
    <form action="{{ routes.search_url }}" method="get" role="search" class="form" style="max-width:480px;">
      <div class="field">
        <label for="SearchInput">{{ 'search.placeholder' | t }}</label>
        <input type="search" id="SearchInput" name="q" value="{{ search.terms | escape }}">
      </div>
      <div>
        <button type="submit" class="btn btn--primary">{{ 'search.submit' | t }}</button>
      </div>
    </form>
    {%- if search.performed -%}
      <p style="margin-top:24px;">
        {{ 'search.results_count' | t: count: search.results_count }}
      </p>
      {%- if search.results_count > 0 -%}
        <div class="product-grid" style="margin-top:20px;">
          {%- for item in search.results -%}
            <article class="product-card">
              {%- if item.object_type == 'product' -%}
                <a href="{{ item.url }}" class="product-card__media">
                  {%- if item.featured_image -%}
                    {{ item.featured_image | image_url: width: 500 | image_tag: widths: '250, 500', alt: item.title, loading: 'lazy' }}
                  {%- endif -%}
                </a>
                <div class="product-card__body">
                  <a href="{{ item.url }}" class="product-card__title">{{ item.title }}</a>
                  {%- if item.price -%}
                    <span class="price">{{ item.price | money }}</span>
                  {%- endif -%}
                </div>
              {%- else -%}
                <div class="product-card__body">
                  <a href="{{ item.url }}" class="product-card__title">{{ item.title }}</a>
                </div>
              {%- endif -%}
            </article>
          {%- endfor -%}
        </div>
      {%- else -%}
        <p style="margin-top:16px;">{{ 'search.no_results' | t }}</p>
      {%- endif -%}
    {%- endif -%}
  </div>
</section>

{% schema %}
{
  "name": "Zoeken",
  "settings": [],
  "enabled_on": { "templates": ["search"] }
}
{% endschema %}
`;
  return { path: "sections/main-search.liquid", content: liquid };
}

// ---------------------------------------------------------------------------
// Section groups + templates (JSON)
// ---------------------------------------------------------------------------

function jsonFile(path: string, data: unknown): ThemeFile {
  return { path, content: `${JSON.stringify(data, null, 2)}\n` };
}

interface HeaderGroupInput {
  businessName: string;
  navItems: { label: string; url: string }[];
  ctaLabel: string;
}

function buildHeaderGroup(input: HeaderGroupInput): ThemeFile {
  return jsonFile("sections/header-group.json", {
    type: "header",
    sections: {
      header: {
        type: "header",
        settings: {
          brand_text: input.businessName,
          cta_label: input.ctaLabel,
        },
        blocks: Object.fromEntries(
          input.navItems.map((item, index) => [
            `nav-${index + 1}`,
            { type: "nav_item", settings: { label: item.label, link: item.url } },
          ])
        ),
        block_order: input.navItems.map((_, i) => `nav-${i + 1}`),
      },
    },
    order: ["header"],
  });
}

function buildFooterGroup(input: {
  businessName: string;
  tagline: string;
  contact: WebsiteContactContext;
}): ThemeFile {
  return jsonFile("sections/footer-group.json", {
    type: "footer",
    sections: {
      footer: {
        type: "footer",
        settings: {
          about_text: `${input.businessName}${input.contact.city ? ` — ${input.contact.city}` : ""}`,
          tagline: input.tagline,
          phone: input.contact.phone,
          email: input.contact.email,
          address: input.contact.address,
        },
      },
    },
    order: ["footer"],
  });
}

function homePageSectionInstances(spec: WebsiteSpecification, contact: WebsiteContactContext) {
  const sections: Record<string, Record<string, unknown>> = {};
  const order: string[] = [];

  sections.hero = {
    type: "hero",
    settings: {
      eyebrow: spec.seo.localArea ?? `${spec.business.industry} in ${spec.business.city}`,
      heading: spec.content.headline,
      subheading: spec.content.subheadline ?? spec.content.valueProposition,
      cta_label: spec.content.ctaPrimaryText,
      cta_link: "/pages/contact",
      cta_secondary_label: spec.content.ctaSecondaryText,
      cta_secondary_link: "#main-content",
    },
  };
  order.push("hero");

  if (spec.content.services.length > 0) {
    sections.services = {
      type: "services",
      settings: { heading: "Onze diensten", subheading: null },
      blocks: Object.fromEntries(
        spec.content.services.map((s, i) => [
          `service-${i + 1}`,
          { type: "service", settings: { title: s.title, description: s.description } },
        ])
      ),
      block_order: spec.content.services.map((_, i) => `service-${i + 1}`),
    };
    order.push("services");
  }

  if (spec.content.about) {
    sections.about = {
      type: "about",
      settings: { heading: `Over ${spec.business.businessName}`, body: `<p>${escapeHtml(spec.content.about)}</p>` },
    };
    order.push("about");
  }

  if (spec.content.benefits.length > 0) {
    sections.benefits = {
      type: "benefits",
      settings: { heading: "Waarom klanten voor ons kiezen" },
      blocks: Object.fromEntries(
        spec.content.benefits.map((b, i) => [`benefit-${i + 1}`, { type: "benefit", settings: { text: b } }])
      ),
      block_order: spec.content.benefits.map((_, i) => `benefit-${i + 1}`),
    };
    order.push("benefits");
  }

  if (spec.content.faq.length > 0) {
    sections.faq = {
      type: "faq",
      settings: { heading: "Veelgestelde vragen" },
      blocks: Object.fromEntries(
        spec.content.faq.map((f, i) => [
          `question-${i + 1}`,
          { type: "question", settings: { question: f.question, answer: `<p>${escapeHtml(f.answer)}</p>` } },
        ])
      ),
      block_order: spec.content.faq.map((_, i) => `question-${i + 1}`),
    };
    order.push("faq");
  }

  sections.cta = {
    type: "cta",
    settings: {
      heading: spec.content.ctaPrimaryText,
      subheadline: spec.content.contactIntro,
      cta_label: spec.content.ctaPrimaryText,
      cta_link: "/pages/contact",
    },
  };
  order.push("cta");

  sections.contact = {
    type: "contact",
    settings: {
      heading: "Contact",
      intro: spec.content.contactIntro,
      phone: contact.phone,
      email: contact.email,
      address: [contact.address, contact.city].filter(Boolean).join(", ") || null,
      show_form: true,
    },
  };
  order.push("contact");

  return { sections, order };
}

function contactPageTemplate(spec: WebsiteSpecification, contact: WebsiteContactContext): { path: string; data: unknown } {
  const { sections } = homePageSectionInstances(spec, contact);
  // Contactpagina: alleen de contactsectie (geen homepage-compositie).
  return {
    path: "templates/page.contact.json",
    data: {
      sections: { contact: sections.contact },
      order: ["contact"],
    },
  };
}

// ---------------------------------------------------------------------------
// Hoofdexport
// ---------------------------------------------------------------------------

export interface BuildThemeInput {
  specification: WebsiteSpecification;
  designPlan: DesignPlan;
  contact: WebsiteContactContext;
}

export interface BuiltTheme {
  files: ThemeFile[];
  notes: string[];
}

/**
 * Bouwt het complete thema. Volledig deterministisch: dezelfde input levert
 * byte-identieke output. Content komt uitsluitend uit de gevalideerde
 * specification + echte contactgegevens; het ontwerp komt uitsluitend uit
 * het Design Plan.
 */
export function buildShopifyTheme(input: BuildThemeInput): BuiltTheme {
  const { specification: spec, designPlan: plan, contact } = input;
  const tokens = buildThemeDesignTokens(plan);
  const files: ThemeFile[] = [];
  const notes: string[] = [];

  // --- Config + layout + assets + locales
  files.push(buildSettingsSchema(spec.business.businessName));
  files.push(buildSettingsData(tokens));
  files.push(buildThemeLayout(spec, tokens));
  files.push(buildMetaTagsSnippet());
  files.push(buildButtonSnippet());
  files.push(buildThemeCss(tokens));
  files.push(buildThemeJs());
  files.push(buildPlaceholderSvg(tokens));
  files.push(buildLocaleFile());

  // --- Sections
  files.push(buildHeaderSection());
  files.push(buildFooterSection());
  files.push(buildHeroSection());
  files.push(buildServicesSection());
  files.push(buildAboutSection());
  files.push(buildBenefitsSection());
  files.push(buildFaqSection());
  files.push(buildCtaSection());
  files.push(buildContactSection());
  files.push(buildRichTextSection());
  files.push(buildMainPageSection());
  files.push(buildMain404Section());
  files.push(buildMainProductSection());
  files.push(buildMainCollectionSection());
  files.push(buildMainCartSection());
  files.push(buildMainSearchSection());

  // --- Header/footer-groups (nav uit het Design Plan)
  const pageKeyHome = new Set(["home", "index", "start", "homepage"]);
  const navItems = plan.navigation.items.map((item) => ({
    label: item.label,
    url: pageKeyHome.has(item.pageKey.toLowerCase()) ? "/" : `/pages/${slugifyKey(item.pageKey)}`,
  }));
  files.push(
    buildHeaderGroup({
      businessName: spec.business.businessName,
      navItems,
      ctaLabel: spec.content.ctaPrimaryText,
    })
  );
  files.push(
    buildFooterGroup({
      businessName: spec.business.businessName,
      tagline: spec.seo.localArea ? `Actief in ${spec.seo.localArea}.` : "",
      contact,
    })
  );

  // --- Templates: homepage-compositie
  const home = homePageSectionInstances(spec, contact);
  files.push(jsonFile("templates/index.json", { sections: home.sections, order: home.order }));

  // --- Templates: contactpagina (altijd, met échte contactgegevens)
  const contactPage = contactPageTemplate(spec, contact);
  files.push(jsonFile(contactPage.path, contactPage.data));

  // --- Templates: subpagina's uit het Design Plan (home-contact al gedaan)
  const plannedKeys = new Set<string>(["contact"]);
  for (const page of plan.pageStructure) {
    const key = page.key.trim();
    if (pageKeyHome.has(key.toLowerCase())) continue;
    const slugKey = slugifyKey(key);
    if (plannedKeys.has(slugKey)) continue;
    plannedKeys.add(slugKey);
    files.push(
      jsonFile(`templates/page.${slugKey}.json`, {
        sections: {
          main: {
            type: "main-page",
            settings: {},
          },
        },
        order: ["main"],
      })
    );
    notes.push(
      `Pagina "${page.title ?? key}" wordt als lege, bewerkbare Shopify-pagina aangeleverd (template page.${slugKey}) — content volgt in de revisierondes, er wordt niets verzonnen.`
    );
  }

  // --- Templates: standaardpagina + systeempagina's
  files.push(jsonFile("templates/page.json", { sections: { main: { type: "main-page", settings: {} } }, order: ["main"] }));
  files.push(jsonFile("templates/404.json", { sections: { main: { type: "main-404", settings: {} } }, order: ["main"] }));
  files.push(jsonFile("templates/product.json", { sections: { main: { type: "main-product", settings: {} } }, order: ["main"] }));
  files.push(jsonFile("templates/collection.json", { sections: { main: { type: "main-collection", settings: {} } }, order: ["main"] }));
  files.push(jsonFile("templates/cart.json", { sections: { main: { type: "main-cart", settings: {} } }, order: ["main"] }));
  files.push(jsonFile("templates/search.json", { sections: { main: { type: "main-search", settings: {} } }, order: ["main"] }));

  if (spec.missingInformation.length > 0) {
    notes.push(
      `${spec.missingInformation.length} ontbrekende informatiepunten uit de specification zijn bewust placeholder gelaten (geen fabricatie).`
    );
  }

  return { files, notes };
}
