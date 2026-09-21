import test from "node:test";
import assert from "node:assert/strict";
import { DESIGN_PLAN, SPECIFICATION, CONTACT, builtTheme } from "./fixtures/theme";
import { buildShopifyTheme } from "../lib/websites/theme-zip/theme-builder";
import { websiteBlueprintSchema } from "../lib/websites/blueprint/blueprint";
import { BLUEPRINT_SECTION_REGISTRY, type BlueprintSectionType } from "../lib/websites/blueprint/section-registry";
import { D3_COMPOSITIONS } from "../lib/websites/blueprint/composition-registry";
import { composeBlueprintTemplates } from "../lib/websites/theme-zip/blueprint-composition";
import { auditD3CompositionFiles } from "../lib/websites/theme-zip/composition-audit";
import { runFullPreflight } from "../lib/websites/theme-zip/preflight";
import { createThemeZip, readThemeZip } from "../lib/websites/theme-zip/theme-zip";
import type { ThemeFile } from "../lib/websites/theme-zip/theme-structure";

function instance(type: BlueprintSectionType, variant?: string) {
  const definition = BLUEPRINT_SECTION_REGISTRY[type];
  return {
    type, layout: definition.defaultLayout,
    blocks: definition.blocks.flatMap((block) => Array.from({ length: block.requiredKind ? block.min : 0 }, () => ({ kind: block.key, hint: null }))),
    media: [], cta: type === "cta" ? { label: "Neem contact op", target: "contact", prominence: "primary" } : null,
    background: "default", motion: "none", contentHints: null,
    ...(variant ? { composition: { variant, density: "balanced", importance: "supporting", rationale: "Past bij de inhoud en het paginadoel." } } : {}),
  };
}
function blueprint(variant = "featured_service") {
  return websiteBlueprintSchema.parse({ version: 2,
    pages: [
      { key: "home", title: "Home", purpose: "Aanbod en kennismaking", seo: null, sectionInstances: [instance("hero"), instance("services", variant), instance("about", "statement"), instance("cta", "split_cta")] },
      { key: "diensten", title: "Diensten", purpose: "Aanbod nader uitgelegd", seo: null, sectionInstances: [instance("services", "numbered_list"), instance("process", "vertical_timeline")] },
      { key: "contact", title: "Contact", purpose: "Contact opnemen", seo: null, sectionInstances: [instance("contact", "large_type")] },
    ], trustElements: { usps: [], stats: [], badges: [] }, conversionPlan: { primaryGoal: null, leadCapture: null, contactPreference: null }, missingInformation: ["Geen reviews of cijfers aangeleverd."] });
}
function files() {
  return buildShopifyTheme({ specification: SPECIFICATION, designPlan: { ...DESIGN_PLAN, blueprint: blueprint() }, contact: CONTACT }).files;
}

test("D3 integration: per-instance choices map exactly without moving sections or filling slots", () => {
  const bp = blueprint();
  const result = composeBlueprintTemplates({ blueprint: bp, spec: SPECIFICATION, contact: CONTACT, contentPlan: null });
  const home = result.templates.find((t) => t.path === "templates/index.json")!.data as { sections: Record<string, { type: string; settings: Record<string, unknown> }>; order: string[] };
  assert.deepEqual(home.order.map((id) => home.sections[id].type), ["hero", "services", "about", "cta"]);
  assert.equal(home.sections[home.order[1]].settings.composition, "featured_service");
  assert.equal(home.sections[home.order[1]].settings.composition_density, "balanced");
  assert.equal(home.sections[home.order[2]].settings.composition, "statement");
  assert.equal(home.sections[home.order[0]].settings.composition, undefined);
});

test("D3 integration: legacy theme stays unmodified and activation is immutable", () => {
  const legacy = builtTheme();
  const planBefore = JSON.stringify(DESIGN_PLAN);
  assert(!legacy.some((f) => f.path === "assets/composition.css"));
  assert(!legacy.find((f) => f.path === "sections/services.liquid")!.content.includes('"id": "composition"'));
  files();
  assert.equal(JSON.stringify(DESIGN_PLAN), planBefore);
  assert.deepEqual(builtTheme(), legacy);
});

test("D3 integration: actual ZIP bytes certify with Shopify Theme Check, no data fabricated", async () => {
  const original = files();
  const zipped = await createThemeZip(original);
  // ZIP creation API accepts files; roundtrip proves all template selections survive.
  const bytes = zipped instanceof Uint8Array ? zipped : (zipped as unknown as { bytes: Uint8Array }).bytes;
  const restored = await readThemeZip(bytes);
  const result = await runFullPreflight(restored);
  assert(result.passed, result.criticalErrors.join("\n"));
  assert.equal(result.external?.ran, true);
  assert.equal(result.external?.errorCount, 0);
  const audit = auditD3CompositionFiles(restored);
  assert(audit.active && audit.sectionCount === 6);
  assert.equal(audit.errors.length, 0);
  assert(audit.warnings.some((w) => w.includes("D3_CONTENT_DENSITY")), "fixture missing content is reported, never invented");
});

test("D3 integration: every composition enum maps to a declared Shopify select", () => {
  const generated = files();
  for (const [type, definitions] of Object.entries(D3_COMPOSITIONS)) {
    if (!definitions?.length) continue;
    const section = generated.find((f) => f.path === `sections/${type.replace(/_/g, "-")}.liquid`)!;
    assert(section, type);
    const schema = JSON.parse(section.content.match(/\{%[-\s]*schema\s*[-]?%\}([\s\S]*?)\{%[-\s]*endschema\s*[-]?%\}/)![1]);
    const setting = schema.settings.find((s: { id: string }) => s.id === "composition");
    assert.deepEqual(new Set(setting.options.map((o: { value: string }) => o.value)), new Set(["legacy", ...definitions.map((d) => d.key)]));
  }
});

function auditFixture(entries: { type: string; composition: string; composition_density?: string; heading?: string }[]): ThemeFile[] {
  return [
    { path: "assets/composition.css", content: "/* test fixture */" },
    { path: "layout/theme.liquid", content: "{{ 'composition.css' | asset_url | stylesheet_tag }}" },
    { path: "templates/index.json", content: JSON.stringify({ sections: Object.fromEntries(entries.map((s,i) => [String(i), { type: s.type, settings: s }])), order: entries.map((_,i) => String(i)) }) },
  ];
}

test("D3 audit: sparse airy sections and repeated card compositions are surfaced", () => {
  const audit = auditD3CompositionFiles(auditFixture(Array.from({ length: 3 }, () => ({ type: "services", composition: "bento", composition_density: "airy", heading: "Diensten" }))));
  for (const rule of ["D3_EMPTY_CONTENT_ROLE", "D3_CONTENT_DENSITY", "D3_EXCESSIVE_SPACE_RISK", "D3_REPEATED_COMPOSITION", "D3_REPEATED_VISUAL_PATTERN", "D3_TOO_MANY_CARD_COMPOSITIONS"]) {
    assert(audit.warnings.some((w) => w.includes(rule)), rule);
  }
});

test("D3 audit: functional CTA repeat allowed; missing renderer or invalid choice fails closed", () => {
  const functional = auditD3CompositionFiles(auditFixture(Array.from({ length: 3 }, () => ({ type: "cta", composition: "full_statement" }))));
  assert(!functional.warnings.some((w) => /REPEATED|TOO_MANY/.test(w)));
  const missing = auditD3CompositionFiles(auditFixture([{ type: "services", composition: "editorial_list" }]).filter((f) => f.path !== "assets/composition.css"));
  assert(missing.errors.some((e) => e.includes("D3_RENDER_CONTRACT")));
  const invalid = auditD3CompositionFiles(auditFixture([{ type: "about", composition: "css_injection" }]));
  assert(invalid.errors.some((e) => e.includes("D3_UNKNOWN_COMPOSITION")));
});
