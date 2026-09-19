import { scanTextForFabricationPatterns } from "../safety-check";
import {
  THEME_ALLOWED_DIRECTORIES,
  THEME_ALLOWED_EXTENSIONS,
  THEME_LIQUID_ALLOWED_TAGS,
  THEME_LIQUID_BLOCK_TAGS,
  THEME_REQUIRED_FILES,
  THEME_REQUIRED_SETTING_IDS,
  THEME_TEXT_EXTENSIONS,
  THEME_ZIP_MAX_FILE_BYTES,
  THEME_ZIP_MAX_FILES,
  THEME_ZIP_MAX_TOTAL_BYTES,
  type ThemeFile,
} from "./theme-structure";

/**
 * Deterministische thema-validatie (Fase I.2) — vóór opslag en vóór eventuele
 * levering wordt ELKE ZIP (ook geregenereerde) opnieuw volledig gevalideerd:
 * structuur, Liquid/JSON, interne referenties, vereiste bestanden, assets,
 * configuratie én afwijzing van secrets/dev-bestanden en verzonnen feiten.
 *
 * Puur en synchroon: dezelfde input → zelfde errors. Geen AI, geen netwerk.
 */

export interface ThemeValidationResult {
  passed: boolean;
  errors: string[];
  fileCount: number;
  totalBytes: number;
}

/** Padpatronen die nooit in een thema-ZIP mogen voorkomen. */
const FORBIDDEN_PATH_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /(^|\/)\.env($|[._-])/i, reason: "environment/secrets-bestand" },
  { pattern: /(^|\/)\.git(\/|$)/i, reason: "git-metadata" },
  { pattern: /(^|\/)node_modules(\/|$)/i, reason: "dependency-map" },
  { pattern: /(^|\/)__MACOSX(\/|$)/i, reason: "macOS-archiefrest" },
  { pattern: /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml)$/i, reason: "npm-manifest (dev-only)" },
  { pattern: /(^|\/)(\.(?!saas)|Thumbs\.db|desktop\.ini)$/i, reason: "verborgen systeembestand" },
  { pattern: /\.(log|map|lock|md|ts|tsx|py|sh)$/i, reason: "dev-only bestandsextensie" },
  { pattern: /(^|\/)(\.DS_Store)$/i, reason: "systeembestand" },
];

/** Inhoudspatronen die op secrets wijzen. */
const SECRET_CONTENT_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(sk-[a-zA-Z0-9]{16,}|sbp_[a-zA-Z0-9]{16,}|ghp_[a-zA-Z0-9]{20,}|gho_[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|GOCSPX[a-zA-Z0-9_-]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,})\b/, reason: "bekende API-key-prefix" },
  { pattern: /\b(api[_-]?key|secret|password|passwd|token|bearer)\b\s*[:=]\s*["'][^"']{8,}["']/i, reason: "hardcoded credential-assignment" },
  { pattern: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, reason: "private key-blok" },
];

function extensionOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? "" : path.slice(idx).toLowerCase();
}

function isAllowedDirectory(path: string): boolean {
  // Bestanden zonder map (bijv. "README.md") zijn sowieso afgewezen door de
  // extensieregels; bestanden moeten in een toegestane themamap staan.
  const slash = path.indexOf("/");
  if (slash === -1) return false;
  const dir = path.slice(0, slash + 1);
  if (THEME_ALLOWED_DIRECTORIES.has(dir)) return true;
  // Geneste paden zoals templates/customers/*: controleer de eerste map.
  return THEME_ALLOWED_DIRECTORIES.has(dir);
}

/** Zoekt {% ... %} en {{ ... }} constructies; misvormde constructies zijn fout. */
export interface LiquidTagScan {
  tags: string[];
  malformed: string[];
  outputs: string[];
}

export function scanLiquidTags(content: string): LiquidTagScan {
  const tags: string[] = [];
  const malformed: string[] = [];
  const outputs: string[] = [];
  const tagRegex = /\{%-?\s*(\w+)([^%]*?)-?%\}/g;
  const outputRegex = /\{\{-?\s*([^}?]*?)\s*-?\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(content)) !== null) {
    tags.push(match[1].toLowerCase());
  }
  while ((match = outputRegex.exec(content)) !== null) {
    outputs.push(match[1]);
  }
  // Ongepaarde constructies: een {% of {{ zonder sluiting binnen redelijke afstand.
  const openCount = (content.match(/\{[{%]/g) ?? []).length;
  const closeCount = (content.match(/[%}]\}/g) ?? []).length;
  if (openCount !== closeCount) {
    malformed.push(`ongebruikelijk aantal openings- (${openCount}) t.o.v. sluitingsconstructies (${closeCount})`);
  }
  return { tags, malformed, outputs };
}

function validateJsonFiles(files: ThemeFile[], errors: string[]): Map<string, unknown> {
  const parsed = new Map<string, unknown>();
  for (const file of files) {
    if (extensionOf(file.path) !== ".json") continue;
    try {
      parsed.set(file.path, JSON.parse(file.content));
    } catch (error) {
      errors.push(`Ongeldige JSON in "${file.path}": ${(error as Error).message}`);
    }
  }
  return parsed;
}

function assertSettingsConfig(parsed: Map<string, unknown>, errors: string[]): void {
  const schema = parsed.get("config/settings_schema.json");
  if (Array.isArray(schema)) {
    const first = schema[0] as Record<string, unknown> | undefined;
    if (!first || first.name !== "theme_info") {
      errors.push('config/settings_schema.json moet beginnen met een theme_info-object.');
    } else {
      if (typeof first.theme_name !== "string" || first.theme_name.trim().length === 0) {
        errors.push("theme_info.theme_name ontbreekt.");
      }
      if (typeof first.theme_version !== "string" || first.theme_version.trim().length === 0) {
        errors.push("theme_info.theme_version ontbreekt.");
      }
      if (typeof first.theme_author !== "string" || first.theme_author.trim().length === 0) {
        errors.push("theme_info.theme_author ontbreekt.");
      }
    }
  } else {
    errors.push("config/settings_schema.json moet een JSON-array met theme_info zijn.");
  }

  const data = parsed.get("config/settings_data.json");
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const current = (data as Record<string, unknown>).current;
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      errors.push('config/settings_data.json moet een "current"-object bevatten.');
    }
  } else {
    errors.push("config/settings_data.json moet een JSON-object zijn.");
  }
}

function sectionSchemaOf(content: string): unknown | null {
  const match = content.match(/\{%\s*-?\s*schema\s*-?\s*%\}([\s\S]*?)\{%\s*-?\s*endschema\s*-?\s*%\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return "invalid";
  }
}

function validateTemplates(parsed: Map<string, unknown>, sectionFiles: Set<string>, errors: string[]): void {
  const templatePaths = [...parsed.keys()].filter((p) => p.startsWith("templates/"));
  const sectionGroups = new Set(
    [...parsed.keys()].filter((p) => p.startsWith("sections/") && p.endsWith("-group.json"))
  );

  const knownSectionTypes = new Set(
    [...sectionFiles].map((p) => p.slice("sections/".length, -".liquid".length))
  );

  for (const path of templatePaths) {
    const data = parsed.get(path);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      errors.push(`Template "${path}" moet een JSON-object zijn.`);
      continue;
    }
    const sections = (data as Record<string, unknown>).sections;
    const order = (data as Record<string, unknown>).order;
    if (!sections || typeof sections !== "object" || Array.isArray(sections)) {
      errors.push(`Template "${path}" mist een geldig "sections"-object.`);
      continue;
    }
    if (!Array.isArray(order) || order.length === 0) {
      errors.push(`Template "${path}" mist een niet-lege "order"-array.`);
      continue;
    }
    const keys = new Set(Object.keys(sections));
    for (const key of order) {
      if (typeof key !== "string" || !keys.has(key)) {
        errors.push(`Template "${path}": order-verwijzing "${String(key)}" bestaat niet in sections.`);
      }
    }
    for (const [key, value] of Object.entries(sections)) {
      if (!value || typeof value !== "object") {
        errors.push(`Template "${path}": sectie "${key}" is geen object.`);
        continue;
      }
      const type = (value as Record<string, unknown>).type;
      if (typeof type !== "string" || type.length === 0) {
        errors.push(`Template "${path}": sectie "${key}" mist een type.`);
        continue;
      }
      if (!knownSectionTypes.has(type)) {
        errors.push(`Template "${path}": sectietype "${type}" heeft geen bijbehorend sections/${type}.liquid.`);
      }
    }
  }

  // Section groups: geldig type (header/footer) + sections-structuur.
  for (const path of sectionGroups) {
    const data = parsed.get(path) as Record<string, unknown> | undefined;
    if (!data || typeof data !== "object") continue;
    const groupType = data.type;
    if (groupType !== "header" && groupType !== "footer") {
      errors.push(`Section group "${path}" moet type "header" of "footer" hebben.`);
    }
    const sections = data.sections;
    if (!sections || typeof sections !== "object") {
      errors.push(`Section group "${path}" mist een sections-object.`);
    }
  }
}

function validateLiquidContent(files: ThemeFile[], assetPaths: Set<string>, snippetPaths: Set<string>, sectionGroupPaths: Set<string>, sectionLiquidPaths: Set<string>, errors: string[]): void {
  for (const file of files) {
    if (extensionOf(file.path) !== ".liquid") continue;
    const scan = scanLiquidTags(file.content);

    for (const malformed of scan.malformed) {
      errors.push(`Liquid in "${file.path}": ${malformed}.`);
    }

    // Onbekende tags weigeren (deterministische generator kent alleen deze set).
    for (const tag of scan.tags) {
      if (!THEME_LIQUID_ALLOWED_TAGS.has(tag)) {
        errors.push(`Onbekende Liquid-tag "{% ${tag} %}" in "${file.path}".`);
      }
    }

    // Gebalanceerde blok-tags.
    const counts = new Map<string, number>();
    for (const tag of scan.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    for (const [open, close] of THEME_LIQUID_BLOCK_TAGS) {
      const opened = counts.get(open) ?? 0;
      const closed = counts.get(close) ?? 0;
      if (opened !== closed) {
        errors.push(`Niet-gebalanceerde Liquid-tags in "${file.path}": ${opened}x "{% ${open} %}" t.o.v. ${closed}x "{% ${close} %}".`);
      }
    }

    // render/section/sections-doelen moeten bestaan.
    const renderRegex = /\{%-?\s*render\s+'([^']+)'/g;
    const sectionRegex = /\{%-?\s*section\s+'([^']+)'/g;
    const sectionsRegex = /\{%-?\s*sections\s+'([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = renderRegex.exec(file.content)) !== null) {
      if (!snippetPaths.has(`snippets/${m[1]}.liquid`)) {
        errors.push(`"${file.path}" rendert onbekende snippet "${m[1]}".`);
      }
    }
    while ((m = sectionRegex.exec(file.content)) !== null) {
      if (!sectionLiquidPaths.has(`sections/${m[1]}.liquid`)) {
        errors.push(`"${file.path}" rendert onbekende sectie "${m[1]}".`);
      }
    }
    while ((m = sectionsRegex.exec(file.content)) !== null) {
      if (!sectionGroupPaths.has(`sections/${m[1]}.json`)) {
        errors.push(`"${file.path}" rendert onbekende section group "${m[1]}".`);
      }
    }

    // asset_url-verwijzingen moeten bestaan.
    const assetRegex = /'([^']+)'\s*\|\s*asset_url/g;
    while ((m = assetRegex.exec(file.content)) !== null) {
      if (!assetPaths.has(`assets/${m[1]}`)) {
        errors.push(`"${file.path}" verwijst naar onbekende asset "${m[1]}".`);
      }
    }

    // Verboden patronen: deprecated include, onveilige include met variabele.
    if (/\{%-?\s*include\s+/.test(file.content)) {
      errors.push(`Verboden {% include %} in "${file.path}" — gebruik {% render %}.`);
    }

    // Section-schema moet geldige JSON met een name bevatten.
    const schema = sectionSchemaOf(file.content);
    if (file.path.startsWith("sections/") && !file.path.endsWith("-group.json")) {
      if (schema === null) {
        errors.push(`Sectie "${file.path}" mist een {% schema %}-blok.`);
      } else if (schema === "invalid") {
        errors.push(`Sectie "${file.path}" heeft ongeldige JSON in het {% schema %}-blok.`);
      } else if (
        !schema ||
        typeof schema !== "object" ||
        typeof (schema as Record<string, unknown>).name !== "string" ||
        ((schema as Record<string, unknown>).name as string).trim().length === 0
      ) {
        errors.push(`Sectie "${file.path}" mist een "name" in het schema.`);
      }
    }
  }
}

function validateSecurityAndContent(files: ThemeFile[], errors: string[]): void {
  for (const file of files) {
    if (!THEME_TEXT_EXTENSIONS.has(extensionOf(file.path))) continue;
    const content = file.content;

    for (const { pattern, reason } of SECRET_CONTENT_PATTERNS) {
      if (pattern.test(content)) {
        errors.push(`Mogelijk geheim (${reason}) gevonden in "${file.path}".`);
      }
    }

    const issues = scanTextForFabricationPatterns(content);
    for (const issue of issues) {
      errors.push(`Fabricatie-patroon "${issue.rule}" in "${file.path}": ${issue.reason}`);
    }
  }
}

/**
 * Volledige validatie van een set themabestanden (de inhoud van een ZIP).
 * Alle controles draaien op alles: een ZIP die hier niet doorheen komt, wordt
 * nooit opgeslagen als geldig artefact.
 */
/**
 * 5d. Media-slotverplichtingen (R1 — Media & beelden): de gecontroleerde
 * secties met beeldsloten (hero/about/services/gallery) MOETEN renderen via
 * het centrale theme-media-snippet; het snippet zelf moet responsive Shopify-
 * image_tag-rendering (sizes) gebruiken; alle via render-parameters
 * doorgegeven placeholder-assets moeten bestaan; en externe afbeeldings-URL's
 * zijn verboden (geen stock-foto's, geen tracking-pixels, geen fabricatie).
 */
function validateMediaSlots(files: ThemeFile[], assetPaths: Set<string>, errors: string[]): void {
  const byPath = new Map(files.map((f) => [f.path, f.content]));

  // 1. Secties met beeldsloten renderen via het centrale snippet.
  const MEDIA_SECTION_PATHS = [
    "sections/hero.liquid",
    "sections/about.liquid",
    "sections/services.liquid",
    "sections/gallery.liquid",
  ] as const;
  for (const path of MEDIA_SECTION_PATHS) {
    const content = byPath.get(path);
    if (content !== undefined && !content.includes("render 'theme-media'")) {
      errors.push(
        `Sectie "${path}" moet beeldsloten renderen via {% render 'theme-media' %} (centrale media-renderer).`
      );
    }
  }

  // 2. Het snippet zelf: responsive Shopify-rendering met sizes + focal point.
  const snippet = byPath.get("snippets/theme-media.liquid");
  if (snippet !== undefined) {
    if (!snippet.includes("image_tag")) {
      errors.push("snippets/theme-media.liquid moet echte afbeeldingen renderen via image_tag.");
    }
    if (!snippet.includes("sizes:")) {
      errors.push("snippets/theme-media.liquid mist een sizes-attribuut (responsive afbeeldingen vereist).");
    }
    if (!snippet.includes("image_mobile")) {
      errors.push("snippets/theme-media.liquid mist ondersteuning voor een aparte mobiele afbeelding.");
    }
    if (!snippet.includes("focal_point")) {
      errors.push("snippets/theme-media.liquid mist focal-point-ondersteuning (object-position).");
    }
  }

  // 3. Placeholder-assets die via render-parameters zijn doorgegeven moeten
  //    bestaan in assets/ (variable indirection ontsnapt aan de bestaande
  //    literal-asset_url-controle).
  const placeholderParam = /placeholder_svg:\s*'([^']+)'/g;
  for (const file of files) {
    if (!file.path.endsWith(".liquid")) continue;
    let m: RegExpExecArray | null;
    while ((m = placeholderParam.exec(file.content)) !== null) {
      if (!assetPaths.has(`assets/${m[1]}`)) {
        errors.push(`"${file.path}" verwijst naar onbekende placeholder-asset "${m[1]}".`);
      }
    }
  }

  // 4. Externe afbeeldings-URL's zijn verboden: alle beelden komen uit
  //    Shopify-assets of image_picker-settings — nooit van een externe host.
  const externalMediaPattern = /(src|srcset|data-src)\s*=\s*["']https?:\/\//i;
  for (const file of files) {
    if (!file.path.endsWith(".liquid") && !file.path.endsWith(".json")) continue;
    if (externalMediaPattern.test(file.content)) {
      errors.push(
        `Extern afbeeldings-URL in "${file.path}" — beelden mogen alleen via assets of image_picker-settings (geen stock-foto's).`
      );
    }
  }
}

export function validateThemeFiles(files: ThemeFile[]): ThemeValidationResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;

  // ---- 1. Padstructuur
  if (files.length > THEME_ZIP_MAX_FILES) {
    errors.push(`Thema bevat ${files.length} bestanden (max ${THEME_ZIP_MAX_FILES}).`);
  }
  for (const file of files) {
    const path = file.path;
    if (path.length === 0) {
      errors.push("Leeg bestandspad.");
      continue;
    }
    if (seen.has(path)) {
      errors.push(`Dubbel bestandspad: "${path}".`);
      continue;
    }
    seen.add(path);
    if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
      errors.push(`Absoluut pad niet toegestaan: "${path}".`);
    }
    if (path.includes("..") || path.includes("\\")) {
      errors.push(`Onveilig pad (traversal/backslash): "${path}".`);
    }
    if (/[\u0000-\u001f]/.test(path)) {
      errors.push(`Controlcharacters in pad: "${path}".`);
    }
    for (const { pattern, reason } of FORBIDDEN_PATH_PATTERNS) {
      if (pattern.test(path)) {
        errors.push(`Verboden pad (${reason}): "${path}".`);
      }
    }
    if (!isAllowedDirectory(path)) {
      errors.push(`Bestand buiten toegestane themamappen: "${path}".`);
    }
    const ext = extensionOf(path);
    if (!THEME_ALLOWED_EXTENSIONS.has(ext)) {
      errors.push(`Niet-toegestane extensie "${ext}" : "${path}".`);
    }
    const bytes = Buffer.byteLength(file.content, "utf8");
    totalBytes += bytes;
    if (bytes > THEME_ZIP_MAX_FILE_BYTES) {
      errors.push(`Bestand "${path}" is te groot (${bytes} bytes).`);
    }
    if (THEME_TEXT_EXTENSIONS.has(ext) && contentHasBinaryJunk(file.content)) {
      errors.push(`Bestand "${path}" bevat binaire content in een tekstbestand.`);
    }
  }
  if (totalBytes > THEME_ZIP_MAX_TOTAL_BYTES) {
    errors.push(`Thema is te groot in totaal (${totalBytes} bytes, max ${THEME_ZIP_MAX_TOTAL_BYTES}).`);
  }

  // ---- 2. Vereiste bestanden
  for (const required of THEME_REQUIRED_FILES) {
    if (!seen.has(required)) {
      errors.push(`Vereist bestand ontbreekt: "${required}".`);
    }
  }

  // ---- 3. JSON-configuratie + templates
  const parsed = validateJsonFiles(files, errors);
  assertSettingsConfig(parsed, errors);
  const sectionLiquid = new Set(files.filter((f) => /^sections\/[^/]+\.liquid$/.test(f.path)).map((f) => f.path));
  const assetPaths = new Set(files.filter((f) => f.path.startsWith("assets/")).map((f) => f.path));
  const snippetPaths = new Set(files.filter((f) => f.path.startsWith("snippets/")).map((f) => f.path));
  const sectionGroupPaths = new Set(
    files.filter((f) => /^sections\/[^/]+-group\.json$/.test(f.path)).map((f) => f.path)
  );
  validateTemplates(parsed, sectionLiquid, errors);

  // ---- 4. Liquid-inhoud
  validateLiquidContent(files, assetPaths, snippetPaths, sectionGroupPaths, sectionLiquid, errors);

  // ---- 4b. Media-slotverplichtingen (R1)
  validateMediaSlots(files, assetPaths, errors);

  // ---- 5. Layout-verplichtingen
  const layout = files.find((f) => f.path === "layout/theme.liquid");
  if (layout) {
    if (!layout.content.includes("content_for_header")) {
      errors.push('layout/theme.liquid mist {{ content_for_header }}.');
    }
    if (!layout.content.includes("content_for_layout")) {
      errors.push('layout/theme.liquid mist {{ content_for_layout }}.');
    }
  }

  // ---- 5b. Completeness-referenties (Fase I.2): password-status, klantaccounts,
  //          cadeaubon, share-image en bedrijfsgegevens-settings zijn aaneengesloten
  //          verplichtingen — een thema dat hier iets mist is niet leverklaar.
  const passwordLayout = files.find((f) => f.path === "layout/password.liquid");
  if (passwordLayout) {
    if (!passwordLayout.content.includes("content_for_header")) {
      errors.push('layout/password.liquid mist {{ content_for_header }}.');
    }
    if (!passwordLayout.content.includes("content_for_layout")) {
      errors.push('layout/password.liquid mist {{ content_for_layout }}.');
    }
  }
  const passwordTemplate = files.find((f) => f.path === "templates/password.liquid");
  if (passwordTemplate && !passwordTemplate.content.includes("storefront_password")) {
    errors.push('templates/password.liquid mist het storefront_password-formulier.');
  }
  const giftCard = files.find((f) => f.path === "templates/gift_card.liquid");
  if (giftCard) {
    if (!giftCard.content.includes("{% layout none %}") && !giftCard.content.includes("{%- layout none %}")) {
      errors.push('templates/gift_card.liquid moet als standalone pagina met "{% layout none %}" beginnen.');
    }
    if (!giftCard.content.includes("gift_card.")) {
      errors.push('templates/gift_card.liquid moet data uit het gift_card-object tonen.');
    }
  }
  for (const file of files) {
    if (!file.path.startsWith("templates/customers/") || !file.path.endsWith(".liquid")) continue;
    if (!/customer/i.test(file.content) || file.content.trim().length < 100) {
      errors.push(
        `Klantaccounttemplate "${file.path}" is leeg of bevat geen customer-referenties (functionele accountpagina vereist).`
      );
    }
    if (file.path.endsWith("/login.liquid") && !file.content.includes("customer_login")) {
      errors.push('templates/customers/login.liquid mist het customer_login-formulier.');
    }
    if (file.path.endsWith("/register.liquid") && !file.content.includes("create_customer")) {
      errors.push('templates/customers/register.liquid mist het create_customer-formulier.');
    }
  }

  // ---- 5c. Settings-referenties: bedrijfsgegevens/SEO-settings moeten gedefinieerd
  //          zijn (bron van og:image, JSON-LD en de meta-description-fallback).
  const schemaForSettings = parsed.get("config/settings_schema.json");
  if (Array.isArray(schemaForSettings)) {
    const definedIds = new Set<string>();
    for (const group of schemaForSettings) {
      const settings = (group as Record<string, unknown>)?.settings;
      if (!Array.isArray(settings)) continue;
      for (const setting of settings) {
        const id = (setting as Record<string, unknown>)?.id;
        if (typeof id === "string") definedIds.add(id);
      }
    }
    for (const requiredId of THEME_REQUIRED_SETTING_IDS) {
      if (!definedIds.has(requiredId)) {
        errors.push(`Setting "${requiredId}" ontbreekt in config/settings_schema.json (vereist voor meta-tags/SEO).`);
      }
    }
  }
  const metaTags = files.find((f) => f.path === "snippets/meta-tags.liquid");
  if (metaTags) {
    if (!metaTags.content.includes("settings.share_image") || !metaTags.content.includes("og:image")) {
      errors.push("snippets/meta-tags.liquid mist og:image-support via settings.share_image.");
    }
    if (!metaTags.content.includes("application/ld+json")) {
      errors.push("snippets/meta-tags.liquid mist JSON-LD structured data.");
    }
  }
  if (layout) {
    if (!layout.content.includes("page_title")) {
      errors.push('layout/theme.liquid mist de page_title-fallback in de <title>.');
    }
    if (!layout.content.includes("settings.seo_description")) {
      errors.push('layout/theme.liquid mist de settings.seo_description-fallback voor de meta-description.');
    }
  }

  // ---- 6. Secrets + fabricatie
  validateSecurityAndContent(files, errors);

  return { passed: errors.length === 0, errors, fileCount: files.length, totalBytes };
}

function contentHasBinaryJunk(content: string): boolean {
  return content.includes("\u0000");
}
