import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import { buildShopifyTheme, type BuiltTheme } from "../lib/websites/theme-zip/theme-builder";
import { runDeterministicPreflight } from "../lib/websites/theme-zip/preflight";
import { designPlanSchema, type DesignPlan } from "../lib/websites/design-plan";
import { goldenContact, goldenDesignPlan, GOLDEN_PAGES } from "./fixtures/golden-hovenier";
import { goldenSpecification } from "./fixtures/golden-hovenier";
import type { ThemeFile } from "../lib/websites/theme-zip/theme-structure";

/**
 * W1 — Meerpagina-fundament (2026-11-05).
 *
 * De generator levert een complete website: elke geplande pagina bestaat,
 * heeft een kop met precies één H1, echte inhoud en een CTA, en de navigatie
 * verwijst uitsluitend naar pagina's die daadwerkelijk gegenereerd zijn.
 * Zonder blueprint (v1-plan) ontstaan geen lege templates meer.
 */

function build(plan: DesignPlan = goldenDesignPlan): BuiltTheme {
  return buildShopifyTheme({
    specification: goldenSpecification,
    designPlan: plan,
    contact: goldenContact,
  });
}

interface TestSection {
  type: string;
  settings?: Record<string, unknown>;
  blocks?: Record<string, { settings: Record<string, unknown> }>;
  block_order?: string[];
}

function template(theme: BuiltTheme, path: string): { sections: Record<string, TestSection>; order: string[] } {
  const file = theme.files.find((entry) => entry.path === path);
  assert.ok(file, `template ${path} ontbreekt`);
  return JSON.parse(file.content);
}

function types(data: { sections: Record<string, { type: string }>; order: string[] }): string[] {
  return data.order.map((key) => data.sections[key].type);
}

function headerNav(theme: BuiltTheme): { label: string; link: string }[] {
  const file = theme.files.find((entry) => entry.path === "sections/header-group.json");
  assert.ok(file, "header-group ontbreekt");
  const group = JSON.parse(file.content) as {
    sections: { header: { blocks: Record<string, { settings: { label: string; link: string } }>; block_order: string[] } };
  };
  const header = group.sections.header;
  return header.block_order.map((key) => header.blocks[key].settings);
}

// ---------------------------------------------------------------------------
// 1. Elke geplande pagina bestaat en heeft inhoud
// ---------------------------------------------------------------------------

test("W1: alle vijf geplande pagina's worden gegenereerd (home, over ons, diensten, faq, contact)", () => {
  const theme = build();
  const paths = new Set(theme.files.map((file) => file.path));
  for (const page of GOLDEN_PAGES) {
    assert.ok(paths.has(`templates/${page.template}.json`), `templates/${page.template}.json ontbreekt`);
  }
});

test("W1: elke pagina heeft minstens kop, inhoud en CTA — geen leeg template", () => {
  const theme = build();
  for (const page of GOLDEN_PAGES) {
    const data = template(theme, `templates/${page.template}.json`);
    // De contactpagina is zelf de conversie (kop + formulier); elke andere
    // pagina heeft kop, inhoud én een sluitende CTA.
    const isContact = page.slug === "contact";
    assert.ok(
      data.order.length >= (isContact ? 2 : 3),
      `${page.slug} heeft ${data.order.length} secties`
    );
    assert.ok(!types(data).includes("main-page"), `${page.slug} gebruikt nog een leeg main-page-template`);
    const lastType = types(data).at(-1);
    assert.ok(
      lastType === "cta" || (isContact && lastType === "contact"),
      `${page.slug} eindigt met "${lastType}" in plaats van een conversiesectie`
    );
  }
});

test("W1: precies één H1 per pagina (hero op home, paginakop op subpagina's)", () => {
  const theme = build();
  const home = template(theme, "templates/index.json");
  const homeH1 = types(home).filter((type) => type === "hero" || type === "page-header");
  assert.deepEqual(homeH1, ["hero"]);

  for (const page of GOLDEN_PAGES.filter((entry) => entry.template !== "index")) {
    const data = template(theme, `templates/${page.template}.json`);
    const h1 = types(data).filter((type) => type === "hero" || type === "page-header");
    assert.deepEqual(h1, ["page-header"], `${page.slug} heeft geen eenduidige H1`);
    assert.equal(data.order[0], "page_header", `${page.slug} begint niet met de paginakop`);
  }
});

test("W1: paginakop draagt de titel van de pagina (geen lege of generieke H1)", () => {
  const theme = build();
  for (const page of GOLDEN_PAGES.filter((entry) => entry.template !== "index")) {
    const data = template(theme, `templates/${page.template}.json`);
    const heading = data.sections.page_header.settings?.heading;
    assert.ok(typeof heading === "string" && heading.trim().length > 2, `${page.slug} heeft geen titel`);
    assert.notEqual(heading, "Paginatitel");
  }
});

// ---------------------------------------------------------------------------
// 2. Inhoud komt uit het blueprint; niets verzonnen
// ---------------------------------------------------------------------------

test("W1: dienstenpagina toont de echte diensten uit de specificatie", () => {
  const theme = build();
  const diensten = template(theme, "templates/page.diensten.json");
  const services = diensten.sections[Object.keys(diensten.sections).find((key) => diensten.sections[key].type === "services")!];
  assert.ok(services.blocks && services.block_order);
  const titles = services.block_order.map((key) => services.blocks![key].settings.title);
  assert.deepEqual(titles, ["Tuinontwerp", "Aanleg", "Onderhoud", "Beplanting"]);
});

test("W1: FAQ-pagina bevat de geplande vragen en antwoorden, niets erbij", () => {
  const theme = build();
  const faq = template(theme, "templates/page.faq.json");
  const key = Object.keys(faq.sections).find((entry) => faq.sections[entry].type === "faq")!;
  const section = faq.sections[key];
  assert.ok(section.blocks && section.block_order);
  assert.equal(section.block_order.length, 3);
  // Zonder ContentPlan blijven de vragen bewust leeg (invulbare slots): de
  // generator verzint geen vragen en geen antwoorden.
  assert.ok(section.block_order.every((entry) => "question" in section.blocks![entry].settings));
});

// ---------------------------------------------------------------------------
// 3. Navigatie volgt de werkelijk gegenereerde pagina's
// ---------------------------------------------------------------------------

test("W1: navigatie verwijst uitsluitend naar gegenereerde pagina's", () => {
  const theme = build();
  const templates = new Set(
    theme.files
      .filter((file) => file.path === "templates/index.json" || /^templates\/page\.[^/]+\.json$/.test(file.path))
      .map((file) => file.path.replace("templates/", "").replace(/\.json$/, ""))
  );
  const nav = headerNav(theme);
  assert.ok(nav.length >= 5, `navigatie heeft ${nav.length} items`);
  for (const item of nav) {
    if (item.link === "/") {
      assert.ok(templates.has("index"));
      continue;
    }
    assert.ok(item.link.startsWith("/pages/"), `onverwacht nav-doel ${item.link}`);
    const handle = item.link.slice("/pages/".length);
    assert.ok(templates.has(`page.${handle}`), `nav-doel ${item.link} heeft geen template`);
  }
});

test("W1: home staat vooraan en contact sluit de navigatie", () => {
  const nav = headerNav(build());
  assert.equal(nav[0].link, "/");
  assert.equal(nav.at(-1)!.link, "/pages/contact");
});

test("W1: een geplande pagina die niet in de navigatie staat, wordt alsnog toegevoegd", () => {
  const plan = goldenDesignPlan;
  const trimmed = designPlanSchema.parse({
    ...plan,
    navigation: { items: [{ label: "Home", pageKey: "home" }, { label: "Contact", pageKey: "contact" }], structure: null },
  });
  const nav = headerNav(build(trimmed));
  const links = nav.map((item) => item.link);
  assert.ok(links.includes("/pages/diensten"));
  assert.ok(links.includes("/pages/over-ons"));
});

test("W1: een navigatie-item zonder gegenereerde pagina vervalt (nooit een 404)", () => {
  const plan = goldenDesignPlan;
  const withDeadLink = designPlanSchema.parse({
    ...plan,
    navigation: {
      items: [
        { label: "Home", pageKey: "home" },
        { label: "Blog", pageKey: "blog" },
        { label: "Contact", pageKey: "contact" },
      ],
      structure: null,
    },
  });
  const nav = headerNav(build(withDeadLink));
  assert.ok(!nav.some((item) => item.link === "/pages/blog"));
  assert.ok(nav.some((item) => item.link === "/pages/diensten"));
});

// ---------------------------------------------------------------------------
// 4. Zonder blueprint: ook dan een complete website
// ---------------------------------------------------------------------------

test("W1: v1-plan (geen blueprint) levert pagina's met kop, inhoud en CTA", () => {
  const plan = designPlanSchema.parse({ ...goldenDesignPlan, blueprint: undefined });
  const theme = build(plan);
  for (const page of GOLDEN_PAGES) {
    const data = template(theme, `templates/${page.template}.json`);
    assert.ok(data.order.length >= 2, `${page.slug} is te leeg (${data.order.length} secties)`);
    assert.ok(!types(data).includes("main-page"), `${page.slug} is nog een lege shell`);
  }
  const over = template(theme, "templates/page.over-ons.json");
  assert.equal(types(over)[0], "page-header");
  assert.ok(types(over).includes("about"));
  assert.equal(types(over).at(-1), "cta");
  const diensten = template(theme, "templates/page.diensten.json");
  assert.ok(types(diensten).includes("services"));
});

test("W1: ook zonder blueprint is de navigatie volledig en kloppend", () => {
  const plan = designPlanSchema.parse({ ...goldenDesignPlan, blueprint: undefined });
  const theme = build(plan);
  const nav = headerNav(theme);
  const links = nav.map((item) => item.link);
  assert.deepEqual(links, ["/", "/pages/over-ons", "/pages/diensten", "/pages/faq", "/pages/contact"]);
});

// ---------------------------------------------------------------------------
// 5. Preflight bewaakt volledigheid
// ---------------------------------------------------------------------------

test("W1: de gegenereerde vijf-pagina-site doorstaat de paginavolledigheidscheck", () => {
  const theme = build();
  const preflight = runDeterministicPreflight(theme.files);
  const check = preflight.checks.find((entry) => entry.id === "page_completeness");
  assert.ok(check, "page_completeness-check ontbreekt");
  assert.deepEqual(check.errors, []);
});

test("W1: een pagina zonder kop of inhoud wordt door preflight afgekeurd", () => {
  const theme = build();
  const stripped: ThemeFile[] = theme.files.map((file) =>
    file.path === "templates/page.diensten.json"
      ? { ...file, content: JSON.stringify({ sections: { main: { type: "main-page", settings: {} } }, order: ["main"] }) }
      : file
  );
  const preflight = runDeterministicPreflight(stripped);
  const check = preflight.checks.find((entry) => entry.id === "page_completeness");
  assert.ok(check);
  assert.equal(check.result, "fail");
  assert.ok(check.errors.some((error) => error.includes("page.diensten.json")));
});
