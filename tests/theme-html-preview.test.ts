import test from "node:test";
import assert from "node:assert/strict";
import { builtTheme } from "./fixtures/theme";
import { renderThemePageHtml, ThemeHtmlPreviewError } from "../lib/websites/theme-zip/html-preview";

// Force the test-only in-memory repositories. Never touch production data.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

test("renders the homepage of a built theme to a self-contained document", async () => {
  const files = builtTheme();
  const result = await renderThemePageHtml(files, { template: "index", bannerHtml: '<div data-test-banner>Voorbeeld</div>' });
  assert.match(result.html.trimStart(), /^<!doctype html>/i);
  assert.ok(result.html.includes("<style>"), "theme.css inlined");
  assert.ok(!/href="__theme_asset__/.test(result.html) && !/__theme_asset__/.test(result.html), "no asset markers left");
  assert.ok(!/<link rel="stylesheet" href="http/.test(result.html), "no external stylesheets");
  assert.ok(result.html.includes("data-test-banner"));
  assert.ok(result.sectionTypes.includes("hero"), `hero rendered (${result.sectionTypes.join(",")})`);
  assert.ok(result.html.includes("<header"), "header group rendered");
  assert.ok(result.html.includes("<footer"), "footer group rendered");
  assert.ok(!/<form(?![^>]*data-preview-inert)/.test(result.html), "every form is inert");
  assert.ok(!/\bundefined\b|\{\{|\{%|\[object Object\]/.test(result.html));
});

test("renders subpage templates and fails loud on unknown templates", async () => {
  const files = builtTheme();
  const pageTemplates = files.map((f) => f.path.match(/^templates\/(page\.[a-z0-9-]+)\.json$/)?.[1]).filter((x): x is string => Boolean(x));
  assert.ok(pageTemplates.length > 0, "fixture theme has subpages");
  for (const template of pageTemplates) {
    const result = await renderThemePageHtml(files, { template });
    assert.ok(result.html.includes(`template-page`), `${template} body class`);
  }
  await assert.rejects(renderThemePageHtml(files, { template: "page.does-not-exist" }), (e: unknown) => e instanceof ThemeHtmlPreviewError && /THEME_FILE_MISSING/.test((e as Error).message));
  await assert.rejects(renderThemePageHtml(files, { template: "product" }), (e: unknown) => e instanceof ThemeHtmlPreviewError && /TEMPLATE_NOT_SUPPORTED/.test((e as Error).message));
});

test("a section that uses an unsupported filter or references a missing snippet fails loud instead of rendering garbage", async () => {
  const files = builtTheme().map((f) =>
    f.path === "sections/hero.liquid" ? { ...f, content: f.content.replace("{% schema %}", "{{ 'x' | totally_unknown_filter }}{% schema %}") } : f
  );
  await assert.rejects(renderThemePageHtml(files, { template: "index" }));
  const missingSnippet = builtTheme().filter((f) => f.path !== "snippets/theme-media.liquid");
  await assert.rejects(renderThemePageHtml(missingSnippet, { template: "index" }));
});

test("shipped theme.js is syntactically valid JavaScript (regression: template-literal escaping ate a backslash)", () => {
  const js = builtTheme().find((f) => f.path === "assets/theme.js")!.content;
  assert.ok(js.includes('replace(/\\/$/, "")'), "regex keeps its escaped slash");
  assert.doesNotThrow(() => new Function(js));
});

test("theme validation rejects a theme whose JS asset does not parse", async () => {
  const { validateThemeFiles } = await import("../lib/websites/theme-zip/theme-validation");
  const good = validateThemeFiles(builtTheme());
  assert.ok(!good.errors.some((e) => e.includes("ASSET_JS_SYNTAX")), good.errors.join("\n"));
  const broken = builtTheme().map((f) => (f.path === "assets/theme.js" ? { ...f, content: f.content.replace('replace(/\\/$/, "")', 'replace(//$/, "")') } : f));
  const result = validateThemeFiles(broken);
  assert.ok(result.errors.some((e) => e.includes("ASSET_JS_SYNTAX")), "syntax error surfaced");
});
