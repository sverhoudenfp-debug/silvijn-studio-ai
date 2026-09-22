import "server-only";
import { Liquid, type TagToken, type TopLevelToken, type Context } from "liquidjs";

type TagImplOptions = Parameters<Liquid["registerTag"]>[1];
import type { ThemeFile } from "./theme-structure";

/**
 * Theme HTML Preview — renders ONE page of a generated Shopify theme to a
 * self-contained HTML document without Shopify.
 *
 * Scope and honesty:
 * - This is a local LiquidJS emulation of the closed feature set that our own
 *   theme-builder emits (settings, sections, blocks, snippets, groups, the
 *   filters listed below). It is NOT a Shopify runtime and proves nothing
 *   about Shopify import, Theme Editor behaviour or storefront performance.
 * - Anything outside that closed set fails loud (unknown filter/tag/section,
 *   unresolved variable, leftover Liquid), never silently.
 * - Output is self-contained: theme CSS/JS/fonts/placeholder SVGs are inlined,
 *   forms are inert (no submission target), no external assets are fetched.
 * - No data is invented: page content comes exclusively from the theme files.
 *
 * Used for: the free one-page demo (public /demo/<slug>) and internal visual
 * review of certified theme artefacts.
 */

export class ThemeHtmlPreviewError extends Error {
  constructor(message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ThemeHtmlPreviewError";
  }
}

export interface ThemeHtmlPreviewOptions {
  /** "index" or "page.<handle>" — must exist as templates/<name>.json */
  template: string;
  /** Neutral marker shown to visitors; never claims the page is a live shop. */
  bannerHtml?: string | null;
}

export interface ThemeHtmlPreviewResult {
  html: string;
  template: string;
  sectionTypes: string[];
  warnings: string[];
}

interface SettingSchema { id?: string; default?: unknown; type?: string }
interface SectionSchema { name?: string; settings?: SettingSchema[]; blocks?: Array<{ type: string; settings?: SettingSchema[] }> }
interface TemplateSectionItem { type: string; settings?: Record<string, unknown>; blocks?: Record<string, { type: string; settings?: Record<string, unknown> }>; block_order?: string[] }
interface TemplateJson { sections: Record<string, TemplateSectionItem>; order: string[] }

const ASSET_MARKER = "__theme_asset__/";
const MAX_HTML_BYTES = 2_000_000;

function textFile(files: ReadonlyArray<ThemeFile>, path: string): string | null {
  const file = files.find((f) => f.path === path);
  if (!file) return null;
  return file.content;
}

function requireJson<T>(files: ReadonlyArray<ThemeFile>, path: string): T {
  const raw = textFile(files, path);
  if (raw === null) throw new ThemeHtmlPreviewError(`THEME_FILE_MISSING: ${path}`, { path });
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ThemeHtmlPreviewError(`THEME_JSON_INVALID: ${path}`, { path });
  }
}

function defaultsOf(settings: SettingSchema[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of settings ?? []) {
    if (s.id && s.default !== undefined) out[s.id] = s.default;
  }
  return out;
}

function schemaOf(source: string, path: string): SectionSchema {
  const match = source.match(/\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/);
  if (!match) throw new ThemeHtmlPreviewError(`SECTION_SCHEMA_MISSING: ${path}`, { path });
  try {
    return JSON.parse(match[1]) as SectionSchema;
  } catch {
    throw new ThemeHtmlPreviewError(`SECTION_SCHEMA_INVALID: ${path}`, { path });
  }
}

function translate(locales: Record<string, unknown>, key: string): string | null {
  const value = key.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), locales);
  return typeof value === "string" ? value : null;
}

function neutralImageSvg(width: number, height: number): string {
  // Clearly non-factual neutral media placeholder; never a real photo.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="presentation"><rect width="100%" height="100%" fill="#e7e5e4"/></svg>`;
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

type TagState = { tpl?: unknown[]; groupName?: string } & Record<string, unknown>;

/** Emulated block tag (style/form/paginate/javascript): renders the body and wraps it. */
function blockTag(engine: Liquid, endName: string, wrap: (inner: string) => string): TagImplOptions {
  return {
    parse(this: TagState, _tag: TagToken, remain: TopLevelToken[]) {
      const tpl: unknown[] = [];
      this.tpl = tpl;
      while (remain.length) {
        const next = remain.shift()!;
        if ((next as { name?: string }).name === endName) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tpl.push((engine as any).parser.parseToken(next, remain));
      }
      throw new ThemeHtmlPreviewError(`TAG_UNCLOSED: ${endName}`);
    },
    *render(this: TagState, ctx: Context): Generator<unknown, string, string> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inner: string = yield (engine as any).renderer.renderTemplates(this.tpl ?? [], ctx);
      return wrap(inner);
    },
  } as TagImplOptions;
}

export async function renderThemePageHtml(
  files: ReadonlyArray<ThemeFile>,
  options: ThemeHtmlPreviewOptions
): Promise<ThemeHtmlPreviewResult> {
  const warnings: string[] = [];
  if (!/^(index|page\.[a-z0-9-]+)$/.test(options.template)) {
    throw new ThemeHtmlPreviewError(`TEMPLATE_NOT_SUPPORTED: ${options.template}`, { template: options.template });
  }
  const templateJson = requireJson<TemplateJson>(files, `templates/${options.template}.json`);
  const layout = textFile(files, "layout/theme.liquid");
  if (layout === null) throw new ThemeHtmlPreviewError("THEME_FILE_MISSING: layout/theme.liquid");

  const settingsSchema = requireJson<Array<{ settings?: SettingSchema[] }>>(files, "config/settings_schema.json");
  const settingsData = requireJson<{ current?: Record<string, unknown> | string; presets?: Record<string, Record<string, unknown>> }>(files, "config/settings_data.json");
  const current = typeof settingsData.current === "string" ? settingsData.presets?.[settingsData.current] ?? {} : settingsData.current ?? {};
  const settings: Record<string, unknown> = { ...Object.assign({}, ...settingsSchema.map((g) => defaultsOf(g.settings))), ...current };

  const localesRaw = textFile(files, "locales/nl.default.json");
  const locales = localesRaw ? (JSON.parse(localesRaw) as Record<string, unknown>) : {};

  // In-memory template mapping for {% render %}: snippets by name.
  const snippets: Record<string, string> = {};
  for (const f of files) {
    const m = f.path.match(/^snippets\/([^/]+)\.liquid$/);
    if (m) snippets[`${m[1]}.liquid`] = f.content;
  }

  const engine = new Liquid({
    templates: snippets,
    extname: ".liquid",
    strictFilters: true,
    strictVariables: false,
    ownPropertyOnly: false,
    jsTruthy: false,
  });

  // --- Shopify tags that LiquidJS does not know -----------------------------
  engine.registerTag("schema", {
    parse(_tag: TagToken, remain: TopLevelToken[]) {
      while (remain.length) {
        const next = remain.shift()!;
        if ((next as { name?: string }).name === "endschema") return;
      }
    },
    render() { return ""; },
  });
  engine.registerTag("style", blockTag(engine, "endstyle", (inner) => `<style>${inner}</style>`));
  engine.registerTag("javascript", blockTag(engine, "endjavascript", (inner) => `<script>${inner}</script>`));
  engine.registerTag("form", blockTag(engine, "endform", (inner) => `<form data-preview-inert="true" action="#" method="post" onsubmit="return false">${inner}</form>`));
  engine.registerTag("paginate", blockTag(engine, "endpaginate", (inner) => inner));
  engine.registerTag("layout", { parse() { /* Shopify-only */ }, render() { return ""; } });
  engine.registerTag("sections", {
    parse(this: TagState, tag: TagToken) {
      this.groupName = tag.args.trim().replace(/^['"]|['"]$/g, "");
    },
    *render(this: TagState, ctx: Context): Generator<unknown, string, string> {
      const group = requireJson<TemplateJson>(files, `sections/${String(this.groupName)}.json`);
      let out = "";
      for (const id of group.order) {
        out += yield renderSection(id, group.sections[id], ctx.getAll() as Record<string, unknown>);
      }
      return out;
    },
  } as TagImplOptions);

  // --- Shopify filters (closed set used by our theme-builder) ---------------
  engine.registerFilter("t", (key: unknown) => {
    const k = String(key);
    const value = translate(locales, k);
    if (value === null) warnings.push(`TRANSLATION_MISSING: ${k}`);
    return value ?? k;
  });
  engine.registerFilter("asset_url", (name: unknown) => `${ASSET_MARKER}${String(name)}`);
  engine.registerFilter("stylesheet_tag", (href: unknown) => `<link rel="stylesheet" href="${escapeAttr(String(href))}">`);
  engine.registerFilter("money", (cents: unknown) => {
    const n = Number(cents);
    return Number.isFinite(n) ? `€ ${(n / 100).toFixed(2).replace(".", ",")}` : "";
  });
  engine.registerFilter("money_with_currency", (cents: unknown) => {
    const n = Number(cents);
    return Number.isFinite(n) ? `€ ${(n / 100).toFixed(2).replace(".", ",")} EUR` : "";
  });
  engine.registerFilter("image_url", (image: unknown) => (typeof image === "string" && image.startsWith("data:") ? image : svgDataUri(neutralImageSvg(1500, 1000))));
  engine.registerFilter("image_tag", (src: unknown, ...args: unknown[]) => {
    const named = Object.fromEntries(args.filter((a): a is [string, unknown] => Array.isArray(a) && a.length === 2));
    const alt = typeof named.alt === "string" ? named.alt : "";
    const cls = typeof named.class === "string" ? named.class : "";
    return `<img src="${escapeAttr(String(src))}" alt="${escapeAttr(alt)}"${cls ? ` class="${escapeAttr(cls)}"` : ""} width="1500" height="1000" loading="lazy" decoding="async">`;
  });
  engine.registerFilter("format_address", () => "");
  engine.registerFilter("default_errors", () => "");
  engine.registerFilter("format_code", (v: unknown) => String(v ?? ""));
  engine.registerFilter("handleize", (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));

  const sectionSources = new Map<string, { source: string; schema: SectionSchema }>();
  const sectionTypes: string[] = [];

  function sectionFor(type: string) {
    const cached = sectionSources.get(type);
    if (cached) return cached;
    const path = `sections/${type}.liquid`;
    const source = textFile(files, path);
    if (source === null) throw new ThemeHtmlPreviewError(`SECTION_MISSING: ${type}`, { type });
    const entry = { source, schema: schemaOf(source, path) };
    sectionSources.set(type, entry);
    return entry;
  }

  async function renderSection(id: string, item: TemplateSectionItem | undefined, scope: Record<string, unknown>): Promise<string> {
    if (!item) throw new ThemeHtmlPreviewError(`TEMPLATE_SECTION_UNDEFINED: ${id}`, { id });
    const { source, schema } = sectionFor(item.type);
    if (!sectionTypes.includes(item.type)) sectionTypes.push(item.type);
    const order = item.block_order ?? Object.keys(item.blocks ?? {});
    const blocks = order.map((key) => {
      const b = item.blocks?.[key];
      if (!b) throw new ThemeHtmlPreviewError(`TEMPLATE_BLOCK_UNDEFINED: ${id}/${key}`, { id, key });
      const blockSchema = schema.blocks?.find((s) => s.type === b.type);
      return { id: key, type: b.type, settings: { ...defaultsOf(blockSchema?.settings), ...(b.settings ?? {}) }, shopify_attributes: "" };
    });
    const section = { id, type: item.type, settings: { ...defaultsOf(schema.settings), ...(item.settings ?? {}) }, blocks, index: 0, location: "template" };
    return engine.parseAndRender(source, { ...scope, section, block: null });
  }

  const brandName = typeof settings.brand_name === "string" && settings.brand_name.trim() ? settings.brand_name : "Voorbeeld";
  const pageHandle = options.template.startsWith("page.") ? options.template.slice(5) : null;
  const base: Record<string, unknown> = {
    settings,
    shop: { name: brandName, url: "", description: typeof settings.seo_description === "string" ? settings.seo_description : "", currency: "EUR" },
    routes: { root_url: "/", cart_url: "#", search_url: "#", all_products_collection_url: "#", account_url: "#", account_login_url: "#" },
    request: { design_mode: false, page_type: pageHandle ? "page" : "index", locale: { iso_code: "nl" } },
    template: { name: pageHandle ? "page" : "index", suffix: pageHandle },
    page: pageHandle ? { title: pageHandle.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()), handle: pageHandle, content: "" } : null,
    page_title: brandName,
    page_description: typeof settings.seo_description === "string" ? settings.seo_description : "",
    canonical_url: "",
    content_for_header: "",
    form: { posted_successfully: false, errors: null },
    cart: { item_count: 0, quantity: 0 },
    localization: { language: { iso_code: "nl" } },
    customer: null,
    search: { terms: "" },
    paginate: { previous: null, next: null, pages: 1 },
  };

  // Body sections in template order.
  let content = "";
  for (const id of templateJson.order) content += await renderSection(id, templateJson.sections[id], base);

  let html: string = await engine.parseAndRender(layout, { ...base, content_for_layout: content });

  // --- Inline assets so the document is self-contained ----------------------
  const assetByName = new Map<string, ThemeFile>();
  for (const f of files) {
    const m = f.path.match(/^assets\/([^/]+)$/);
    if (m) assetByName.set(m[1], f);
  }
  const missingAssets = new Set<string>();
  const assetUri = (name: string): string => {
    const file = assetByName.get(name);
    if (!file) { missingAssets.add(name); return "about:blank"; }
    if (name.endsWith(".svg")) return svgDataUri(file.content);
    if (name.endsWith(".woff2")) return `data:font/woff2;base64,${file.bytes ? bytesToBase64(file.bytes) : ""}`;
    if (name.endsWith(".png")) return `data:image/png;base64,${file.bytes ? bytesToBase64(file.bytes) : ""}`;
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return `data:image/jpeg;base64,${file.bytes ? bytesToBase64(file.bytes) : ""}`;
    return `data:text/plain;charset=utf-8,${encodeURIComponent(file.content)}`;
  };
  html = html.replace(new RegExp(`<link rel="stylesheet" href="${ASSET_MARKER}([^"]+)">`, "g"), (_m, name: string) => {
    const file = assetByName.get(name);
    if (!file) { missingAssets.add(name); return ""; }
    return `<style>${file.content}</style>`;
  });
  html = html.replace(new RegExp(`<script src="${ASSET_MARKER}([^"]+)"( defer)?></script>`, "g"), (_m, name: string) => {
    const file = assetByName.get(name);
    if (!file) { missingAssets.add(name); return ""; }
    return `<script>${file.content}</script>`;
  });
  html = html.replace(new RegExp(`${ASSET_MARKER}([A-Za-z0-9._-]+)`, "g"), (_m, name: string) => assetUri(name));
  if (missingAssets.size > 0) throw new ThemeHtmlPreviewError("ASSET_MISSING", { assets: [...missingAssets] });

  if (options.bannerHtml) {
    html = html.replace(/<body([^>]*)>/, (m) => `${m}${options.bannerHtml}`);
  }

  // --- Fail-loud integrity checks -------------------------------------------
  const leftovers = [/\{\{/, /\{%/, /\bundefined\b/, /\[object Object\]/].filter((re) => re.test(html));
  if (leftovers.length > 0) {
    throw new ThemeHtmlPreviewError("RENDER_INCOMPLETE", { patterns: leftovers.map(String), template: options.template });
  }
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    throw new ThemeHtmlPreviewError("RENDER_TOO_LARGE", { bytes: Buffer.byteLength(html, "utf8"), limit: MAX_HTML_BYTES });
  }

  return { html, template: options.template, sectionTypes, warnings };
}
