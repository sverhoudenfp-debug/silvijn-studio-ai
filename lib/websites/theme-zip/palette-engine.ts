import type { PaletteMood } from "../visual-contract";

/**
 * PALETTE ENGINE (Design Token Engine D1, 2026-09-21) — HSL-gebaseerde
 * paletbouw + WCAG-contrastguard.
 *
 * ARCHITECTUUR: puur en deterministisch (geen random, geen externe lib).
 * De engine breedt de 3 plankleuren (primary/secondary/accent) en de
 * neutrale waarden uit het Design Plan uit tot een consistente, op
 * tekstcontrast gecontroleerde set, waarbij de stemmingskeuze
 * (paletteMood) de neutrale tinten kleurt. Correcties zijn MINIMAAL en
 * gedocumenteerd: de engine verduistert/verlicht uitsluitend zo ver als
 * WCAG AA vereist; merkidentity-kleuren worden nooit weggegooid.
 *
 * BACKWARD COMPATIBLE: bij afwezig visualContract past de theme-builder
 * deze engine NIET toe — plannen zonder contract renderen exact als
 * voorheen (zie buildThemeDesignTokens).
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface Hsl {
  /** 0-360 */
  readonly h: number;
  /** 0-100 */
  readonly s: number;
  /** 0-100 */
  readonly l: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) throw new Error(`palette-engine: ongeldige hex "${hex}"`);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h = h * 60;
  }
  // Geen afronding: hex→HSL→hex moet roundtrip-exact zijn (determinisme).
  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rn = 0;
  let gn = 0;
  let bn = 0;
  if (hp < 1) [rn, gn, bn] = [c, x, 0];
  else if (hp < 2) [rn, gn, bn] = [x, c, 0];
  else if (hp < 3) [rn, gn, bn] = [0, c, x];
  else if (hp < 4) [rn, gn, bn] = [0, x, c];
  else if (hp < 5) [rn, gn, bn] = [x, 0, c];
  else [rn, gn, bn] = [c, 0, x];
  const m = ln - c / 2;
  return { r: (rn + m) * 255, g: (gn + m) * 255, b: (bn + m) * 255 };
}

export function hexToHsl(hex: string): Hsl {
  return rgbToHsl(hexToRgb(hex));
}

export function hslToHex(hsl: Hsl): string {
  return rgbToHex(hslToRgb(hsl));
}

/** Relatieve luminantie volgens WCAG 2.x. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (v: number) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrastverhouding volgens WCAG (1.0 - 21.0). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Duistert/verlicht een kleur in HSL-lichtheid tot het AA-contrast op de
 * achtergrond gehaald is. Deterministisch: stapt in lichtheidstappen van
 * 2 en kiest de dichtstbijzijnde passende waarde; randen (0/100) stoppen
 * de loop. Zoekt richting "donkerder op lichte achtergrond, lichter op
 * donkere achtergrond" op basis van de huidige verhouding.
 */
export function enforceContrast(
  colorHex: string,
  backgroundHex: string,
  minRatio: number,
  direction: "auto" | "darken" | "lighten" = "auto"
): { hex: string; corrected: boolean; ratio: number } {
  const original = contrastRatio(colorHex, backgroundHex);
  if (original >= minRatio) return { hex: colorHex, corrected: false, ratio: original };

  const bgL = hexToHsl(backgroundHex).l;
  const dir = direction === "auto" ? (bgL >= 50 ? "darken" : "lighten") : direction;
  const hsl = hexToHsl(colorHex);
  let best = colorHex;
  let bestRatio = original;
  for (let step = 1; step <= 100; step += 1) {
    const l = clamp(hsl.l + (dir === "darken" ? -step * 2 : step * 2), 0, 100);
    const candidate = hslToHex({ h: hsl.h, s: hsl.s, l });
    const ratio = contrastRatio(candidate, backgroundHex);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
    if (bestRatio >= minRatio) break;
    if (l === 0 || l === 100) break;
  }
  return { hex: best, corrected: best !== colorHex, ratio: contrastRatio(best, backgroundHex) };
}

/** Stemming van de neutrale tinten: deterministische HSL-delta's per mood. */
interface MoodDelta {
  /** Doelverzadiging (0-100) voor background/surface/border. */
  readonly saturation: number;
  /** Lichtheidsdelta (percentpunten) op surface t.o.v. basis. */
  readonly surfaceLightnessDelta: number;
  /** Verdiept de achtergrond licht (percentpunten onder 100). */
  readonly backgroundLightness: number;
  /** Kleurbron voor de tint: "primary" (hue van primary) of "fixed" (hue hieronder). */
  readonly hueSource: "primary" | "fixed";
  /** Vaste tint wanneer hueSource=fixed. */
  readonly fixedHue?: number;
}

const MOOD_DELTAS: Readonly<Record<PaletteMood, MoodDelta>> = {
  warm_organic: { saturation: 14, surfaceLightnessDelta: 0, backgroundLightness: 99, hueSource: "primary" },
  cool_professional: { saturation: 14, surfaceLightnessDelta: 0, backgroundLightness: 99, hueSource: "fixed", fixedHue: 215 },
  premium_dark: { saturation: 16, surfaceLightnessDelta: -3, backgroundLightness: 96, hueSource: "primary" },
  fresh_light: { saturation: 14, surfaceLightnessDelta: 2, backgroundLightness: 100, hueSource: "fixed", fixedHue: 200 },
  earthy_natural: { saturation: 14, surfaceLightnessDelta: 0, backgroundLightness: 98, hueSource: "primary" },
  bold_contrast: { saturation: 0, surfaceLightnessDelta: -2, backgroundLightness: 100, hueSource: "primary" },
  monochrome: { saturation: 0, surfaceLightnessDelta: 0, backgroundLightness: 100, hueSource: "primary" },
};

export interface PaletteEngineInput {
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly mutedText: string;
  readonly border: string;
  readonly mood: PaletteMood;
}

export interface PaletteEngineResult {
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly mutedText: string;
  readonly border: string;
  /** Deterministische correcties (voor logs/QC-rapportage; nooit stilzwijgend). */
  readonly corrections: readonly string[];
}

/**
 * Past de mood-tint toe op de neutrale waarden en dwingt daarna WCAG AA
 * af op de tekstrollen:
 * - text op background ≥ 4.5 (AA body text);
 * - mutedText op background ≥ 4.5 (gedempte lopende tekst);
 * - primary als tekstkleur (eyebrow/sectiekop-accent) op background ≥ 4.5;
 * - primary als knopvlak met witte knoptekst ≥ 4.5 (de knoppen renderen
 *   terecht met #fff — de guard verduistert primary indien nodig).
 * De hue van primary wordt nooit gewijzigd; uitsluitend lichtheid.
 */
export function derivePalette(input: PaletteEngineInput): PaletteEngineResult {
  const corrections: string[] = [];
  const mood = MOOD_DELTAS[input.mood];
  const primaryHue = hexToHsl(input.primary).h;
  const tintHue = mood.hueSource === "fixed" ? (mood.fixedHue ?? primaryHue) : primaryHue;

  // 1. Mood-tint op de neutrale waarden (alleen lichtheid/saturatie; de
  //    door de AI gekozen neutrals blijven herkenbaar aanwezig).
  const tinted = (hex: string, targetSaturation: number, lightnessDelta: number): string => {
    const hsl = hexToHsl(hex);
    const l = clamp(hsl.l + lightnessDelta, 0, 100);
    // De mood-saturatie is een VLOER: gekozen neutrals met meer kleur
    // blijven staan, bleuere worden naar het mood-niveau getild.
    const s = Math.max(hsl.s, targetSaturation);
    return hslToHex({ h: hsl.s <= 4 ? tintHue : hsl.h, s, l });
  };

  let background = tinted(input.background, mood.saturation, 0);
  // premium_dark/bold_contrast dalen de achtergrond exact naar de mood-waarde.
  background = hslToHex({ ...hexToHsl(background), l: mood.backgroundLightness });
  const surface = tinted(input.surface, mood.saturation, mood.surfaceLightnessDelta);
  const border = tinted(input.border, mood.saturation, 0);
  let text = input.text;
  let mutedText = tinted(input.mutedText, mood.saturation, 0);
  let primary = input.primary;
  let secondary = input.secondary;
  const accent = input.accent;

  // 2. WCAG-guard op de tekstrollen (tekst kleurt donkerder, nooit lichter).
  const textFix = enforceContrast(text, background, 4.5, "darken");
  if (textFix.corrected) {
    text = textFix.hex;
    corrections.push(
      `Tekstkleur aangepast voor WCAG AA-contrast op de achtergrond (was ${input.text}, nu ${text}).`
    );
  }
  const mutedFix = enforceContrast(mutedText, background, 4.5, "darken");
  if (mutedFix.corrected) {
    mutedText = mutedFix.hex;
    corrections.push(
      `Gedempte tekstkleur aangepast voor WCAG AA-contrast op de achtergrond (was ${input.mutedText}, nu ${mutedText}).`
    );
  }
  const primaryAsText = enforceContrast(primary, background, 4.5, "darken");
  const primaryOnWhite = enforceContrast(primary, "#ffffff", 4.5, "darken");
  // Eén primary moet beide rollen aan kunnen (tekst op achtergrond én
  // knopvlak met witte tekst): kies de donkerste van beide correcties.
  const candidates = [primaryAsText.hex, primaryOnWhite.hex];
  let chosen = primary;
  if (primaryAsText.corrected || primaryOnWhite.corrected) {
    chosen = candidates.reduce((dark, hex) => (hexToHsl(hex).l < hexToHsl(dark).l ? hex : dark), primary);
    chosen = enforceContrast(chosen, background, 4.5, "darken").hex;
    chosen = enforceContrast(chosen, "#ffffff", 4.5, "darken").hex;
    primary = chosen;
    corrections.push(
      `Primaire kleur licht verduisterd voor WCAG AA-contrast als tekst- én knopkleur (was ${input.primary}, nu ${primary}).`
    );
    // secondary volgt primary als het dezelfde hue-rol heeft (afgeleid uit primary).
    const secFix = enforceContrast(secondary, background, 3.0, "darken");
    if (secFix.corrected) {
      secondary = secFix.hex;
      corrections.push(
        `Secundaire kleur aangepast voor contrast op de achtergrond (was ${input.secondary}, nu ${secondary}).`
      );
    }
  }

  return { primary, secondary, accent, background, surface, text, mutedText, border, corrections };
}
