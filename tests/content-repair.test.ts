import test from "node:test";
import assert from "node:assert/strict";
import { mergeRepairedPages, pagesNeedingRepair, subsetBlueprint } from "../lib/websites/content/content-repair";
import type { ContentPlan, ContentUnit } from "../lib/websites/content/content-plan";
import type { WebsiteBlueprint } from "../lib/websites/blueprint/blueprint";

function unit(path: string, text: string): ContentUnit {
  return { path, kind: "body", status: "generated", text, evidence: ["bron"], sourceOrigin: null, instruction: null };
}

function plan(pages: Array<{ key: string; units: ContentUnit[] }>): ContentPlan {
  return {
    version: 1,
    pages: pages.map((page) => ({ key: page.key, seo: null, units: page.units })),
    missingInformation: [],
    approvals: { gContent: false },
  } as unknown as ContentPlan;
}

test("W2: alleen afgekeurde pagina's worden vervangen, de rest blijft byte-identiek", () => {
  const original = plan([
    { key: "home", units: [unit("home/0", "home-tekst")] },
    { key: "over-ons", units: [unit("over-ons/0", "kort")] },
  ]);
  const merged = mergeRepairedPages(original, [
    { key: "over-ons", units: [unit("over-ons/0", "veel langer en vollediger")] },
  ]);

  assert.deepEqual(merged.replaced, ["over-ons"]);
  assert.equal(merged.plan.pages[0]!.units[0]!.text, "home-tekst");
  assert.equal(merged.plan.pages[1]!.units[0]!.text, "veel langer en vollediger");
});

test("W2: een pagina zonder bruikbare hersteloutput wordt nooit leeggemaakt", () => {
  const original = plan([{ key: "faq", units: [unit("faq/0", "bestaande tekst")] }]);
  const merged = mergeRepairedPages(original, [{ key: "faq", units: [] }]);
  assert.deepEqual(merged.replaced, []);
  assert.deepEqual(merged.ignored, ["faq"]);
  assert.equal(merged.plan.pages[0]!.units[0]!.text, "bestaande tekst");
});

test("W2: reparatie richt zich uitsluitend op blokkerende pagina's", () => {
  const current = plan([
    { key: "home", units: [unit("home/0", "x")] },
    { key: "faq", units: [unit("faq/0", "y")] },
  ]);
  const keys = pagesNeedingRepair(current, [
    { page: "home", severity: "warning" },
    { page: "faq", severity: "blocking" },
  ]);
  assert.deepEqual(keys, ["faq"]);
});

test("W2: subset-blueprint houdt de paginavolgorde van de opdracht aan", () => {
  const blueprint = { pages: [{ key: "home" }, { key: "faq" }] } as unknown as WebsiteBlueprint;
  assert.deepEqual(subsetBlueprint(blueprint, ["faq"]).pages.map((p) => p.key), ["faq"]);
});
