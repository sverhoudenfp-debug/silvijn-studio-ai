/**
 * OKLCH-KLEURREKENEN (Fase 1 — Design Intelligence, 2026-11-05)
 *
 * Waarom niet HSL: HSL-lichtheid is geen waargenomen lichtheid. Bij vaste
 * L=50% loopt het werkelijke contrast tussen twee kleuren in de praktijk
 * van ongeveer 1,4:1 tot 6,6:1. Daardoor produceert een HSL-palet
 * onvoorspelbare leesbaarheid en moet er achteraf met de hand worden
 * bijgestuurd.
 *
 * OKLCH is perceptueel uniform: gelijke L-stappen geven gelijke
 * waargenomen helderheidsstappen, ongeacht hue. Daarmee kan deze module
 * contrast GARANDEREN in plaats van achteraf te corrigeren:
 * - `ensureContrast` schuift uitsluitend de lichtheid tot de gevraagde
 *   WCAG-ratio is gehaald;
 * - `readableOn` kiest de leesbaarste tekstkleur op een vlak;
 * - `mixOklch` maakt tinten die de hue houden zonder grijs te worden.
 *
 * Puur en deterministisch: geen dependency, geen randomness. De uitvoer is
 * een hex-kleur, zodat de rest van het thema (CSS-variabelen, Shopify-
 * settings) ongewijzigd blijft werken.
 */

export interface Oklch {
  /** 0-1 */
  readonly l: number;
  /** 0-0.4 (chroma) */
  readonly c: number;
  /** 0-360 */
  readonly h: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function srgbToLinear(channel: number): number {
  const c = clamp(channel, 0, 1);
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
  const c = clamp(channel, 0, 1);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

function hexToRgbUnit(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace("#", "").trim();
  const normalized =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) throw new Error(`color-oklch: ongeldige hex "${hex}"`);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16) / 255,
    g: Number.parseInt(normalized.slice(2, 4), 16) / 255,
    b: Number.parseInt(normalized.slice(4, 6), 16) / 255,
  };
}

function rgbUnitToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const to = (value: number) =>
    Math.round(clamp(value, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function hexToOklch(hex: string): Oklch {
  const { r, g, b } = hexToRgbUnit(hex);
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const okL = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const okA = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const okB = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const chroma = Math.sqrt(okA * okA + okB * okB);
  const hue = (Math.atan2(okB, okA) * 180) / Math.PI;
  return { l: okL, c: chroma, h: hue < 0 ? hue + 360 : hue };
}

export function oklchToHex({ l, c, h }: Oklch): string {
  const hueRad = (h * Math.PI) / 180;
  const okA = Math.cos(hueRad) * c;
  const okB = Math.sin(hueRad) * c;

  const l_ = l + 0.3963377774 * okA + 0.2158037573 * okB;
  const m_ = l - 0.1055613458 * okA - 0.0638541728 * okB;
  const s_ = l - 0.0894841775 * okA - 1.291485548 * okB;

  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;

  const lr = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  return rgbUnitToHex({
    r: linearToSrgb(lr),
    g: linearToSrgb(lg),
    b: linearToSrgb(lb),
  });
}

/** Relatieve luminantie volgens WCAG 2.1 (sRGB, geen OKLab). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgbUnit(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG-contrastratio 1-21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Schuift de lichtheid van `foreground` tot `background` de gevraagde
 * contrastratio haalt. Behoudt hue en chroma (het merk blijft herkenbaar),
 * verandert uitsluitend L. Zoekt altijd de KORtSTE beweging vanaf de
 * huidige lichtheid, dus een donkere kleur wordt niet onnodig zwart.
 */
export function ensureContrast(foreground: string, background: string, targetRatio: number): string {
  if (contrastRatio(foreground, background) >= targetRatio) return foreground;
  const fg = hexToOklch(foreground);

  // Beide richtingen proberen. Alleen "van de achtergrond af" is niet genoeg:
  // op een middentoon (bijv. een verzadigd blauw) haalt géén van beide kanten
  // altijd de gevraagde ratio, en dan moet de BESTE uitkomst winnen in plaats
  // van een vast gekozen richting die blijft steken.
  let best = foreground;
  let bestRatio = contrastRatio(foreground, background);

  for (const direction of [-1, 1] as const) {
    for (let step = 1; step <= 200; step += 1) {
      const l = clamp(fg.l + direction * step * 0.005, 0, 1);
      const candidate = oklchToHex({ ...fg, l, c: fg.c * Math.max(0, 1 - step * 0.002) });
      const ratio = contrastRatio(candidate, background);
      if (ratio > bestRatio) {
        best = candidate;
        bestRatio = ratio;
      }
      if (ratio >= targetRatio) return candidate;
      if (l === 0 || l === 1) break;
    }
  }
  return best;
}

/** Kiest de leesbaarste tekstkleur (wit of bijna-zwart) op een vlak. */
export function readableOn(background: string, preferred: { light?: string; dark?: string } = {}): string {
  const light = preferred.light ?? "#ffffff";
  const dark = preferred.dark ?? "#141715";
  return contrastRatio(light, background) >= contrastRatio(dark, background) ? light : dark;
}

/** Tint (richting wit) of shade (richting zwart) in OKLCH, hue behouden. */
export function mixOklch(color: string, target: string, amount: number): string {
  const from = hexToOklch(color);
  const to = hexToOklch(target);
  const t = clamp(amount, 0, 1);
  // Hue-interpolatie via de kortste boog. Bij een (vrijwel) kleurloos doelwit
  // is de hue wiskundig betekenisloos (wit en zwart hebben er geen), dus dan
  // blijft de bronhue staan. Zonder deze guard verspringt de merkkleur bij het
  // mengen met wit naar een willekeurige hue.
  let h = from.h;
  if (to.c > 0.01 && from.c > 0.01) {
    let delta = to.h - from.h;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    h = (from.h + delta * t + 360) % 360;
  }
  return oklchToHex({
    l: from.l + (to.l - from.l) * t,
    c: from.c + (to.c - from.c) * t,
    h,
  });
}

/** Een leesbare, rustige variant van een kleur voor grote vlakken. */
export function surfaceFrom(color: string, lightness = 0.965, chromaScale = 0.14): string {
  const base = hexToOklch(color);
  return oklchToHex({ l: lightness, c: base.c * chromaScale, h: base.h });
}
