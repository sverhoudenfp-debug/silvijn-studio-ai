import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DESIGN_DIRECTIONS,
  DESIGN_DIRECTION_KEYS,
  buildDesignDirectionPromptContract,

  isDesignDirectionKey,
  resolveDesignDirection,
  typeScaleFor,
} from "../lib/websites/design-direction";

/**
 * FASE 1 — DESIGN INTELLIGENCE: de richtingen zijn pas iets waard als de
 * VERHOUDINGEN kloppen en niet stil kunnen verschuiven. Deze tests bewaken
 * (1) de catalogus, (2) de fluid trap en de mobiele grens, (3) de keuze en
 * (4) de anti-herhaling.
 */

/** Leest de grenzen en de helling terug uit een clamp-string. */
function parseClamp(value: string): { lower: number; upper: number; slopeVw: number; intercept: number } {
  const match = /^clamp\((\d+)px, calc\((-?[\d.]+)px \+ (-?[\d.]+)vw\), (\d+)px\)$/.exec(value);
  assert.ok(match, `onverwachte clamp: ${value}`);
  return {
    lower: Number(match[1]),
    intercept: Number(match[2]),
    slopeVw: Number(match[3]),
    upper: Number(match[4]),
  };
}

test("designrichtingen: acht richtingen met geldige, onderscheidende verhoudingen", () => {
  assert.equal(DESIGN_DIRECTION_KEYS.length, 8);
  for (const key of DESIGN_DIRECTION_KEYS) {
    const d = DESIGN_DIRECTIONS[key];
    assert.equal(d.key, key);
    assert.ok(d.displayRatio >= 3 && d.displayRatio <= 7, `${key}: displayRatio`);
    assert.ok(d.bodyPx >= 15 && d.bodyPx <= 18, `${key}: bodyPx`);
    assert.ok(d.measureCh >= 45 && d.measureCh <= 75, `${key}: measureCh moet leesbaar zijn`);
    assert.ok(d.leading >= 1.4 && d.leading <= 1.8, `${key}: leading`);
    assert.ok(d.h1DesktopPx >= 60 && d.h1DesktopPx <= 110, `${key}: h1DesktopPx`);
    assert.ok(d.h1MobilePx >= 28 && d.h1MobilePx <= 44, `${key}: h1MobilePx`);
    assert.ok(d.sectionRhythm >= 0.9 && d.sectionRhythm <= 1.6, `${key}: sectionRhythm`);
    // De verhouding moet ook echt uit de maten volgen.
    const ratio = d.h1DesktopPx / d.bodyPx;
    assert.ok(Math.abs(ratio - d.displayRatio) < 1.5, `${key}: displayRatio ${d.displayRatio} past niet bij ${ratio.toFixed(1)}:1`);
  }

  // Editorial en minimalistisch verschillen op VERHOUDING, niet op kleur.
  assert.ok(
    DESIGN_DIRECTIONS.editorial.displayRatio > DESIGN_DIRECTIONS.minimal.displayRatio + 1,
    "editorial moet een grotere display/body-verhouding hebben dan minimal",
  );
  assert.ok(DESIGN_DIRECTIONS.bold_retail.measureCh < DESIGN_DIRECTIONS.modern_tech.measureCh);
});

test("fluidClamp: haalt de mobiele en desktopmaat exact, met harde bovengrens", () => {
  for (const key of DESIGN_DIRECTION_KEYS) {
    const d = DESIGN_DIRECTIONS[key];
    const clamp = parseClamp(typeScaleFor(d).h1);

    const at = (vw: number) => clamp.intercept + (clamp.slopeVw / 100) * vw;
    // Op 390px精确 de mobiele maat (binnen 1px afronding).
    assert.ok(Math.abs(at(390) - d.h1MobilePx) < 1.5, `${key}: mobiel ${at(390).toFixed(1)} != ${d.h1MobilePx}`);
    // Op 1440px precies de desktopmaat.
    assert.ok(Math.abs(at(1440) - d.h1DesktopPx) < 1.5, `${key}: desktop ${at(1440).toFixed(1)} != ${d.h1DesktopPx}`);
    // Nooit groter dan de desktopmaat, ook niet op een breed scherm.
    assert.equal(clamp.upper, d.h1DesktopPx);
    assert.ok(clamp.slopeVw > 0, `${key}: helling moet positief zijn`);
  }
});

test("typeScaleFor: mobiele kop blijft onder 46px, ook bij een extreme heading-scale", () => {
  for (const key of DESIGN_DIRECTION_KEYS) {
    for (const scale of [90, 100, 130]) {
      const t = typeScaleFor(DESIGN_DIRECTIONS[key], scale);
      const clamp = parseClamp(t.h1);
      assert.ok(clamp.lower <= 46, `${key}@${scale}: mobiele ondergrens ${clamp.lower}px te groot`);
      assert.ok(clamp.upper >= 55, `${key}@${scale}: desktopmaat te klein`);
    }
  }
  // De trap loopt af: h1 > h2 > h3 > h4 op desktop.
  const t = typeScaleFor(DESIGN_DIRECTIONS.editorial);
  const upper = (value: string) => parseClamp(value).upper;
  assert.ok(upper(t.h1) > upper(t.h2));
  assert.ok(upper(t.h2) > upper(t.h3));
  assert.ok(upper(t.h3) > upper(t.h4));
  assert.equal(t.measure, "62ch");
  assert.equal(t.body, "17px");
});

test("resolveDesignDirection: expliciete keuze wint, afleiding is deterministisch", () => {
  const plan = {
    industry: "hovenier",
    artDirection: { brandPersonality: "warm_friendly", composition: "editorial" },
    visualContract: { fontPairing: "editorial_serif" },
    branding: { styleDirection: "editorial" },
    designDirection: "playful",
  } as never;

  assert.equal(resolveDesignDirection(plan), "playful");

  const inferred = { ...(plan as Record<string, unknown>), designDirection: null } as never;
  const first = resolveDesignDirection(inferred);
  const second = resolveDesignDirection(inferred);
  assert.equal(first, second, "dezelfde input moet dezelfde richting geven");
  assert.ok(isDesignDirectionKey(first));
});

test("resolveDesignDirection: branche en karakter sturen de keuze", () => {
  const base = {
    artDirection: { brandPersonality: "calm_professional", composition: "structured" },
    visualContract: { fontPairing: "classic_serif" },
    branding: { styleDirection: "klassiek" },
    designDirection: null,
  };

  assert.equal(resolveDesignDirection({ ...base, industry: "advocatenkantoor" } as never), "classic_trust");
  assert.equal(
    resolveDesignDirection({
      ...base,
      industry: "restaurant",
      artDirection: { brandPersonality: "warm_friendly", composition: "editorial" },
      visualContract: { fontPairing: "humanist_sans" },
      branding: { styleDirection: "warm" },
    } as never),
    "warm_organic",
  );
  assert.equal(
    resolveDesignDirection({
      ...base,
      industry: "aannemer",
      artDirection: { brandPersonality: "technical_precise", composition: "structured" },
      visualContract: { fontPairing: "geometric_sans" },
      branding: { styleDirection: "modern" },
    } as never),
    "modern_tech",
  );
});

test("anti-homogeniteit: een recent gebruikte richting wordt vermeden", () => {
  // Per branche een plan dat bij die branche past (karakter + compositie +
  // typografie in lijn), zodat de keuze iets zegt.
  const plans = {
    hovenier: { personality: "warm_friendly", composition: "editorial", font: "humanist_sans" },
    advocatenkantoor: { personality: "calm_professional", composition: "structured", font: "classic_serif" },
    restaurant: { personality: "warm_friendly", composition: "immersive", font: "editorial_serif" },
    kapsalon: { personality: "creative_playful", composition: "playful", font: "geometric_sans" },
  } as const;

  const plan = (industry: keyof typeof plans) =>
    ({
      industry,
      artDirection: { brandPersonality: plans[industry].personality, composition: plans[industry].composition },
      visualContract: { fontPairing: plans[industry].font },
      branding: { styleDirection: plans[industry].personality },
      designDirection: null,
    }) as never;

  for (const industry of Object.keys(plans) as Array<keyof typeof plans>) {
    const first = resolveDesignDirection(plan(industry));
    assert.equal(resolveDesignDirection(plan(industry)), first, `${industry}: niet deterministisch`);
    const second = resolveDesignDirection(plan(industry), { avoid: [first] });
    assert.notEqual(second, first, `${industry}: dezelfde richting kwam terug ondanks avoid`);
  }

  // En de vier branches samen leveren meer dan één uitstraling op.
  const distinct = new Set(
    (Object.keys(plans) as Array<keyof typeof plans>).map((industry) => resolveDesignDirection(plan(industry))),
  );
  assert.ok(distinct.size >= 3, `verwacht minimaal 3 verschillende richtingen, kreeg ${[...distinct].join(",")}`);
});

test("promptcontract: elke richting noemt zijn maat, niet alleen zijn sfeer", () => {
  const contract = buildDesignDirectionPromptContract();
  for (const key of DESIGN_DIRECTION_KEYS) {
    assert.ok(contract.includes(key), `ontbreekt in prompt: ${key}`);
  }
  assert.ok(contract.includes("regellengte"));
  assert.ok(/H1\/body \d/.test(contract), "de verhouding moet als getal in de prompt staan");
});
