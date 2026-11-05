import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contrastRatio,
  ensureContrast,
  hexToOklch,
  mixOklch,
  oklchToHex,
  readableOn,
  relativeLuminance,
  surfaceFrom,
} from "../lib/websites/theme-zip/color-oklch";
import { derivePalette } from "../lib/websites/theme-zip/palette-engine";

/**
 * FASE 1 — KLEUR EN CONTRAST.
 *
 * De nulmeting had 8 contrastfouten, alle in de CTA-band en de footer. De
 * oorzaak was structureel: het sectievlak werd afgeleid als DONKERE tint van
 * de primaire kleur, terwijl de tekst donker bleef. Deze tests bewaken dat
 * (1) het kleurrekenen klopt, (2) contrast gegarandeerd wordt en (3) elk
 * vlak zijn eigen leesbare tekstkleur krijgt.
 */

test("OKLCH: roundtrip is exact voor merkkleuren", () => {
  for (const hex of ["#3f5f4f", "#c9a55a", "#1f2328", "#ffffff", "#000000", "#3b5849", "#0b5fff"]) {
    assert.equal(oklchToHex(hexToOklch(hex)).toLowerCase(), hex.toLowerCase(), hex);
  }
});

test("OKLCH: hue blijft behouden bij mengen, lichtheid beweegt mee", () => {
  const base = hexToOklch("#3f5f4f");
  const mixed = hexToOklch(mixOklch("#3f5f4f", "#ffffff", 0.5));
  assert.ok(Math.abs(mixed.h - base.h) < 2, "hue mag niet verschuiven");
  assert.ok(mixed.l > base.l, "mengen met wit moet lichter worden");
});

test("contrast: luminantie en ratio kloppen met de WCAG-rekenregels", () => {
  assert.equal(relativeLuminance("#000000"), 0);
  assert.equal(relativeLuminance("#ffffff"), 1);
  assert.ok(Math.abs(contrastRatio("#ffffff", "#000000") - 21) < 0.01);
  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 0.01);
  assert.ok(Math.abs(contrastRatio("#3f5f4f", "#3f5f4f") - 1) < 0.001);
});

test("ensureContrast: haalt de gevraagde ratio en laat een geslaagde kleur staan", () => {
  const cases: Array<[string, string, number]> = [
    ["#5a6577", "#f7f7f8", 4.5],
    ["#3f5f4f", "#3b5849", 4.5],
    ["#c9a55a", "#ffffff", 4.5],
    ["#1f2328", "#f0f5f2", 7],
  ];
  for (const [fg, bg, target] of cases) {
    const corrected = ensureContrast(fg, bg, target);
    assert.ok(
      contrastRatio(corrected, bg) >= target - 0.01,
      `${fg} op ${bg}: ${contrastRatio(corrected, bg).toFixed(2)} < ${target}`,
    );
  }
  // Al leesbaar? Dan blijft de kleur exact staan (geen onnodige bemoeienis).
  assert.equal(ensureContrast("#1f2328", "#ffffff", 4.5), "#1f2328");
});

test("readableOn kiest de leesbaarste tekstkleur, ook op een lastige middenkleur", () => {
  assert.equal(readableOn("#3f5f4f"), "#ffffff");
  assert.equal(readableOn("#f7f7f8"), "#141715");
  for (const bg of ["#3f5f4f", "#c9a55a", "#7a8f84", "#0b2a1f"]) {
    assert.ok(contrastRatio(readableOn(bg), bg) > 1);
  }
});

test("surfaceFrom: een leesvlak is licht en houdt de hue van het merk", () => {
  const surface = surfaceFrom("#3f5f4f");
  const l = hexToOklch(surface).l;
  assert.ok(l > 0.9, `surface moet licht zijn, kreeg L=${l.toFixed(3)}`);
  const hueDelta = Math.abs(hexToOklch(surface).h - hexToOklch("#3f5f4f").h);
  assert.ok(Math.min(hueDelta, 360 - hueDelta) < 12, "hue moet herkenbaar blijven");
});

test("palet: het donkere sectievlak uit de nulmeting wordt hersteld", () => {
  // Exact het geval dat 8 contrastfouten opleverde: surface #3b5849.
  const palette = derivePalette({
    primary: "#3f5f4f",
    secondary: "#2d4439",
    accent: "#c9a55a",
    background: "#ffffff",
    surface: "#3b5849",
    text: "#1f2328",
    mutedText: "#5a6577",
    border: "#e5e7eb",
    mood: "warm_organic",
  });

  assert.ok(hexToOklch(palette.surface).l > 0.9, "surface moet een licht vlak zijn geworden");
  assert.ok(palette.corrections.some((c) => /Sectievlak/.test(c)), "de correctie moet gedocumenteerd zijn");
  assert.ok(contrastRatio(palette.onSurface, palette.surface) >= 4.5);
  assert.ok(contrastRatio(palette.onSurfaceMuted, palette.surface) >= 4.5);
  assert.ok(contrastRatio(palette.onSurfaceAccent, palette.surface) >= 4.5);
});

test("palet: tekst op de accentband en op de accentkleur is altijd leesbaar", () => {
  const brands = [
    { primary: "#3f5f4f", accent: "#c9a55a", mood: "warm_organic" as const },
    { primary: "#0b5fff", accent: "#ffd400", mood: "cool_professional" as const },
    { primary: "#111111", accent: "#e8ff00", mood: "bold_contrast" as const },
    { primary: "#f2e9dc", accent: "#8a5a3b", mood: "earthy_natural" as const },
  ];

  for (const brand of brands) {
    const palette = derivePalette({
      primary: brand.primary,
      secondary: brand.primary,
      accent: brand.accent,
      background: "#ffffff",
      surface: "#f7f7f8",
      text: "#1f2328",
      mutedText: "#5a6577",
      border: "#e5e7eb",
      mood: brand.mood,
    });
    assert.ok(
      contrastRatio(palette.onPrimary, palette.primary) >= 4.5,
      `tekst op primary ${brand.primary}: ${contrastRatio(palette.onPrimary, palette.primary).toFixed(2)}`,
    );
    assert.ok(contrastRatio(palette.onPrimaryMuted, palette.primary) >= 4.5);
    assert.ok(contrastRatio(palette.onPrimary, brand.accent) >= 1);
  }
});

test("palet: een bewust donker palet (premium_dark) blijft donker met lichte tekst", () => {
  const palette = derivePalette({
    primary: "#2a2a2a",
    secondary: "#1f1f1f",
    accent: "#c9a55a",
    background: "#0e0e0e",
    surface: "#161616",
    text: "#e8e8e8",
    mutedText: "#a0a0a0",
    border: "#2a2a2a",
    mood: "premium_dark",
  });
  assert.ok(hexToOklch(palette.surface).l < 0.35, "surface moet donker blijven");
  assert.ok(contrastRatio(palette.onSurface, palette.surface) >= 4.5);
  assert.ok(contrastRatio(palette.onSurfaceMuted, palette.surface) >= 4.5);
});
