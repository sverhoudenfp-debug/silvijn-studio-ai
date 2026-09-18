/**
 * Theme-structuurconstanten (Fase I.2) — Shopify Online Store 2.0.
 *
 * BRON: de gedocumenteerde Shopify-themastructuur (docs: theme structure /
 * "The folder structure of a theme"). De referentie-thema's zijn uitsluitend
 * TECHNISCHE referenties: we kopiëren nooit hun visuele identiteit, layouts,
 * sectie-ontwerpen of assets. Elk gegenereerd thema is opgebouwd uit eigen,
 * deterministische Liquid-secties gevuld met de gevalideerde
 * WebsiteSpecification + het interne Design Plan van dít project.
 *
 * Vereiste mappen: assets/, config/, layout/, locales/, sections/, snippets/,
 * templates/. Vereiste bestanden voor een uploadbaar thema:
 * layout/theme.liquid, config/settings_schema.json, config/settings_data.json,
 * één templates/index.* en één locales/*.default.json.
 */

export interface ThemeFile {
  /** Positie binnen de ZIP, bijv. "layout/theme.liquid". */
  path: string;
  /** UTF-8 tekstinhoud. */
  content: string;
}

export const THEME_ZIP_ENTRY_DATE = Date.UTC(2026, 0, 1);
export const THEME_ZIP_MAX_FILES = 400;
export const THEME_ZIP_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const THEME_ZIP_MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Mappen die een geldig Shopify-thema mag bevatten (lowercase, met slash). */
export const THEME_ALLOWED_DIRECTORIES: ReadonlySet<string> = new Set([
  "assets/",
  "config/",
  "layout/",
  "locales/",
  "sections/",
  "snippets/",
  "templates/",
  "templates/customers/",
]);

/** Bestandsextensies die een gegenereerd thema mag bevatten. */
export const THEME_ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".liquid",
  ".json",
  ".css",
  ".js",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".ico",
  ".txt",
]);

/** Extensies die altijd als tekst gevalideerd worden. */
export const THEME_TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".liquid",
  ".json",
  ".css",
  ".js",
  ".txt",
]);

/**
 * Vereiste bestanden. Shopify weigert een ZIP zonder layout/theme.liquid,
 * settings_schema.json of index-template; de overige vereisten garanderen dat
 * een gegenereerd thema zonder extra werk uploadbaar én bruikbaar is.
 */
export const THEME_REQUIRED_FILES: readonly string[] = [
  "layout/theme.liquid",
  "config/settings_schema.json",
  "config/settings_data.json",
  "locales/nl.default.json",
  "assets/theme.css",
  "assets/theme.js",
  "sections/header.liquid",
  "sections/footer.liquid",
  "templates/index.json",
  "templates/page.json",
  "templates/404.json",
  "templates/cart.json",
  "templates/product.json",
  "templates/collection.json",
  "templates/search.json",
];

/**
 * Liquid-structuurtags die gebalanceerd moeten zijn (open → bijpassend eind-tag).
 */
export const THEME_LIQUID_BLOCK_TAGS: ReadonlyMap<string, string> = new Map(
  [
    ["if", "endif"],
    ["unless", "endunless"],
    ["for", "endfor"],
    ["case", "endcase"],
    ["capture", "endcapture"],
    ["schema", "endschema"],
    ["comment", "endcomment"],
    ["raw", "endraw"],
    ["paginate", "endpaginate"],
    ["form", "endform"],
    ["style", "endstyle"],
    ["stylesheet", "endstylesheet"],
    ["javascript", "endjavascript"],
  ] as [string, string][]
);

/**
 * Toegestande Liquid-tags (inleiding). Onbekende tags worden afgewezen: de
 * generator is deterministisch en kent dus exact de tags die het uitschrijft.
 */
export const THEME_LIQUID_ALLOWED_TAGS: ReadonlySet<string> = new Set([
  ...THEME_LIQUID_BLOCK_TAGS.keys(),
  "endif",
  "endunless",
  "endfor",
  "endcase",
  "endcapture",
  "endschema",
  "endcomment",
  "endraw",
  "endpaginate",
  "endform",
  "endstyle",
  "endstylesheet",
  "endjavascript",
  "else",
  "elsif",
  "when",
  "assign",
  "echo",
  "increment",
  "decrement",
  "cycle",
  "tablerow",
  "endtablerow",
  "liquid",
  "render",
  "section",
  "sections",
  "break",
  "continue",
  "ifchanged",
  "endifchanged",
]);
