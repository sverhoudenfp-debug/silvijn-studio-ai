import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken (zelfde patroon als alle websitetests).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import { buildShopifyTheme, buildThemeDesignTokens } from "../lib/websites/theme-zip/theme-builder";
import { DESIGN_DIRECTIONS, resolveDesignDirection, typeScaleFor } from "../lib/websites/design-direction";
import { contrastRatio } from "../lib/websites/theme-zip/color-oklch";
import { goldenContact, goldenDesignPlan, goldenSpecification } from "./fixtures/golden-hovenier";

/**
 * FASE 1 — DESIGN TOKENS IN HET ECHTE THEMA.
 *
 * De direction-tests bewaken de getallen, deze test bewaakt de DOORVERTALING
 * naar het gegenereerde thema. Zonder deze laag kan de engine van richting
 * veranderen zonder dat er iets in de output gebeurt — precies het probleem
 * dat de nulmeting blootlegde (2,4rem-kop ongeacht de richting).
 */

function buildTheme() {
  return buildShopifyTheme({
    specification: goldenSpecification,
    designPlan: goldenDesignPlan,
    contact: goldenContact,
  });
}

function cssOf(theme: ReturnType<typeof buildTheme>): string {
  const css = theme.files.find((f) => f.path === "assets/theme.css");
  assert.ok(css, "assets/theme.css ontbreekt");
  return css.content;
}

function liquidOf(theme: ReturnType<typeof buildTheme>): string {
  const layout = theme.files.find((f) => f.path === "layout/theme.liquid");
  assert.ok(layout, "layout/theme.liquid ontbreekt");
  return layout.content;
}

test("tokens: het golden plan krijgt een richting met een fluid kop", () => {
  const tokens = buildThemeDesignTokens(goldenDesignPlan);
  assert.equal(tokens.direction.key, resolveDesignDirection(goldenDesignPlan));
  assert.match(tokens.typeScale.h1, /^clamp\(/);
  assert.equal(tokens.typeScale.measure, `${tokens.direction.measureCh}ch`);
  assert.equal(tokens.typeScale.body, `${tokens.direction.bodyPx}px`);
  assert.ok(tokens.typeScale.leading >= 1.4);
});

test("tokens: elk vlak heeft een tekstkleur die AA haalt", () => {
  const tokens = buildThemeDesignTokens(goldenDesignPlan);
  assert.ok(contrastRatio(tokens.onSurface, tokens.surface) >= 4.5, "surface");
  assert.ok(contrastRatio(tokens.onSurfaceMuted, tokens.surface) >= 4.5, "surface muted");
  assert.ok(contrastRatio(tokens.onSurfaceAccent, tokens.surface) >= 4.5, "surface accent");
  assert.ok(contrastRatio(tokens.onPrimary, tokens.primary) >= 4.5, "primary");
  assert.ok(contrastRatio(tokens.onPrimaryMuted, tokens.primary) >= 4.5, "primary muted");
  assert.ok(contrastRatio(tokens.onAccent, tokens.accent) >= 4.5, "accent");
});

test("CSS: de kop gebruikt de trap, niet meer de vaste 2,4rem", () => {
  const css = cssOf(buildTheme());
  assert.ok(!css.includes("2.4rem * var(--heading-scale)"), "de oude vaste kopmaat staat er nog");
  assert.match(css, /h1 \{ font-size: var\(--h1-size\)/);
  assert.match(css, /h2 \{ font-size: var\(--h2-size\)/);
  assert.match(css, /p \{ max-width: var\(--measure\)/);
  // De varianten schalen RELATIEF op de trap, niet op een eigen rem-waarde.
  assert.ok(!/font-size: calc\([0-9.]+rem \* var\(--heading-scale\)\)/.test(css));
});

test("CSS: band en surface zetten hun eigen tekst-, muted- en accentkleur", () => {
  const css = cssOf(buildTheme());
  const band = css.slice(css.indexOf(".section--bg-accent_band {"), css.indexOf(".section--bg-accent_band .btn--primary"));
  assert.match(band, /--muted: |--color-muted:/);
  assert.match(band, /--color-text:/);
  assert.match(band, /background: var\(--band-bg\)/);
  // De eigen achtergrond mag NIET van --color-primary afhangen: die variabele
  // wordt binnen dezelfde regel omgezet voor de kinderen.
  assert.ok(!/background: var\(--color-primary\)/.test(band), "achtergrond schaduwt zichzelf");

  const surface = css.slice(css.indexOf(".section--bg-surface {"), css.indexOf(".section--bg-surface {") + 400);
  assert.match(surface, /background: var\(--surface-bg\)/);
  assert.match(surface, /--color-muted:/);
  assert.match(surface, /--color-text:/);
});

test("layout: alle ontwerptokens staan als CSS-variabele in het thema", () => {
  const tokens = buildThemeDesignTokens(goldenDesignPlan);
  const liquid = liquidOf(buildTheme());
  for (const name of [
    "--h1-size",
    "--h2-size",
    "--h3-size",
    "--h4-size",
    "--body-size",
    "--leading",
    "--measure",
    "--heading-tracking",
    "--color-on-surface",
    "--color-on-primary",
    "--color-on-accent",
    "--band-bg",
    "--surface-bg",
  ]) {
    assert.ok(liquid.includes(name), `ontbreekt in theme.liquid: ${name}`);
  }
  assert.ok(liquid.includes(tokens.typeScale.h1), "de fluid clamp van de richting ontbreekt");
});

test("settings: het sectieritme is merchant-instelbaar en volgt de richting", () => {
  const theme = buildTheme();
  const schema = theme.files.find((f) => f.path === "config/settings_schema.json");
  const data = theme.files.find((f) => f.path === "config/settings_data.json");
  assert.ok(schema && data);
  // settings_schema.json is een ARRAY van groepen, elk met eigen settings.
  const groups = JSON.parse(schema.content) as Array<{ settings?: Array<{ id?: string; default?: unknown; type?: string }> }>;
  const settings = groups.flatMap((group) => group.settings ?? []);
  const entry = settings.find((s) => s.id === "section_rhythm");
  assert.ok(entry, "section_rhythm ontbreekt in settings_schema.json");
  const parsedData = JSON.parse(data.content) as { current: Record<string, unknown> };
  assert.equal(typeof entry?.default, "number");
  assert.equal(entry?.type, "range");
  assert.equal(
    parsedData.current.section_rhythm,
    Math.round(DESIGN_DIRECTIONS[buildThemeDesignTokens(goldenDesignPlan).direction.key].sectionRhythm * 100),
  );
});

test("richting wisselen verandert de OUTPUT, niet alleen het token", () => {
  const explicit = { ...goldenDesignPlan, designDirection: "bold_retail" as const };
  const tokens = buildThemeDesignTokens(explicit);
  assert.equal(tokens.direction.key, "bold_retail");
  assert.match(tokens.typeScale.h1, /^clamp\(44px, .*114px\)$/);
  // De curve van het plan (expressive) schaalt de trap mee, dus de bovengrens
  // ligt boven de kale richtingsmaat maar blijft die van bold_retail.
  const upper = Number(/, (\d+)px\)$/.exec(tokens.typeScale.h1)?.[1]);
  const editorialUpper = Number(/, (\d+)px\)$/.exec(typeScaleFor(DESIGN_DIRECTIONS.editorial).h1)?.[1]);
  assert.ok(upper >= 104, `bold_retail moet minstens 104px halen, kreeg ${upper}`);
  assert.ok(upper > editorialUpper, "bold_retail moet groter zijn dan editorial");
  assert.notEqual(tokens.typeScale.measure, `${DESIGN_DIRECTIONS.editorial.measureCh}ch`);
});

test("determinisme: twee keer bouwen levert byte-identieke bestanden", () => {
  const first = buildTheme();
  const second = buildTheme();
  assert.equal(first.files.length, second.files.length);
  for (let i = 0; i < first.files.length; i += 1) {
    assert.equal(first.files[i].path, second.files[i].path);
    assert.equal(first.files[i].content, second.files[i].content, first.files[i].path);
  }
});
