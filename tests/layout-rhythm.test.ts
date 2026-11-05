import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import { buildShopifyTheme } from "../lib/websites/theme-zip/theme-builder";
import { goldenContact, goldenDesignPlan, goldenSpecification } from "./fixtures/golden-hovenier";

/**
 * FASE 2 — LAYOUTRITME.
 *
 * De nulmeting liet vier secties zien met dezelfde maat, dezelfde 50/50-
 * splitsing en dezelfde kaartgrid. Deze tests bewaken dat het ritme echt in
 * de OUTPUT zit en dat het niet opnieuw een dode selector wordt: de wrapper
 * in het thema is `main#main-content`, niet `.main-content`. Die laatste
 * bestond niet, waardoor eerdere layoutregels stil niets deden.
 */

function buildTheme() {
  return buildShopifyTheme({
    specification: goldenSpecification,
    designPlan: goldenDesignPlan,
    contact: goldenContact,
  });
}

function css(): string {
  const file = buildTheme().files.find((f) => f.path === "assets/theme.css");
  assert.ok(file, "assets/theme.css ontbreekt");
  return file.content;
}

test("ritme: de wrapper-selector bestaat echt in het thema", () => {
  const theme = buildTheme();
  const layout = theme.files.find((f) => f.path === "layout/theme.liquid");
  assert.ok(layout);
  assert.match(layout.content, /<main id="main-content"/, "de wrapper moet id=main-content hebben");
  assert.ok(
    !/(^|[^-\w])\.main-content\b/.test(css()),
    "CSS verwijst naar .main-content, maar dat element bestaat niet: dode regel",
  );
});

test("ritme: drie posities, drie verschillende splitsingsverhoudingen", () => {
  const styles = css();
  const ratios = ["3n+1", "3n+2", "3n+3"].map((position) => {
    if (position === "3n+1") {
      const base = /\.section, \.hero \{ --split-a: ([\d.]+)fr; --split-b: ([\d.]+)fr;/.exec(styles);
      assert.ok(base, "basisverhouding ontbreekt");
      return `${base[1]}/${base[2]}`;
    }
    const match = new RegExp(`main#main-content > section:nth-of-type\\(${position.replace("+", "\\+")}\\) \\{\\s*--split-a: ([\\d.]+)fr; --split-b: ([\\d.]+)fr;`).exec(styles);
    assert.ok(match, `verhouding voor ${position} ontbreekt`);
    return `${match[1]}/${match[2]}`;
  });
  assert.equal(new Set(ratios).size, 3, `verwacht drie verschillende verhoudingen, kreeg ${ratios.join(", ")}`);
  // En de splitsingen gebruiken die variabele, niet een vaste waarde.
  assert.match(styles, /\.hero--split \.hero__inner,[\s\S]{0,200}grid-template-columns: minmax\(0, var\(--split-a\)\) minmax\(0, var\(--split-b\)\)/);
});

test("ritme: sectieruimte verschilt per positie in plaats van één vaste maat", () => {
  const styles = css();
  assert.match(styles, /--rhythm-pad: 1\.16/);
  assert.match(styles, /--rhythm-pad: \.84/);
  assert.match(styles, /padding-block: calc\(var\(--section-spacing\) \* var\(--rhythm-pad\)\)/);
  // De surface-variant houdt zijn eigen compactere maat, ook binnen het ritme.
  assert.match(styles, /section\.section--bg-surface:nth-of-type\(3n\+2\),[\s\S]{0,160}\* \.92\)/);
});

test("ritme: de eerste kaart wordt uitgelicht, maar nooit op mobiel", () => {
  const styles = css();
  const index = styles.indexOf(":where(.services--cards, .benefits--grid) .card-grid > :first-child");
  assert.ok(index > 0, "uitgelichte kaart ontbreekt");
  // Zoek de dichtstbijzijnde media-query vóór deze regel.
  const before = styles.slice(0, index);
  const lastMedia = before.lastIndexOf("@media");
  const media = /@media \(([^)]+)\)/.exec(before.slice(lastMedia));
  assert.ok(media, "de regel moet in een media-query staan");
  assert.equal(media[1], "min-width: 601px", "uitlichten mag de mobiele stapeling niet raken");
  assert.match(styles, /nth-of-type\(3n\+2\) :where\(\.services--cards, \.benefits--grid\) \.card-grid > :first-child \{ grid-column: 1 \/ -1; \}/);
});

test("ritme: de omkering van de split is schermgebonden", () => {
  const styles = css();
  const index = styles.indexOf("nth-of-type(3n+2) .hero--split .hero__inner > :first-child");
  assert.ok(index > 0, "omkering ontbreekt");
  const lastMedia = styles.slice(0, index).lastIndexOf("@media");
  const media = /@media \(([^)]+)\)/.exec(styles.slice(lastMedia));
  assert.equal(media?.[1], "min-width: 601px");
});

test("ritme: elke sectie in het thema draagt de ritmehaak niet meer via section.index", () => {
  // section.index is in de offline render (en in een losse sectie-preview) 0
  // voor élke sectie; daarom hangt het ritme aan nth-of-type.
  for (const file of buildTheme().files.filter((f) => f.path.startsWith("sections/"))) {
    assert.ok(!file.content.includes("section.index"), `${file.path} gebruikt section.index`);
    assert.ok(!file.content.includes("rhythm-{{"), `${file.path} bevat een ritmeklasse op section.index`);
  }
});
