import type { ThemeDesignTokens } from "./theme-builder";
import type { PlaceholderVariant } from "./media-slots";
import type { ThemeFile } from "./theme-structure";

/**
 * Abstracte placeholder-SVG's (R1 — Media & beelden), volledig deterministisch
 * afgeleid uit de design tokens van het Design Plan.
 *
 * HARD REGELS:
 * - NOOIT foto-achtig, logo-achtig of extern: een placeholder is een duidelijk
 *   abstract vlak, zonder tekst en zonder externe verwijzingen. Niets
 *   simuleert een echte bedrijfsfoto (masterconfig: geen fabricatie).
 * - Kleuren komen UITSLUITEND uit de tokens — dezelfde input levert
 *   byte-identieke output.
 */

/** Verzacht een hexkleur richting wit (puur, geen externe lib). */
function tint(hex: string, factor: number): string {
  const value = hex.replace("#", "");
  const r = Math.round(parseInt(value.slice(0, 2), 16) * factor + 255 * (1 - factor));
  const g = Math.round(parseInt(value.slice(2, 4), 16) * factor + 255 * (1 - factor));
  const b = Math.round(parseInt(value.slice(4, 6), 16) * factor + 255 * (1 - factor));
  const to = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Abstracte placeholder — afbeelding volgt">
  ${body}
</svg>
`;
}

/**
 * Abstracte compositie per variant. Alle vormen zijn geometrisch; er zit
 * nooit tekst of herkenbaar beeld in.
 */
function compositionFor(
  variant: PlaceholderVariant,
  tokens: ThemeDesignTokens,
  w: number,
  h: number,
  id: string
): string {
  const { primary, secondary, accent, surface } = tokens;
  if (variant === "gradient_soft") {
    return `<defs>
    <linearGradient id="grad-${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${primary}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${secondary}" stop-opacity="0.35"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="${surface}"/>
  <rect width="${w}" height="${h}" fill="url(#grad-${id})"/>
  <circle cx="${w * 0.22}" cy="${h * 0.3}" r="${h * 0.22}" fill="${tint(primary, 0.7)}" opacity="0.5"/>
  <circle cx="${w * 0.78}" cy="${h * 0.72}" r="${h * 0.3}" fill="${tint(accent, 0.75)}" opacity="0.45"/>
  <rect x="${w * 0.6}" y="${h * 0.18}" width="${w * 0.16}" height="${h * 0.16}" rx="12" fill="${secondary}" opacity="0.4"/>`;
  }
  if (variant === "minimal_mono") {
    const line = tint(primary, 0.45);
    return `<rect width="${w}" height="${h}" fill="${surface}"/>
  <rect x="${w * 0.08}" y="${h * 0.18}" width="${w * 0.84}" height="2" fill="${line}"/>
  <rect x="${w * 0.08}" y="${h * 0.34}" width="${w * 0.84}" height="2" fill="${line}" opacity="0.7"/>
  <rect x="${w * 0.08}" y="${h * 0.5}" width="${w * 0.84}" height="2" fill="${line}" opacity="0.4"/>
  <rect x="${w * 0.08}" y="${h * 0.72}" width="${w * 0.3}" height="2" fill="${line}" opacity="0.25"/>
  <circle cx="${w * 0.5}" cy="${h * 0.62}" r="${h * 0.09}" fill="none" stroke="${line}" stroke-width="2"/>`;
  }
  // abstract_geometric — de standaardcompositie
  return `<rect width="${w}" height="${h}" fill="${surface}"/>
  <path d="M0 ${h} L0 ${h * 0.6} L${w * 0.45} 0 L${w * 0.72} 0 L0 ${h * 0.86} Z" fill="${primary}" opacity="0.16"/>
  <circle cx="${w * 0.76}" cy="${h * 0.34}" r="${h * 0.26}" fill="${primary}" opacity="0.12"/>
  <circle cx="${w * 0.76}" cy="${h * 0.34}" r="${h * 0.16}" fill="${accent}" opacity="0.22"/>
  <rect x="${w * 0.12}" y="${h * 0.66}" width="${w * 0.5}" height="${h * 0.2}" rx="14" fill="${secondary}" opacity="0.16"/>
  <path d="M${w * 0.55} ${h} L${w * 0.88} ${h * 0.5} L${w} ${h * 0.62} L${w} ${h} Z" fill="${primary}" opacity="0.1"/>`;
}

export interface PlaceholderSpec {
  /** Pad binnen de ZIP (assets/...). */
  path: string;
  /** viewBox-breedte. */
  width: number;
  /** viewBox-hoogte. */
  height: number;
  /** Unieke id voor SVG-defs (moet per bestand uniek zijn). */
  id: string;
}

/** Genereer één abstracte placeholder op basis van tokens + variant. */
export function buildPlaceholderSvgContent(
  variant: PlaceholderVariant,
  tokens: ThemeDesignTokens,
  spec: PlaceholderSpec
): string {
  return svg(spec.width, spec.height, compositionFor(variant, tokens, spec.width, spec.height, spec.id));
}

/**
 * Alle slot-placeholders voor een thema. Altijd gegenereerd als vaste set —
 * de sections verwijzen er deterministisch naar (asset_url-validatie dwingt
 * af dat de set compleet is).
 */
export function buildMediaPlaceholderSvgs(
  variant: PlaceholderVariant,
  tokens: ThemeDesignTokens
): ThemeFile[] {
  const specs: PlaceholderSpec[] = [
    { path: "assets/placeholder-hero.svg", width: 1600, height: 900, id: "hero" },
    { path: "assets/placeholder-about.svg", width: 1200, height: 900, id: "about" },
    { path: "assets/placeholder-service.svg", width: 900, height: 675, id: "service" },
    { path: "assets/placeholder-gallery.svg", width: 900, height: 900, id: "gallery" },
  ];
  return specs.map((spec) => ({
    path: spec.path,
    content: buildPlaceholderSvgContent(variant, tokens, spec),
  }));
}

/**
 * De generieke placeholder (product-cards, giftcard, e.d.) — bewust
 * achterhaald compatibiliteitsgedrag: bestaande sections blijven werken.
 */
export function buildGenericPlaceholderSvg(tokens: ThemeDesignTokens): ThemeFile {
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" role="img" aria-label="Placeholder-afbeelding">
  <rect width="800" height="500" fill="${tokens.surface}"/>
  <circle cx="400" cy="250" r="130" fill="${tokens.primary}" opacity="0.14"/>
  <circle cx="400" cy="250" r="80" fill="${tokens.accent}" opacity="0.2"/>
  <rect x="140" y="380" width="520" height="12" rx="6" fill="${tokens.primary}" opacity="0.18"/>
</svg>
`;
  return { path: "assets/placeholder.svg", content: svgContent };
}
