import type { DesignPlan } from "./design-plan";

/**
 * DESIGN DIRECTIONS (Fase 1 — Design Intelligence, 2026-11-05)
 *
 * Het probleem tot nu toe: het visualContract en artDirection zijn
 * enum-gesloten, maar bevatten geen MAAT. "Editorial" betekent in de praktijk
 * niets meer dan "dezelfde 2,4rem-kop met een andere marge", omdat de
 * verhoudingen nergens zijn vastgelegd. Een ontwerprichting zonder getallen
 * differentieert niet.
 *
 * Deze module maakt van een richting een MEETBARE tokenset:
 * - display/body-verhouding (het kenmerk dat editorial van minimalistisch
 *   onderscheidt, veel meer dan de schaalratio);
 * - regellengte in tekens (measure) — de belangrijkste leesbaarheidsmaat;
 * - regelhoogte per richting;
 * - sectieritme als vermenigvuldiger van de basisafstand;
 * - hoekradius, letterspatiëring en uitlijning.
 *
 * HARD:
 * - Puur en deterministisch. Geen random, geen tijd, geen netwerk.
 * - De richting levert GETALLEN, nooit CSS. De theme-builder rendert ermee.
 * - Backward compatible: een plan zonder designDirection en zonder
 *   herkenbare signalen valt terug op "editorial", de richting die de
 *   bestaande plannen impliciet al kozen.
 */

export const DESIGN_DIRECTION_KEYS = [
  "editorial",
  "minimal",
  "premium",
  "modern_tech",
  "warm_organic",
  "bold_retail",
  "classic_trust",
  "playful",
] as const;

export type DesignDirectionKey = (typeof DESIGN_DIRECTION_KEYS)[number];

export interface DesignDirection {
  readonly key: DesignDirectionKey;
  readonly label: string;
  /** Eén zin: waar de richting voor is. Stuurt de AI bij de plankeuze. */
  readonly intent: string;
  /** H1/body-verhouding op desktop. Editorial ±5,5, minimalistisch ±3,5. */
  readonly displayRatio: number;
  /** Lopende tekst in px op 1440 (16 = 1rem). */
  readonly bodyPx: number;
  /** H1 in px op 1440 (bovengrens van de clamp). */
  readonly h1DesktopPx: number;
  /** H1 in px op 390 (ondergrens van de clamp). */
  readonly h1MobilePx: number;
  /** Regelhoogte voor lopende tekst. */
  readonly leading: number;
  /** Gewenste regellengte in tekens (45-75 is comfortabel). */
  readonly measureCh: number;
  /** Modulaire verhouding voor H2-H4. */
  readonly scaleRatio: number;
  /** Vermenigvuldiger op de basis-sectieafstand. */
  readonly sectionRhythm: number;
  readonly radiusPx: number;
  /** Letterspatiëring voor koppen, in em. */
  readonly headingTracking: number;
  /** Uitlijning van sectiekoppen. */
  readonly headingAlign: "left" | "center";
  /** Kop in kapitalen met spatiëring (merkdetail, geen decoratie per sectie). */
  readonly uppercaseEyebrow: boolean;
  /** Gewicht van koppen binnen de beschikbare font-weights. */
  readonly headingWeight: "normal" | "bold";
}

export const DESIGN_DIRECTIONS: Readonly<Record<DesignDirectionKey, DesignDirection>> = {
  editorial: {
    key: "editorial",
    label: "Editoriaal",
    intent: "Tijdschriftachtig: grote koppen, royale regellengte, rustige vlakken.",
    displayRatio: 5.5,
    bodyPx: 17,
    h1DesktopPx: 88,
    h1MobilePx: 36,
    leading: 1.65,
    measureCh: 62,
    scaleRatio: 1.22,
    sectionRhythm: 1.15,
    radiusPx: 2,
    headingTracking: -0.02,
    headingAlign: "left",
    uppercaseEyebrow: false,
    headingWeight: "bold",
  },
  minimal: {
    key: "minimal",
    label: "Minimalistisch",
    intent: "Veel lucht, weinig kader, koppen die niet schreeuwen.",
    displayRatio: 3.8,
    bodyPx: 16,
    h1DesktopPx: 64,
    h1MobilePx: 32,
    leading: 1.7,
    measureCh: 58,
    scaleRatio: 1.18,
    sectionRhythm: 1.35,
    radiusPx: 0,
    headingTracking: -0.015,
    headingAlign: "left",
    uppercaseEyebrow: true,
    headingWeight: "normal",
  },
  premium: {
    key: "premium",
    label: "Premium",
    intent: "Verfijnd en duur: hoge contrasten, strakke letterspatiëring, veel ruimte.",
    displayRatio: 5.4,
    bodyPx: 17,
    h1DesktopPx: 92,
    h1MobilePx: 38,
    leading: 1.72,
    measureCh: 60,
    scaleRatio: 1.25,
    sectionRhythm: 1.5,
    radiusPx: 0,
    headingTracking: 0.005,
    headingAlign: "center",
    uppercaseEyebrow: true,
    headingWeight: "normal",
  },
  modern_tech: {
    key: "modern_tech",
    label: "Modern technisch",
    intent: "Zakelijk en precies: strakke rasterlijnen, compacte regelhoogte, scherpe koppen.",
    displayRatio: 4.5,
    bodyPx: 16,
    h1DesktopPx: 76,
    h1MobilePx: 34,
    leading: 1.55,
    measureCh: 64,
    scaleRatio: 1.2,
    sectionRhythm: 1.0,
    radiusPx: 12,
    headingTracking: -0.03,
    headingAlign: "left",
    uppercaseEyebrow: true,
    headingWeight: "bold",
  },
  warm_organic: {
    key: "warm_organic",
    label: "Warm en organisch",
    intent: "Menselijk en natuurlijk: ronde vormen, ruime regelhoogte, geen harde randen.",
    displayRatio: 4.2,
    bodyPx: 17,
    h1DesktopPx: 72,
    h1MobilePx: 34,
    leading: 1.7,
    measureCh: 60,
    scaleRatio: 1.2,
    sectionRhythm: 1.2,
    radiusPx: 20,
    headingTracking: -0.01,
    headingAlign: "left",
    uppercaseEyebrow: false,
    headingWeight: "bold",
  },
  bold_retail: {
    key: "bold_retail",
    label: "Krachtig en direct",
    intent: "Commercieel en luid: enorme koppen, korte regels, hoge contrasten.",
    displayRatio: 6.5,
    bodyPx: 16,
    h1DesktopPx: 104,
    h1MobilePx: 40,
    leading: 1.5,
    measureCh: 52,
    scaleRatio: 1.28,
    sectionRhythm: 1.0,
    radiusPx: 6,
    headingTracking: -0.035,
    headingAlign: "left",
    uppercaseEyebrow: false,
    headingWeight: "bold",
  },
  classic_trust: {
    key: "classic_trust",
    label: "Klassiek vertrouwen",
    intent: "Degelijk en gevestigd: serif-koppen, gematigde maat, geen effecten.",
    displayRatio: 4.0,
    bodyPx: 17,
    h1DesktopPx: 68,
    h1MobilePx: 32,
    leading: 1.7,
    measureCh: 58,
    scaleRatio: 1.2,
    sectionRhythm: 1.3,
    radiusPx: 0,
    headingTracking: 0,
    headingAlign: "left",
    uppercaseEyebrow: false,
    headingWeight: "normal",
  },
  playful: {
    key: "playful",
    label: "Speels",
    intent: "Uitgesproken en eigenzinnig: grote koppen, korte regels, asymmetrie.",
    displayRatio: 6.0,
    bodyPx: 16,
    h1DesktopPx: 96,
    h1MobilePx: 40,
    leading: 1.45,
    measureCh: 54,
    scaleRatio: 1.26,
    sectionRhythm: 1.25,
    radiusPx: 24,
    headingTracking: -0.01,
    headingAlign: "left",
    uppercaseEyebrow: false,
    headingWeight: "bold",
  },
};

export function isDesignDirectionKey(value: unknown): value is DesignDirectionKey {
  return typeof value === "string" && (DESIGN_DIRECTION_KEYS as readonly string[]).includes(value);
}

/**
 * Fluid typografie: één clamp die op 390px de mobiele maat haalt en op
 * 1440px de desktopmaat, met een harde bovengrens. De grote H1-formaten
 * zijn dus desktoprichtlijnen, geen vaste mobiele waarden.
 */
export function fluidClamp(
  mobilePx: number,
  desktopPx: number,
  minVw = 390,
  maxVw = 1440,
): string {
  const slope = (desktopPx - mobilePx) / (maxVw - minVw);
  const intercept = mobilePx - slope * minVw;
  const calc = `calc(${intercept.toFixed(1)}px + ${(slope * 100).toFixed(2)}vw)`;
  const lower = Math.min(mobilePx, desktopPx);
  const upper = Math.max(mobilePx, desktopPx);
  return `clamp(${lower.toFixed(0)}px, ${calc}, ${upper.toFixed(0)}px)`;
}

/** De volledige typografische trap van een richting, als px-waarden. */
export interface DesignTypeScale {
  readonly h1: string;
  readonly h2: string;
  readonly h3: string;
  readonly h4: string;
  readonly body: string;
  readonly measure: string;
  readonly leading: number;
}

export function typeScaleFor(direction: DesignDirection, headingScalePercent = 100): DesignTypeScale {
  const scale = headingScalePercent / 100;
  const h1Desktop = direction.h1DesktopPx * scale;
  const h1Mobile = Math.min(direction.h1MobilePx * Math.min(scale, 1.1), 44);
  const ratio = direction.scaleRatio;
  return {
    h1: fluidClamp(h1Mobile, h1Desktop),
    h2: fluidClamp(h1Mobile * 0.62, h1Desktop / ratio),
    h3: fluidClamp(h1Mobile * 0.46, h1Desktop / ratio ** 2),
    h4: fluidClamp(h1Mobile * 0.4, h1Desktop / ratio ** 3),
    body: `${direction.bodyPx}px`,
    measure: `${direction.measureCh}ch`,
    leading: direction.leading,
  };
}

/**
 * Kiest de richting. Volgorde:
 * 1. expliciete keuze in het Design Plan (AI of mens);
 * 2. score op de echte signalen (persoonlijkheid, compositie, typografie,
 *    branche) met `avoid` als straf voor herhaling.
 *
 * `avoid` is hoe we voorkomen dat tien opeenvolgende websites dezelfde
 * uitstraling krijgen: de caller geeft de recent gebruikte richtingen mee.
 */
export function resolveDesignDirection(
  plan: Pick<DesignPlan, "artDirection" | "visualContract" | "branding" | "typography" | "designDirection"> & {
    industry?: string | null;
  },
  options: { avoid?: readonly DesignDirectionKey[] } = {},
): DesignDirectionKey {
  const explicit = (plan as { designDirection?: unknown }).designDirection;
  if (isDesignDirectionKey(explicit)) return explicit;

  const industry = (plan.industry ?? "").toLowerCase();
  const personality = plan.artDirection?.brandPersonality;
  const composition = plan.artDirection?.composition;
  const fontPairing = plan.visualContract?.fontPairing;
  const styleDirection = (plan.branding?.styleDirection ?? "").toLowerCase();
  const avoid = new Set(options.avoid ?? []);

  const scores = new Map<DesignDirectionKey, number>();
  const add = (key: DesignDirectionKey, points: number) =>
    scores.set(key, (scores.get(key) ?? 0) + points);

  for (const key of DESIGN_DIRECTION_KEYS) add(key, 0);

  switch (personality) {
    case "premium_refined":
      add("premium", 5);
      add("editorial", 3);
      add("minimal", 2);
      break;
    case "bold_confident":
      add("bold_retail", 5);
      add("playful", 2);
      break;
    case "creative_playful":
      add("playful", 5);
      add("editorial", 2);
      break;
    case "technical_precise":
      add("modern_tech", 5);
      add("minimal", 2);
      break;
    case "warm_friendly":
      add("warm_organic", 5);
      add("editorial", 2);
      break;
    case "calm_professional":
      add("classic_trust", 4);
      add("minimal", 3);
      break;
  }

  switch (composition) {
    case "editorial":
      add("editorial", 4);
      break;
    case "minimal":
      add("minimal", 4);
      break;
    case "immersive":
      add("premium", 3);
      add("editorial", 2);
      break;
    case "structured":
      add("modern_tech", 4);
      add("classic_trust", 2);
      break;
    case "playful":
      add("playful", 4);
      break;
    case "asymmetric":
      add("editorial", 3);
      add("playful", 2);
      break;
  }

  if (fontPairing === "editorial_serif" || fontPairing === "classic_serif") {
    add("editorial", 2);
    add("classic_trust", 2);
  }
  if (fontPairing === "geometric_sans" || fontPairing === "mono_technical") {
    add("modern_tech", 2);
  }
  if (fontPairing === "humanist_sans") add("warm_organic", 2);

  if (/editorial/.test(styleDirection)) add("editorial", 2);
  if (/minimal|clean/.test(styleDirection)) add("minimal", 2);
  if (/modern|tech/.test(styleDirection)) add("modern_tech", 2);
  if (/luxe|premium|elegant/.test(styleDirection)) add("premium", 2);

  // Branche: alleen richtingen die daar aantoonbaar passen.
  const branchRules: Array<[RegExp, DesignDirectionKey[]]> = [
    [/hovenier|tuin|landschap|boom/, ["warm_organic", "editorial"]],
    [/interieur|wonen|meubel|stoffe/, ["editorial", "premium"]],
    [/architect|bouwkunde/, ["editorial", "minimal"]],
    [/aannemer|bouw|installat|elektra|loodgieter/, ["modern_tech", "bold_retail"]],
    [/advocaat|notaris|juridisch|account|fisca/, ["classic_trust", "minimal"]],
    [/kapper|schoonheid|nagel|spa|wellness/, ["playful", "minimal"]],
    [/restaurant|horeca|bistro|koffie/, ["warm_organic", "editorial"]],
    [/fotograaf|studio|design|creatief/, ["editorial", "minimal"]],
    [/zorg|kliniek|fysio|tandarts|huisarts/, ["minimal", "classic_trust"]],
    [/makelaar|vastgoed/, ["premium", "editorial"]],
    [/winkel|retail|webshop/, ["bold_retail", "playful"]],
  ];
  for (const [pattern, keys] of branchRules) {
    if (pattern.test(industry)) {
      keys.forEach((key, index) => add(key, index === 0 ? 3 : 1.5));
      break;
    }
  }

  // Anti-herhaling is een HARDE voorkeur, geen puntenaftrek: een richting
  // die onlangs is gebruikt komt alleen terug als er werkelijk niets anders
  // past. Zo krijgt een reeks klanten in dezelfde branche geen reeks
  // identieke sites.
  const candidates = DESIGN_DIRECTION_KEYS.filter((key) => !avoid.has(key));
  const pool = candidates.length > 0 ? candidates : DESIGN_DIRECTION_KEYS;

  let bestKey: DesignDirectionKey = pool[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const key of pool) {
    const score = scores.get(key) ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  return bestKey;
}

/** Promptregel: dezelfde catalogus, maar met maat, voor de designplanning-AI. */
export function buildDesignDirectionPromptContract(): string {
  return [
    "DESIGNRICHTING (verplicht veld designDirection): kies één richting die past bij branche, huisstijl, publiek en het gevraagde gevoel. Elke richting heeft vaste verhoudingen; kies dus op karakter, niet op kleur.",
    ...DESIGN_DIRECTION_KEYS.map((key) => {
      const d = DESIGN_DIRECTIONS[key];
      return `- ${key}: ${d.intent} H1/body ${d.displayRatio}:1, regellengte ${d.measureCh} tekens, regelhoogte ${d.leading}, sectieritme ${d.sectionRhythm}×.`;
    }),
    "Kies niet automatisch editorial. Twee verschillende branches mogen niet dezelfde richting krijgen als hun karakter verschilt; herhaal de richting van een eerdere klant in dezelfde branche niet zonder reden.",
  ].join("\n");
}
