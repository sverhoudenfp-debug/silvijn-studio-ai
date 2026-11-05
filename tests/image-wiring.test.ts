import { test } from "node:test";
import assert from "node:assert/strict";

import { applyThemeImagesToTemplates, buildShopifyTheme, type ThemeImage } from "../lib/websites/theme-zip/theme-builder";
import { renderThemePageHtml } from "../lib/websites/theme-zip/html-preview";
import { goldenContact, goldenDesignPlan, goldenSpecification } from "./fixtures/golden-hovenier";

/**
 * FASE 3 — DOORSTROMING VAN BEELDEN.
 *
 * De beelden zelf worden niet in de test gegenereerd (geen netwerk, geen
 * kosten). Wat hier vastligt: een aangeleverd beeld komt als asset in het
 * thema, de homepage-sectie verwijst ernaar, en de rest van het thema houdt
 * zijn placeholder. Zonder images blijft de output identiek aan fase 2.
 */

const heroFile = "media-hero-test.webp";
const aboutFile = "media-about-test.webp";
const bytes = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]); // RIFF-kop, voldoende voor de doorstroming

const images: ThemeImage[] = [
  { slot: "hero", file: heroFile, bytes, width: 1600, height: 900, alt: "Tuin met vaste beplanting" },
  { slot: "about", file: aboutFile, bytes, width: 1024, height: 683, alt: null },
];

function build(withImages: ThemeImage[]) {
  return buildShopifyTheme({
    specification: goldenSpecification as never,
    designPlan: goldenDesignPlan,
    contact: goldenContact,
    images: withImages,
  });
}

test("beeld: elk aangeleverd beeld staat als binair bestand in assets/", () => {
  const built = build(images);
  for (const image of images) {
    const file = built.files.find((f) => f.path === `assets/${image.file}`);
    assert.ok(file, `${image.file} ontbreekt in assets/`);
    assert.equal(file.content, "", "binaire assets horen geen tekstinhoud te hebben");
    assert.equal(file.bytes?.length, image.bytes.length);
  }
});

test("beeld: de homepage verwijst naar het asset en naar de echte afmetingen", () => {
  const built = build(images);
  const index = built.files.find((f) => f.path === "templates/index.json");
  assert.ok(index);
  assert.match(index.content, new RegExp(heroFile));
  assert.match(index.content, /"image_asset_width": 1600/);
  assert.match(index.content, /"image_asset_height": 900/);
  assert.match(index.content, /Tuin met vaste beplanting/, "alt-tekst uit de planning hoort mee te gaan");
  assert.match(index.content, new RegExp(aboutFile));
});

test("beeld: subpagina's houden hun eigen hero (geen herhaling van dezelfde foto)", () => {
  const built = build(images);
  const subpages = built.files.filter((f) => f.path.startsWith("templates/page.") && f.path !== "templates/page.contact.json");
  for (const page of subpages) {
    assert.ok(!page.content.includes(heroFile), `${page.path} herhaalt de homepage-hero`);
  }
});

test("beeld: het mediasnippet rendert een themabron zonder image_picker", async () => {
  const built = build(images);
  const snippet = built.files.find((f) => f.path === "snippets/theme-media.liquid");
  assert.ok(snippet);
  assert.match(snippet.content, /\{%- elsif asset != blank -%\}/);
  assert.match(snippet.content, /asset \| asset_url/);

  const rendered = await renderThemePageHtml(built.files, { template: "index" });
  assert.match(rendered.html, /data:image\/webp;base64,/, "het beeld moet inline resolvebaar zijn in de preview");
  assert.match(rendered.html, /alt="Tuin met vaste beplanting"/);
});

test("beeld: zonder images blijft de output exact zoals fase 2 (placeholders)", () => {
  const built = build([]);
  const index = built.files.find((f) => f.path === "templates/index.json");
  assert.ok(index);
  assert.ok(!index.content.includes("image_asset"), "geen beeld betekent geen beeldinstelling");
  assert.ok(!built.files.some((f) => f.path.startsWith("assets/media-")), "geen ongebruikte assets");
});

test("beeld: dienstkaarten krijgen elk hun eigen beeld, in volgorde", () => {
  const images: ThemeImage[] = ["a", "b", "c", "d"].map((n) => ({
    slot: "services" as const,
    file: `service-${n}.webp`,
    bytes: new Uint8Array([1, 2, 3]),
    width: 900,
    height: 675,
    alt: `Dienst ${n}`,
  }));
  const template = {
    path: "templates/index.json",
    data: {
      sections: {
        services: {
          type: "services",
          settings: {},
          blocks: {
            service_1: { settings: { title: "Ontwerp" } },
            service_2: { settings: { title: "Aanleg" } },
            service_3: { settings: { title: "Onderhoud" } },
            service_4: { settings: { title: "Beplanting" } },
          },
        },
      },
    },
  };
  applyThemeImagesToTemplates([template], images);
  const blocks = (template.data.sections.services as { blocks: Record<string, { settings: Record<string, unknown> }> }).blocks;
  assert.equal(blocks.service_1.settings.image_asset, "service-a.webp");
  assert.equal(blocks.service_4.settings.image_asset, "service-d.webp");
  assert.equal(blocks.service_3.settings.image_alt, "Dienst c");
  assert.equal(blocks.service_1.settings.title, "Ontwerp", "bestaande instellingen blijven staan");
});

test("beeld: minder beelden dan kaarten laat de rest zijn placeholder houden", () => {
  const images: ThemeImage[] = [
    { slot: "services", file: "enige.webp", bytes: new Uint8Array([1]), width: 900, height: 675, alt: null },
  ];
  const template = {
    path: "templates/index.json",
    data: {
      sections: {
        services: {
          type: "services",
          settings: {},
          blocks: { service_1: { settings: {} }, service_2: { settings: {} } },
        },
      },
    },
  };
  applyThemeImagesToTemplates([template], images);
  const blocks = (template.data.sections.services as { blocks: Record<string, { settings: Record<string, unknown> }> }).blocks;
  assert.equal(blocks.service_1.settings.image_asset, "enige.webp");
  assert.equal(blocks.service_2.settings.image_asset, undefined, "geen herhaalde foto op kaart 2");
});

test("beeld: galerij gebruikt zijn eigen beelden, niet die van de diensten", () => {
  const images: ThemeImage[] = [
    { slot: "services", file: "dienst.webp", bytes: new Uint8Array([1]), width: 900, height: 675, alt: null },
    { slot: "gallery", file: "project.webp", bytes: new Uint8Array([1]), width: 900, height: 900, alt: "Tuin" },
  ];
  const template = {
    path: "templates/index.json",
    data: {
      sections: {
        gallery: { type: "gallery", settings: {}, blocks: { g1: { settings: {} } } },
        services: { type: "services", settings: {}, blocks: { s1: { settings: {} } } },
      },
    },
  };
  applyThemeImagesToTemplates([template], images);
  const t = template.data.sections as Record<string, { blocks: Record<string, { settings: Record<string, unknown> }> }>;
  assert.equal(t.gallery.blocks.g1.settings.image_asset, "project.webp");
  assert.equal(t.services.blocks.s1.settings.image_asset, "dienst.webp");
});
