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

/**
 * Shopify import-mirror: de ZIP-import/theme-editor keurt select-/radio-
 * opties met een label langer dan 50 tekens af en valt dan het HELE
 * sectiebestand (en alle templates die ernaar verwijzen) stilletjes af.
 * Bewezen via Shopifys eigen FileSaveError op hero.liquid (2026-09-21):
 * "Invalid schema: setting with id=\"layout\" option label is too long
 * (max 50 characters)". Ondergrens bewijs: setting-labels van 54 tekens
 * zijn bewezen veilig (about.liquid importeerde); de limiet geldt dus
 * specifiek voor optielabels.
 */
const SCHEMA_OPTION_LABEL_MAX_LENGTH = 50;

function schemaOversizedOptionLabels(schema: Record<string, unknown>): string[] {
  const schendingen: string[] = [];
  const checkSettings = (settings: unknown[], context: string): void => {
    for (const rawSetting of settings) {
      if (!rawSetting || typeof rawSetting !== "object") continue;
      const setting = rawSetting as Record<string, unknown>;
      if (setting.type !== "select" && setting.type !== "radio") continue;
      if (!Array.isArray(setting.options)) continue;
      const id = typeof setting.id === "string" ? setting.id : "(zonder id)";
      for (const rawOption of setting.options) {
        if (!rawOption || typeof rawOption !== "object") continue;
        const option = rawOption as Record<string, unknown>;
        const label = typeof option.label === "string" ? option.label : "";
        if (label.length > SCHEMA_OPTION_LABEL_MAX_LENGTH) {
          schendingen.push(
            `setting "${id}"${context} option label is too long (${label.length} > ${SCHEMA_OPTION_LABEL_MAX_LENGTH} tekens): "${label}"`
          );
        }
      }
    }
  };
  if (Array.isArray(schema.settings)) {
    checkSettings(schema.settings, "");
  }
  if (Array.isArray(schema.blocks)) {
    for (const rawBlock of schema.blocks) {
      if (!rawBlock || typeof rawBlock !== "object") continue;
      const block = rawBlock as Record<string, unknown>;
      if (!Array.isArray(block.settings)) continue;
      const type = typeof block.type === "string" ? block.type : "(zonder type)";
      checkSettings(block.settings, ` (blok "${type}")`);
    }
  }
  return schendingen;
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

interface SectionSchemaShape {
  settingIds: Set<string>;
  blockTypes: Map<string, Set<string>>;
}

/**
 * Shopify-import-mirror: ZIP-uploads valideren JSON-templates strikt tegen
 * de sectie-schema's en laten templatebestanden met onbekende setting- of
 * blok-ids STIL vallen (de homepage wordt dan 404). Deze extractie maakt
 * die controle vóór oplevering mogelijk.
 */
function sectionSchemaShapeOf(content: string): SectionSchemaShape | null {
  const schema = sectionSchemaOf(content);
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  const record = schema as Record<string, unknown>;
  const settingIds = new Set<string>();
  const rawSettings = record.settings;
  if (Array.isArray(rawSettings)) {
    for (const setting of rawSettings) {
      if (setting && typeof setting === "object" && typeof (setting as Record<string, unknown>).id === "string") {
        settingIds.add((setting as Record<string, unknown>).id as string);
      }
    }
  }
  const blockTypes = new Map<string, Set<string>>();
  const rawBlocks = record.blocks;
  if (Array.isArray(rawBlocks)) {
    for (const block of rawBlocks) {
      if (!block || typeof block !== "object") continue;
      const blockRecord = block as Record<string, unknown>;
      if (typeof blockRecord.type !== "string") continue;
      const blockSettingIds = new Set<string>();
      if (Array.isArray(blockRecord.settings)) {
        for (const setting of blockRecord.settings as unknown[]) {
          if (setting && typeof setting === "object" && typeof (setting as Record<string, unknown>).id === "string") {
            blockSettingIds.add((setting as Record<string, unknown>).id as string);
          }
        }
      }
      blockTypes.set(blockRecord.type, blockSettingIds);
    }
  }
  return { settingIds, blockTypes };
}

function validateSectionAgainstSchema(
  where: string,
  entry: Record<string, unknown>,
  schema: SectionSchemaShape | null,
  errors: string[]
): void {
  if (!schema) return;
  const settings = entry.settings;
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    for (const id of Object.keys(settings as Record<string, unknown>)) {
      if (!schema.settingIds.has(id)) {
        errors.push(
          `${where}: setting "${id}" bestaat niet in het schema van de sectie (Shopify laat dit templatebestand bij ZIP-import vallen).`
        );
      }
    }
  }
  const blocks = entry.blocks;
  if (blocks && typeof blocks === "object" && !Array.isArray(blocks)) {
    for (const [blockKey, blockValue] of Object.entries(blocks as Record<string, unknown>)) {
      if (!SHOPIFY_TEMPLATE_ID_RE.test(blockKey)) {
        errors.push(
          `${where}: blok-ID "${blockKey}" bevat niet-alfanumerieke tekens (Shopify-docs: ID's alleen alfanumeriek; hyfens doen het hele template bij import vallen).`
        );
      }
      if (!blockValue || typeof blockValue !== "object" || Array.isArray(blockValue)) continue;
      const blockRecord = blockValue as Record<string, unknown>;
      const blockType = blockRecord.type;
      if (typeof blockType !== "string") {
        errors.push(`${where}: blok "${blockKey}" mist een type.`);
        continue;
      }
      const blockSettingIds = schema.blockTypes.get(blockType);
      if (!blockSettingIds) {
        errors.push(
          `${where}: bloktype "${blockType}" bestaat niet in het schema van de sectie (Shopify laat dit templatebestand bij ZIP-import vallen).`
        );
        continue;
      }
      const blockSettings = blockRecord.settings;
      if (blockSettings && typeof blockSettings === "object" && !Array.isArray(blockSettings)) {
        for (const id of Object.keys(blockSettings as Record<string, unknown>)) {
          if (!blockSettingIds.has(id)) {
            errors.push(
              `${where}: blok "${blockKey}" gebruikt setting "${id}" die niet in het schema van bloktype "${blockType}" bestaat (Shopify laat dit templatebestand bij ZIP-import vallen).`
            );
          }
        }
      }
    }
  }
}

/**
 * Shopify-template-ID's (section- én block-ID's) accepteren alleen
 * alfanumerieke tekens (docs); underscores zijn bewezen veilig (Dawn,
 * theme-editor). Hyfens laten Shopify het HELE templatebestand bij
 * ZIP-import vallen (live bewezen 2026-09-20: index.json + page.diensten.json).
 */
const SHOPIFY_TEMPLATE_ID_RE = /^[a-zA-Z0-9_]+$/;

function validateTemplates(
  parsed: Map<string, unknown>,
  sectionFiles: Set<string>,
  sectionSchemas: Map<string, SectionSchemaShape | null>,
  errors: string[]
): void {
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
      if (!SHOPIFY_TEMPLATE_ID_RE.test(key)) {
        errors.push(
          `Template "${path}": section-ID "${key}" bevat niet-alfanumerieke tekens (Shopify-docs: ID's alleen alfanumeriek; hyfens doen het hele template bij import vallen).`
        );
      }
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
        continue;
      }
      validateSectionAgainstSchema(
        `Template "${path}": sectie "${key}"`,
        value as Record<string, unknown>,
        sectionSchemas.get(type) ?? null,
        errors
      );
    }
  }

  // Section groups: geldig type (header/footer), verplichte name
  // (Shopify-spec) + sections-structuur met schema-valide content.
  for (const path of sectionGroups) {
    const data = parsed.get(path) as Record<string, unknown> | undefined;
    if (!data || typeof data !== "object") continue;
    const groupType = data.type;
    if (groupType !== "header" && groupType !== "footer") {
      errors.push(`Section group "${path}" moet type "header" of "footer" hebben.`);
    }
    const name = data.name;
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 50) {
      errors.push(`Section group "${path}" mist een geldige "name" (verplicht volgens de Shopify-spec, max 50 tekens).`);
    }
    const sections = data.sections;
    if (!sections || typeof sections !== "object") {
      errors.push(`Section group "${path}" mist een sections-object.`);
      continue;
    }
    for (const [key, value] of Object.entries(sections as Record<string, unknown>)) {
      if (!SHOPIFY_TEMPLATE_ID_RE.test(key)) {
        errors.push(
          `Section group "${path}": section-ID "${key}" bevat niet-alfanumerieke tekens (Shopify-docs: ID's alleen alfanumeriek).`
        );
      }
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      const type = entry.type;
      if (typeof type !== "string" || type.length === 0) {
        errors.push(`Section group "${path}": sectie "${key}" mist een type.`);
        continue;
      }
      if (type.startsWith("@")) continue; // app blocks: buiten de eigen thema-schema's
      if (!knownSectionTypes.has(type)) {
        errors.push(`Section group "${path}": sectietype "${type}" heeft geen bijbehorend sections/${type}.liquid.`);
        continue;
      }
      validateSectionAgainstSchema(
        `Section group "${path}": sectie "${key}"`,
        entry,
        sectionSchemas.get(type) ?? null,
        errors
      );
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
      } else if (schema && typeof schema === "object" && !Array.isArray(schema)) {
        for (const schending of schemaOversizedOptionLabels(schema as Record<string, unknown>)) {
          errors.push(
            `Sectie "${file.path}": Shopify schema-fout — ${schending} (Shopify laat deze sectie en alle templates die ernaar verwijzen bij ZIP-import stilletjes vallen).`
          );
        }
      }
    }
  }
}

function validateSecurityAndContent(files: ThemeFile[], trustedClaims: readonly string[], errors: string[]): void {
  for (const file of files) {
    if (!THEME_TEXT_EXTENSIONS.has(extensionOf(file.path))) continue;
    const content = file.content;

    for (const { pattern, reason } of SECRET_CONTENT_PATTERNS) {
      if (pattern.test(content)) {
        errors.push(`Mogelijk geheim (${reason}) gevonden in "${file.path}".`);
      }
    }

    const issues = scanTextForFabricationPatterns(content, trustedClaims);
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
    // Fase C: blueprint-secties met beeldsloten renderen óók centraal.
    "sections/projects.liquid",
    "sections/team.liquid",
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

/**
 * Fase C: trustedClaims = bewezen echte teksten (blueprint trustElements met
 * verplichte bron) die de fabricatie-scan NIET als fabricatie mag vlaggen.
 * Zonder trustedClaims gedraagt de scan zich exact als voorheen.
 */
export function validateThemeFiles(files: ThemeFile[], options?: { trustedClaims?: readonly string[] }): ThemeValidationResult {
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
    const bytes = file.bytes ? file.bytes.byteLength : Buffer.byteLength(file.content, "utf8");
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
  const sectionSchemas = new Map<string, SectionSchemaShape | null>();
  for (const path of sectionLiquid) {
    const content = files.find((f) => f.path === path)?.content ?? "";
    const sectionType = path.slice("sections/".length, -".liquid".length);
    sectionSchemas.set(sectionType, content.length > 0 ? sectionSchemaShapeOf(content) : null);
  }
  const assetPaths = new Set(files.filter((f) => f.path.startsWith("assets/")).map((f) => f.path));
  const snippetPaths = new Set(files.filter((f) => f.path.startsWith("snippets/")).map((f) => f.path));
  const sectionGroupPaths = new Set(
    files.filter((f) => /^sections\/[^/]+-group\.json$/.test(f.path)).map((f) => f.path)
  );
  validateTemplates(parsed, sectionLiquid, sectionSchemas, errors);

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
  validateSecurityAndContent(files, options?.trustedClaims ?? [], errors);

  return { passed: errors.length === 0, errors, fileCount: files.length, totalBytes };
}

function contentHasBinaryJunk(content: string): boolean {
  return content.includes("\u0000");
}
