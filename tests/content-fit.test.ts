import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import { applyContentFit, fitSection, sectionShape } from "../lib/websites/content/content-fit";

/**
 * W7-REGRESSIE (6 november 2026): compositie moet bij de inhoud passen.
 *
 * Aanleiding: korte tekst in een enorme sectie, een beeldvlak zonder beeld en
 * vier kolommen voor twee diensten.
 */

const base = { type: "services", wordCount: 120, itemCount: 4, itemWordAverage: 12, hasImage: false };

test("content-fit: beeldafhankelijke compositie zonder beeld wordt tekstveilig", () => {
  const fit = fitSection({ ...base, type: "about" }, { composition: "image_led", density: null });
  assert.equal(fit.composition, "asymmetric");
  assert.ok(fit.reason?.includes("beeld"));
});

test("content-fit: een fotogalerij zonder beeld en zonder tekst verdwijnt", () => {
  const fit = fitSection({ ...base, type: "gallery", wordCount: 4, itemCount: 0 }, { composition: "gallery_grid", density: null });
  assert.equal(fit.drop, true);
});

test("content-fit: korte sectie krijgt compacte dichtheid", () => {
  const fit = fitSection({ ...base, type: "benefits", wordCount: 28, itemCount: 3 }, { composition: "editorial_list", density: "balanced" });
  assert.equal(fit.density, "compact");
});

test("content-fit: twee diensten in een raster worden redactionele rijen", () => {
  const fit = fitSection({ ...base, itemCount: 2 }, { composition: "asymmetric_grid", density: "balanced" });
  assert.equal(fit.composition, "editorial_list");
});

test("content-fit: vijf of meer diensten worden een lijst", () => {
  const fit = fitSection({ ...base, itemCount: 6 }, { composition: "bento", density: "balanced" });
  assert.equal(fit.composition, "editorial_list");
});

test("content-fit: veel inhoud krijgt een ruimere zetting", () => {
  const fit = fitSection({ ...base, type: "about", wordCount: 260 }, { composition: "editorial_split", density: "balanced" });
  assert.equal(fit.density, "airy");
});

test("content-fit: passende compositie blijft staan", () => {
  const fit = fitSection({ ...base, itemCount: 4, wordCount: 90 }, { composition: "editorial_list", density: "balanced" });
  assert.equal(fit.composition, "editorial_list");
  assert.equal(fit.reason, null);
});

test("content-fit: zonder beeld verdwijnen lege beeldinstellingen", () => {
  const sections = {
    services: {
      type: "services",
      settings: {
        heading: "Onze diensten",
        image_asset: "",
        image_asset_width: 0,
        image_asset_height: 0,
        composition: "split_media",
      },
      blocks: {
        s1: { settings: { title: "Tuinontwerp", description: "Persoonlijke ontwerpen voor uw tuin." } },
        s2: { settings: { title: "Tuinaanleg", description: "Complete aanleg van bestrating tot beplanting." } },
      },
      block_order: ["s1", "s2"],
    },
  };
  const result = applyContentFit(sections, ["services"]);
  assert.deepEqual(result.order, ["services"]);
  assert.equal(sections.services.settings.image_asset, undefined);
  assert.equal(sections.services.settings.composition, "editorial_list");
});

test("content-fit: shape telt woorden in settings en blokken", () => {
  const shape = sectionShape({
    type: "services",
    settings: { heading: "Onze diensten", subheading: "Van ontwerp tot onderhoud" },
    blocks: { a: { settings: { title: "Tuinontwerp", description: "Persoonlijke ontwerpen voor uw tuin en huis." } } },
    block_order: ["a"],
  });
  assert.ok(shape.wordCount >= 12);
  assert.equal(shape.itemCount, 1);
});
