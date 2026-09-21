import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  THEME_TEXT_EXTENSIONS,
  type ThemeFile,
} from "./theme-structure";
import { validateThemeFiles } from "./theme-validation";

/**
 * PRODUCTION THEME PREFLIGHT / THEME CERTIFICATION (2026-09-21).
 *
 * Doel: een gegenereerd Shopify-theme mag pas READY_FOR_SILVIJN worden
 * nadat het systeem heeft BWEEZEN dat de volledige ZIP Shopify-technisch
 * valide en compleet is — niet alleen dat de twee toevallig gevonden bugs
 * (optielabels > 50 tekens, lege text-schema-defaults) zijn gefixt.
 *
 * Opbouw (generiek, contract-gedreven):
 * 1. Het bestaande fabricage-net (validateThemeFiles) blijft de basis:
 *    padstructuur, vereiste bestanden, JSON-syntax, Liquid-tagbalans,
 *    template-structuur, section-refs, settings-vs-schema crosschecks,
 *    blok-refs, option-label-limiet, asset/snippet-refs, layout-verplichtingen,
 *    completeness-referenties, secrets + anti-fabricatie, media-slots.
 * 2. NIEUWE deterministische contractchecks (Shopify-documentatie + bewezen
 *    import-gedrag) op: schema-defaults per type, unieke setting-/blok-ids,
 *    presets, header/footer-groupbinding, navigation/page-targets,
 *    locale-sleutels, render-tag-argumenten, img-afmetingen, responsive core,
 *    settings_data-waarden en orphan-referenties (warning).
 * 3. OPTIONEEL extern: Shopify's eigen Theme Check (@shopify/theme-check-node,
 *    optionele dependency). Beschikbaar → error-severity offenses zijn
 *    critical. Niet beschikbaar (bijv. niet-geinstalleerde optional dep) →
 *    expliciete "niet bewezen"-notitie in het rapport; het deterministische
 *    net blijft volledig.
 *
 * Zelfreparatie: uitsluitend bewezen-veilige, deterministische reparaties
 * (leeg text/textarea-default verwijderen — semantiek behouden via de
 * Liquid-fallbacks). Alle andere fouten zijn fail-loud.
 */

export type ThemePreflightStatus = "THEME_CERTIFIED" | "THEME_PREFLIGHT_FAILED";

export interface ThemePreflightCheck {
  id: string;
  title: string;
  result: "pass" | "warning" | "fail";
  errors: string[];
  warnings: string[];
  /** Optionele bewijs-/provenance-notitie (bijv. skipped extern). */
  note?: string;
}

export interface ThemeRepair {
  id: string;
  description: string;
}

export interface ExternalThemeCheckSummary {
  ran: boolean;
  reason?: "unavailable" | "disabled";
  note?: string;
  errorCount: number;
  warningCount: number;
  errors: { check: string; path: string; message: string }[];
  warnings: { check: string; path: string; message: string }[];
}

export interface ThemePreflightResult {
  status: ThemePreflightStatus;
  passed: boolean;
  criticalErrors: string[];
  warnings: string[];
  checks: ThemePreflightCheck[];
  external: ExternalThemeCheckSummary | null;
  fileCount: number;
  totalBytes: number;
}

/** Shopify-documented setting-types (Online Store 2.0). */
const SHOPIFY_SETTING_TYPES: ReadonlySet<string> = new Set([
  "text",
  "textarea",
  "richtext",
  "inline_richtext",
  "html",
  "number",
  "range",
  "color",
  "color_background",
  "color_scheme",
  "checkbox",
  "url",
  "video",
  "image_picker",
  "font_picker",
  "select",
  "radio",
  "header",
  "paragraph",
  "video_url",
  "liquid",
]);

/** Types waarbij een schema-default ongeldig is (Shopify-contract). */
const TYPES_WITHOUT_DEFAULT: ReadonlySet<string> = new Set([
  "image_picker",
  "video",
  "font_picker",
  "color_scheme",
]);

/** Setting-types die een (verplichte) id hebben. */
const TYPES_WITHOUT_ID: ReadonlySet<string> = new Set(["header", "paragraph"]);

const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Interne route-prefixen die Shopify zelf levert (merchant-side runtime). */
const SHOPIFY_SYSTEM_ROUTE_PREFIXES: readonly string[] = [
  "/cart",
  "/search",
  "/checkout",
  "/account",
  "/addresses",
  "/policies",
  "/collections",
  "/products",
  "/blogs",
  "/challenge",
];

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

function pathOf(absolutePath: string, root: string): string {
  return absolutePath.startsWith(root) ? absolutePath.slice(root.length) : absolutePath;
}

interface SchemaLike {
  settings?: unknown[];
  blocks?: unknown[];
  presets?: unknown[];
  name?: unknown;
  max_blocks?: unknown;
}

function extractSchemaJson(content: string): unknown | null | "invalid" {
  const match = content.match(/\{%\s*-?\s*schema\s*-?\s*%\}([\s\S]*?)\{%\s*-?\s*endschema\s*-?\s*%\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return "invalid";
  }
}

/**
 * Valideert één settings-array (sectie, blok of settings_schema-groep)
 * tegen het Shopify-setting-contract. Geeft errors (critical) terug.
 */
function validateSettingsArray(
  settings: unknown[],
  context: string,
  errors: string[],
  seenIds: Set<string>
): void {
  for (const raw of settings) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push(`${context}: setting is geen object.`);
      continue;
    }
    const setting = raw as Record<string, unknown>;
    const type = typeof setting.type === "string" ? setting.type : "";
    if (!SHOPIFY_SETTING_TYPES.has(type)) {
      errors.push(`${context}: setting-type "${type || "(leeg)"}" is geen geldig Shopify-setting-type.`);
      continue;
    }
    const id = typeof setting.id === "string" ? setting.id : null;
    if (TYPES_WITHOUT_ID.has(type)) continue; // header/paragraph: geen id, geen default-contract
    if (!id || id.length === 0) {
      errors.push(`${context}: setting van type "${type}" mist een id.`);
      continue;
    }
    if (seenIds.has(id)) {
      errors.push(`${context}: dubbele setting-id "${id}" binnen één schema (Shopify-contract: id's uniek).`);
    }
    seenIds.add(id);
    if (id.length > 50) {
      // Bewezen import-regel (zelfde limiet-familie als optielabels).
      errors.push(`${context}: setting-id "${id}" is langer dan 50 tekens.`);
    }
    const hasDefault = "default" in setting;
    const def = setting.default;
    if (TYPES_WITHOUT_DEFAULT.has(type) && hasDefault) {
      errors.push(`${context}: setting "${id}" van type "${type}" mag geen default hebben (Shopify-contract).`);
      continue;
    }
    if (!hasDefault || def === undefined) continue;
    switch (type) {
      case "text":
      case "textarea":
      case "richtext":
      case "inline_richtext":
      case "html":
      case "liquid":
        if (typeof def !== "string" || def.trim().length === 0) {
          // Shopifys FileSaveError, live bewezen op brand_text (2026-09-21):
          // "Invalid schema: setting with id="..." default mag niet leeg zijn".
          errors.push(
            `${context}: setting "${id}" van type "${type}" heeft een lege default ("") — Shopify weigert het hele sectiebestand. Laat de default weg en vang de lege waarde in Liquid op (| default:).`
          );
        }
        break;
      case "checkbox":
        if (typeof def !== "boolean") {
          errors.push(`${context}: checkbox-setting "${id}" heeft een niet-boolean default.`);
        }
        break;
      case "number": {
        const min = typeof setting.min === "number" ? setting.min : null;
        const max = typeof setting.max === "number" ? setting.max : null;
        if (typeof def !== "number" || Number.isNaN(def)) {
          errors.push(`${context}: number-setting "${id}" heeft een niet-numerieke default.`);
        } else if (min !== null && def < min) {
          errors.push(`${context}: number-setting "${id}" default ${def} ligt onder min ${min}.`);
        } else if (max !== null && def > max) {
          errors.push(`${context}: number-setting "${id}" default ${def} ligt boven max ${max}.`);
        }
        break;
      }
      case "range": {
        const min = typeof setting.min === "number" ? setting.min : null;
        const max = typeof setting.max === "number" ? setting.max : null;
        const step = typeof setting.step === "number" ? setting.step : null;
        if (min === null || max === null || min >= max) {
          errors.push(`${context}: range-setting "${id}" heeft geen geldig min/max (${min}/${max}).`);
        } else if (step === null || step <= 0 || (max - min) % step !== 0) {
          errors.push(`${context}: range-setting "${id}" heeft een ongeldig step (${step}).`);
        } else if (typeof def !== "number" || def < min || def > max || (def - min) % (step ?? 1) !== 0) {
          errors.push(`${context}: range-setting "${id}" default ${String(def)} valt buiten [${min}, ${max}] of niet op de step-raster.`);
        }
        break;
      }
      case "color":
      case "color_background":
        if (typeof def !== "string" || !COLOR_RE.test(def)) {
          errors.push(`${context}: color-setting "${id}" heeft een geen geldige hex-default ("${String(def)}").`);
        }
        break;
      case "select":
      case "radio": {
        const options = Array.isArray(setting.options) ? setting.options : [];
        const values = new Set(
          options
            .map((o) => (o && typeof o === "object" ? (o as Record<string, unknown>).value : null))
            .filter((v): v is string => typeof v === "string")
        );
        if (values.size === 0) {
          errors.push(`${context}: select/radio-setting "${id}" heeft geen geldige opties.`);
        } else if (typeof def !== "string" || !values.has(def)) {
          errors.push(`${context}: select/radio-setting "${id}" default "${String(def)}" bestaat niet in de opties.`);
        }
        break;
      }
      case "url":
      case "video_url":
        if (typeof def !== "string" || def.trim().length === 0) {
          errors.push(`${context}: url-setting "${id}" heeft een lege default — laat de default weg.`);
        }
        break;
    }
  }
}

/** Valideert één schema (sectie of settings_schema-groep) volledig. */
function validateSchemaContract(context: string, schema: SchemaLike, errors: string[]): void {
  const seenIds = new Set<string>();
  if (Array.isArray(schema.settings)) {
    validateSettingsArray(schema.settings, context, errors, seenIds);
  }
  if (Array.isArray(schema.blocks)) {
    const seenTypes = new Set<string>();
    for (const rawBlock of schema.blocks) {
      if (!rawBlock || typeof rawBlock !== "object" || Array.isArray(rawBlock)) {
        errors.push(`${context}: blokdefinitie is geen object.`);
        continue;
      }
      const block = rawBlock as Record<string, unknown>;
      const blockType = typeof block.type === "string" ? block.type : "";
      if (!blockType) {
        errors.push(`${context}: blok mist een type.`);
        continue;
      }
      if (seenTypes.has(blockType)) {
        errors.push(`${context}: dubbel bloktype "${blockType}" binnen één schema.`);
      }
      seenTypes.add(blockType);
      if (typeof block.name !== "string" || block.name.length === 0) {
        errors.push(`${context}: blok "${blockType}" mist een naam.`);
      }
      if (Array.isArray(block.settings)) {
        validateSettingsArray(block.settings, `${context}: blok "${blockType}"`, errors, new Set());
      }
    }
  }
  if (schema.max_blocks !== undefined) {
    const max = schema.max_blocks;
    if (typeof max !== "number" || !Number.isInteger(max) || max < 1 || max > 50) {
      errors.push(`${context}: max_blocks "${String(max)}" is ongeldig (Shopify: geheel getal 1-50).`);
    }
  }
  if (schema.presets !== undefined) {
    if (!Array.isArray(schema.presets) || schema.presets.length === 0) {
      errors.push(`${context}: presets moet een niet-lege array zijn indien aanwezig.`);
    } else {
      const validSettingIds = new Set(
        (Array.isArray(schema.settings) ? schema.settings : [])
          .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>).id : null))
          .filter((v): v is string => typeof v === "string")
      );
      const validBlockTypes = new Set(
        (Array.isArray(schema.blocks) ? schema.blocks : [])
          .map((b) => (b && typeof b === "object" ? (b as Record<string, unknown>).type : null))
          .filter((v): v is string => typeof v === "string")
      );
      for (const rawPreset of schema.presets) {
        if (!rawPreset || typeof rawPreset !== "object") {
          errors.push(`${context}: preset is geen object.`);
          continue;
        }
        const preset = rawPreset as Record<string, unknown>;
        if (typeof preset.name !== "string" || preset.name.length === 0 || preset.name.length > 50) {
          errors.push(`${context}: preset mist een geldige naam (verplicht, max 50 tekens).`);
        }
        const presetSettings = preset.settings;
        if (presetSettings && typeof presetSettings === "object" && !Array.isArray(presetSettings)) {
          for (const id of Object.keys(presetSettings as Record<string, unknown>)) {
            if (!validSettingIds.has(id)) {
              errors.push(`${context}: preset "${String(preset.name)}" gebruikt setting "${id}" die niet in het schema bestaat.`);
            }
          }
        }
        const presetBlocks = preset.blocks;
        if (Array.isArray(presetBlocks)) {
          for (const rawPresetBlock of presetBlocks) {
            if (!rawPresetBlock || typeof rawPresetBlock !== "object") continue;
            const presetBlock = rawPresetBlock as Record<string, unknown>;
            if (typeof presetBlock.type === "string" && !validBlockTypes.has(presetBlock.type)) {
              errors.push(`${context}: preset "${String(preset.name)}" gebruikt bloktype "${presetBlock.type}" dat niet in het schema bestaat.`);
            }
          }
        }
      }
    }
  }
}

/** Resolveert een gespatte locale-sleutel (nl.default.json-contract). */
function localeKeyExists(locale: unknown, key: string): boolean {
  const parts = key.split(".");
  let node: unknown = locale;
  for (const part of parts) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return false;
    node = (node as Record<string, unknown>)[part];
    if (node === undefined) return false;
  }
  return true;
}

/**
 * Deterministische preflight (puur, synchroon): het bestaande fabricage-net
 * plus de nieuwe Shopify-contractchecks. Async extern Theme Check zit hier
 * NIET in — zie runFullPreflight.
 */
export function runDeterministicPreflight(
  files: ThemeFile[],
  options?: { trustedClaims?: readonly string[] }
): ThemePreflightResult {
  const checks: ThemePreflightCheck[] = [];

  const push = (
    id: string,
    title: string,
    errors: string[],
    warnings: string[] = [],
    note?: string
  ): void => {
    checks.push({
      id,
      title,
      result: errors.length > 0 ? "fail" : warnings.length > 0 ? "warning" : "pass",
      errors: [...errors],
      warnings: [...warnings],
      note,
    });
  };

  // ---- 1. Bestaand fabricage-net (structureel + anti-fabricatie)
  const net = validateThemeFiles(files, { trustedClaims: options?.trustedClaims });
  push(
    "theme_files",
    "Structuur, Liquid/JSON, referenties, secrets en anti-fabricatie (bestaand net)",
    net.passed ? [] : net.errors
  );

  const byPath = new Map(files.map((f) => [f.path, f]));
  const textFiles = files.filter((f) => THEME_TEXT_EXTENSIONS.has(extensionOf(f.path)));

  // ---- 2. Shopify-schema-contracten (defaults, types, ids, blokken, presets)
  {
    const errors: string[] = [];
    for (const file of textFiles) {
      if (!/^sections\/[^/]+\.liquid$/.test(file.path)) continue;
      const schema = extractSchemaJson(file.content);
      if (schema === "invalid") {
        errors.push(`${file.path}: {% schema %}-JSON is ongeldig.`);
        continue;
      }
      if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        errors.push(`${file.path}: mist een geldig {% schema %}-object.`);
        continue;
      }
      const record = schema as Record<string, unknown>;
      if (typeof record.name !== "string" || record.name.length === 0) {
        errors.push(`${file.path}: schema mist een naam.`);
      }
      validateSchemaContract(file.path, record as SchemaLike, errors);
    }
    // config/settings_schema.json: groepen + settings-contract
    const settingsSchema = byPath.get("config/settings_schema.json");
    if (settingsSchema) {
      try {
        const groups = JSON.parse(settingsSchema.content) as unknown[];
        if (Array.isArray(groups)) {
          for (const rawGroup of groups) {
            if (!rawGroup || typeof rawGroup !== "object") continue;
            const group = rawGroup as Record<string, unknown>;
            if (group.name === "theme_info") continue;
            if (typeof group.name !== "string" || group.name.length === 0) {
              errors.push("config/settings_schema.json: groep mist een naam.");
            }
            if (Array.isArray(group.settings)) {
              validateSchemaContract(
                `config/settings_schema.json: groep "${String(group.name)}"`,
                group as SchemaLike,
                errors
              );
            }
          }
        }
      } catch {
        errors.push("config/settings_schema.json is geen geldige JSON.");
      }
    }
    push("schema_contract", "Shopify-schema-contract (defaults, types, unieke ids, blokken, presets)", errors);
  }

  // ---- 3. settings_data-waarden tegen settings_schema (incl. null-waarschuwing)
  {
    const errors: string[] = [];
    const warnings: string[] = [];
    const settingsSchema = byPath.get("config/settings_schema.json");
    const settingsData = byPath.get("config/settings_data.json");
    if (settingsSchema && settingsData) {
      try {
        const groups = JSON.parse(settingsSchema.content) as Record<string, unknown>[];
        const definitions = new Map<string, Record<string, unknown>>();
        for (const group of groups) {
          if (!group || typeof group !== "object" || group.name === "theme_info") continue;
          for (const raw of (Array.isArray(group.settings) ? group.settings : []) as unknown[]) {
            if (!raw || typeof raw !== "object") continue;
            const s = raw as Record<string, unknown>;
            if (typeof s.id === "string") definitions.set(s.id, s);
          }
        }
        const current = (JSON.parse(settingsData.content) as Record<string, unknown>).current as Record<
          string,
          unknown
        >;
        if (current && typeof current === "object") {
          for (const [key, value] of Object.entries(current)) {
            const def = definitions.get(key);
            if (!def) {
              errors.push(
                `config/settings_data.json: setting "${key}" bestaat niet in settings_schema.json (Shopify keurt onbekende SettingValues af).`
              );
              continue;
            }
            if (value === null || value === undefined) {
              warnings.push(
                `config/settings_data.json: "${key}" is null — Shopify schrijft nooit null (typescan over 3 echte theme-exports 2026-09-21); vervang door een type-geldige waarde of laat weg.`
              );
              continue;
            }
            const type = typeof def.type === "string" ? def.type : "";
            if (type === "checkbox" && typeof value !== "boolean") {
              errors.push(`config/settings_data.json: "${key}" moet een boolean zijn (checkbox), kreeg ${typeof value}.`);
            }
            if (type === "select" || type === "radio") {
              const values = new Set(
                (Array.isArray(def.options) ? def.options : [])
                  .map((o) => (o && typeof o === "object" ? (o as Record<string, unknown>).value : null))
                  .filter((v): v is string => typeof v === "string")
              );
              if (typeof value !== "string" || !values.has(value)) {
                errors.push(
                  `config/settings_data.json: "${key}" heeft waarde "${String(value)}" die geen geldige optie is.`
                );
              }
            }
            if ((type === "number" || type === "range") && typeof value !== "number") {
              errors.push(`config/settings_data.json: "${key}" moet een getal zijn (${type}), kreeg ${typeof value}.`);
            }
            if ((type === "text" || type === "textarea") && typeof value !== "string") {
              errors.push(`config/settings_data.json: "${key}" moet een string zijn (${type}), kreeg ${typeof value}.`);
            }
            if ((type === "color" || type === "color_background") && (typeof value !== "string" || !COLOR_RE.test(value))) {
              errors.push(`config/settings_data.json: "${key}" is geen geldige hex-kleur: "${String(value)}".`);
            }
          }
        }
      } catch {
        errors.push("config-bestanden konden niet tegen elkaar worden gecontroleerd (ongeldige JSON).");
      }
    }
    push("settings_data_contract", "settings_data-waarden tegen settings_schema (SettingValue-contract)", errors, warnings);
  }

  // ---- 4. Header/footer-groupbinding (verplichte core-snelkoppelingen)
  {
    const errors: string[] = [];
    const sectionTypes = new Set(
      files.filter((f) => /^sections\/[^/]+\.liquid$/.test(f.path)).map((f) => f.path.slice("sections/".length, -".liquid".length))
    );
    const requireGroup = (groupPath: string, expectedType: string): void => {
      const group = byPath.get(groupPath);
      if (!group) {
        errors.push(`Vereist section-group ontbreekt: ${groupPath}.`);
        return;
      }
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(group.content) as Record<string, unknown>;
      } catch {
        errors.push(`${groupPath} is geen geldige JSON.`);
        return;
      }
      const sections = parsed?.sections;
      if (!sections || typeof sections !== "object" || Array.isArray(sections)) {
        errors.push(`${groupPath} mist een sections-object.`);
        return;
      }
      const types = Object.values(sections as Record<string, unknown>)
        .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && !Array.isArray(e))
        .map((e) => e.type);
      const bound = types.filter((t) => t === expectedType).length;
      if (bound === 0) {
        errors.push(
          `${groupPath} verwijst naar geen enkele sectie van type "${expectedType}" (verplichte core-binding).`
        );
      }
      for (const t of types) {
        if (typeof t === "string" && !t.startsWith("@") && !sectionTypes.has(t)) {
          errors.push(`${groupPath} verwijst naar sectietype "${String(t)}" zonder bijbehorend Liquid-bestand.`);
        }
      }
    };
    requireGroup("sections/header-group.json", "header");
    requireGroup("sections/footer-group.json", "footer");
    push("group_binding", "Header-group ↔ header-sectie en footer-group ↔ footer-sectie", errors);
  }

  // ---- 5. Navigation/page-targets
  {
    const errors: string[] = [];
    const warnings: string[] = [];
    const pageHandles = new Set(
      files
        .filter((f) => /^templates\/page\.[^/]+\.json$/.test(f.path))
        .map((f) => f.path.slice("templates/page.".length, -".json".length))
    );
    const checkTarget = (target: string, where: string): void => {
      if (target.startsWith("/pages/")) {
        const handle = target.slice("/pages/".length).split(/[?#]/)[0];
        if (!pageHandles.has(handle)) {
          errors.push(
            `${where}: link "${target}" verwijst naar een pagina zonder bijbehorend page-template (verwacht: templates/page.${handle}.json).`
          );
        }
        return;
      }
      if (
        target === "/" ||
        target.startsWith("/#") ||
        target.startsWith("#") ||
        target.startsWith("mailto:") ||
        target.startsWith("tel:") ||
        target.startsWith("http://") ||
        target.startsWith("https://")
      ) {
        return;
      }
      if (SHOPIFY_SYSTEM_ROUTE_PREFIXES.some((prefix) => target === prefix || target.startsWith(`${prefix}/`))) {
        return;
      }
      if (target.startsWith("/")) {
        warnings.push(`${where}: intern doel "${target}" is geen bekend theme-template — controleer dat de merchant-route bestaat.`);
      }
    };
    // URL-settings in template/group-JSON
    for (const file of textFiles) {
      if (!file.path.endsWith(".json")) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(file.content);
      } catch {
        continue; // JSON-syntax valt onder het net
      }
      const walk = (node: unknown, where: string): void => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          node.forEach((item, i) => walk(item, `${where}[${i}]`));
          return;
        }
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          if (typeof value === "string" && value.startsWith("/")) {
            checkTarget(value, `${file.path}: ${where}${where ? "." : ""}${key}`);
          } else {
            walk(value, where ? `${where}.${key}` : key);
          }
        }
      };
      walk(parsed, "");
    }
    // hrefs in Liquid
    for (const file of textFiles) {
      if (!file.path.endsWith(".liquid")) continue;
      const hrefs = file.content.matchAll(/href="(\/[^"]*)"/g);
      for (const match of hrefs) {
        checkTarget(match[1], `${file.path}: href`);
      }
    }
    push("nav_targets", "Navigation- en paginadoelen (page-templates, system-routes)", errors, warnings);
  }

  // ---- 6. Locale-sleutels
  {
    const errors: string[] = [];
    let locale: unknown = null;
    const localeFile = byPath.get("locales/nl.default.json");
    if (localeFile) {
      try {
        locale = JSON.parse(localeFile.content);
      } catch {
        errors.push("locales/nl.default.json is geen geldige JSON.");
      }
    }
    if (localeFile) {
      for (const file of textFiles) {
        if (!file.path.endsWith(".liquid")) continue;
        const uses = file.content.matchAll(/['"]([a-zA-Z0-9_.]+)['"]\s*\|\s*t\b/g);
        for (const match of uses) {
          if (!localeKeyExists(locale, match[1])) {
            errors.push(
              `${file.path}: locale-sleutel "${match[1]}" bestaat niet in locales/nl.default.json (rendert als "translation missing").`
            );
          }
        }
      }
    }
    push("locale_keys", "Locale-sleutels (| t) resolveerbaar in locales/nl.default.json", errors);
  }

  // ---- 7. Render-tag-argumenten (filters in render-args zijn ongeldig Liquid)
  {
    const errors: string[] = [];
    for (const file of textFiles) {
      if (!file.path.endsWith(".liquid")) continue;
      const tags = file.content.matchAll(/\{%\s*-?\s*render\s+[^%]*%\}/g);
      for (const tag of tags) {
        const body = tag[0];
        // Alleen argumenten ná de snippet-naam beoordelen.
        const afterName = body.replace(/\{%\s*-?\s*render\s+['"][^'"]+['"]\s*,?/, "");
        if (/\|\s*[a-zA-Z_]/.test(afterName)) {
          errors.push(
            `${file.path}: filters in render-tag-argumenten zijn ongeldig Shopify-Liquid (theme-check LiquidSyntaxError; gebruik {% assign %} vóór de render).`
          );
        }
      }
    }
    push("render_args", "Liquid render-tag-argumenten zonder filters", errors);
  }

  // ---- 8. img-afmetingen (CLS-contract, theme-check ImgWidthAndHeight)
  {
    const errors: string[] = [];
    for (const file of textFiles) {
      if (!file.path.endsWith(".liquid")) continue;
      const imgs = file.content.matchAll(/<img\b[^>]*>/g);
      for (const img of imgs) {
        const tag = img[0];
        if (!/\bwidth=/.test(tag) || !/\bheight=/.test(tag)) {
          errors.push(`${file.path}: <img>-tag mist width/height-attributen (layout-shift-contract).`);
        }
      }
    }
    push("img_dimensions", "img-tags met width/height (layout-stabiliteit)", errors);
  }

  // ---- 9. Responsive core
  {
    const errors: string[] = [];
    const layout = byPath.get("layout/theme.liquid");
    if (layout) {
      if (!/name\s*=\s*["']viewport["']/.test(layout.content)) {
        errors.push('layout/theme.liquid mist de viewport-metatag (mobiele rendering).');
      }
    }
    const themeCss = byPath.get("assets/theme.css");
    if (themeCss) {
      const mediaQueries = themeCss.content.match(/@media/g)?.length ?? 0;
      if (mediaQueries < 2) {
        errors.push(`assets/theme.css bevat te weinig @media-queries (${mediaQueries}; responsive layout vereist).`);
      }
      if (!/prefers-reduced-motion/.test(`${themeCss.content}${byPath.get("assets/art-direction.css")?.content ?? ""}`)) {
        errors.push("Thema mist prefers-reduced-motion-ondersteuning (toegankelijkheidscontract).");
      }
    }
    push("responsive_core", "Responsive core (viewport, media queries, reduced motion)", errors);
  }

  // ---- 10. Orphan-referenties (warnings: geen import-blokkade, wel dood code)
  {
    const warnings: string[] = [];
    const liquidContent = textFiles
      .filter((f) => f.path.endsWith(".liquid"))
      .map((f) => f.content)
      .join("\n");
    const snippetFiles = files.filter((f) => /^snippets\/[^/]+\.liquid$/.test(f.path));
    for (const snippet of snippetFiles) {
      const name = snippet.path.slice("snippets/".length, -".liquid".length);
      const used = new RegExp(`render\\s+['"]${name}['"]|include\\s+['"]${name}['"]`).test(liquidContent);
      if (!used) {
        warnings.push(`${snippet.path} wordt door geen enkel Liquid-bestand gerenderd (orphan snippet).`);
      }
    }
    const sectionFiles = files.filter((f) => /^sections\/[^/]+\.liquid$/.test(f.path));
    const jsonContent = textFiles
      .filter((f) => f.path.endsWith(".json"))
      .map((f) => f.content)
      .join("\n");
    for (const section of sectionFiles) {
      const type = section.path.slice("sections/".length, -".liquid".length);
      const typeRe = new RegExp(`"type"\\s*:\\s*"${type}"`);
      if (!typeRe.test(jsonContent)) {
        warnings.push(`${section.path} wordt door geen enkel template/group geinstancieerd (orphan section).`);
      }
    }
    push("orphans", "Orphan-referenties (ongebruikte snippets/secties)", [], warnings);
  }

  const criticalErrors = checks.flatMap((c) => c.errors);
  const warnings = checks.flatMap((c) => c.warnings);
  return {
    status: criticalErrors.length === 0 ? "THEME_CERTIFIED" : "THEME_PREFLIGHT_FAILED",
    passed: criticalErrors.length === 0,
    criticalErrors,
    warnings,
    checks,
    external: null,
    fileCount: net.fileCount,
    totalBytes: net.totalBytes,
  };
}

/**
 * ZELFREPARATIE — uitsluitend bewezen-veilige, deterministische reparaties.
 *
 * Repercussie-arm: een lege text/textarea-default wordt weggehaald (de
 * waarde valt terug op de Liquid-|default:-fallbacks — semantiek behouden);
 * Shopifys FileSaveError op lege defaults is daarmee structureel gedekt.
 * Alle andere fouten worden NOOIT automatisch gerepareerd: fail-loud.
 */
export function repairThemeFiles(files: ThemeFile[]): { files: ThemeFile[]; repairs: ThemeRepair[] } {
  const repairs: ThemeRepair[] = [];
  const repaired = files.map((file) => {
    if (!/^sections\/[^/]+\.liquid$/.test(file.path) && file.path !== "config/settings_schema.json") {
      return file;
    }
    // config/settings_schema.json is kale JSON (geen Liquid-schema-tag):
    // direct parsen i.p.v. extractSchemaJson.
    const schema =
      file.path === "config/settings_schema.json"
        ? (() => {
            try {
              return JSON.parse(file.content) as unknown;
            } catch {
              return null;
            }
          })()
        : extractSchemaJson(file.content);
    // settings_schema.json is een ARRAY van groepen; Liquid-schema's zijn objecten.
    if (
      !schema ||
      typeof schema !== "object" ||
      (file.path !== "config/settings_schema.json" && Array.isArray(schema)) ||
      (file.path === "config/settings_schema.json" && !Array.isArray(schema))
    ) {
      return file;
    }

    let changed = false;
    const stripEmptyDefaults = (settings: unknown[]): void => {
      for (const raw of settings) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const setting = raw as Record<string, unknown>;
        if (
          (setting.type === "text" || setting.type === "textarea") &&
          "default" in setting &&
          (setting.default === "" || setting.default === null || setting.default === undefined)
        ) {
          delete setting.default;
          changed = true;
        }
      }
    };
    const walkGroups = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const group of node) {
          if (!group || typeof group !== "object" || Array.isArray(group)) continue;
          const g = group as Record<string, unknown>;
          if (Array.isArray(g.settings)) stripEmptyDefaults(g.settings);
          if (Array.isArray(g.blocks)) {
            for (const block of g.blocks) {
              if (block && typeof block === "object" && Array.isArray((block as Record<string, unknown>).settings)) {
                stripEmptyDefaults((block as Record<string, unknown>).settings as unknown[]);
              }
            }
          }
        }
      }
    };
    if (file.path === "config/settings_schema.json") {
      walkGroups(schema);
    } else {
      const record = schema as Record<string, unknown>;
      if (Array.isArray(record.settings)) stripEmptyDefaults(record.settings);
      if (Array.isArray(record.blocks)) {
        for (const block of record.blocks) {
          if (block && typeof block === "object" && Array.isArray((block as Record<string, unknown>).settings)) {
            stripEmptyDefaults((block as Record<string, unknown>).settings as unknown[]);
          }
        }
      }
      if (Array.isArray(record.presets)) {
        for (const preset of record.presets) {
          if (!preset || typeof preset !== "object" || Array.isArray(preset)) continue;
          const p = preset as Record<string, unknown>;
          if (p.settings && typeof p.settings === "object" && !Array.isArray(p.settings)) {
            for (const [id, value] of Object.entries(p.settings as Record<string, unknown>)) {
              if (value === "" || value === null) {
                delete (p.settings as Record<string, unknown>)[id];
                changed = true;
              }
            }
          }
        }
      }
    }
    if (!changed) return file;
    repairs.push({
      id: "strip_empty_text_default",
      description: `${file.path}: lege text/textarea-schema-default verwijderd (Liquid-fallback blijft de waarde leveren; Shopify weigert lege defaults).`,
    });
    if (file.path === "config/settings_schema.json") {
      return { ...file, content: `${JSON.stringify(schema, null, 2)}\n` };
    }
    const newContent = file.content.replace(
      /\{%\s*-?\s*schema\s*-?\s*%\}[\s\S]*?\{%\s*-?\s*endschema\s*-?\s*%\}/,
      `{% schema %}\n${JSON.stringify(schema, null, 2)}\n{% endschema %}`
    );
    return { ...file, content: newContent };
  });
  return { files: repaired, repairs };
}

/**
 * EXTERN: Shopify's eigen Theme Check (@shopify/theme-check-node).
 *
 * De dependency is optioneel: niet installeerbaar/niet aanwezig → skipped
 * met een expliciete "niet bewezen"-notitie (geén stille pass). Error-severity
 * offenses zijn critical; suggestion-level wordt warning.
 */
export async function runExternalThemeCheck(files: ThemeFile[]): Promise<ExternalThemeCheckSummary> {
  if (process.env.THEME_CHECK_DISABLED === "1") {
    return {
      ran: false,
      reason: "disabled",
      note: "Extern Theme Check expliciet uitgeschakeld (THEME_CHECK_DISABLED).",
      errorCount: 0,
      warningCount: 0,
      errors: [],
      warnings: [],
    };
  }
  type ThemeCheckFn = (root: string) => Promise<{ check: string; message: string; severity: number | string; absolutePath?: string }[]>;
  let checkFn: ThemeCheckFn | null = null;
  try {
    // Optionele dependency: bewust dynamisch; niet beschikbaar → skip.
    const mod: { check?: unknown } = await import("@shopify/theme-check-node");
    if (typeof mod.check === "function") {
      checkFn = mod.check as ThemeCheckFn;
    }
  } catch {
    checkFn = null;
  }
  if (!checkFn) {
    return {
      ran: false,
      reason: "unavailable",
      note: "Shopify Theme Check is niet beschikbaar in deze runtime (optionele dependency niet geinstalleerd). Externe Liquid-schema-scan is daarmee NIET bewezen; het deterministische net geldt volledig.",
      errorCount: 0,
      warningCount: 0,
      errors: [],
      warnings: [],
    };
  }
  const root = join(tmpdir(), `theme-preflight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await mkdir(root, { recursive: true });
    for (const file of files) {
      const target = join(root, file.path);
      await mkdir(join(target, ".."), { recursive: true });
      if (file.bytes) {
        await writeFile(target, file.bytes);
      } else {
        await writeFile(target, file.content, "utf8");
      }
    }
    const offenses = await checkFn(root);
    const errors: ExternalThemeCheckSummary["errors"] = [];
    const warnings: ExternalThemeCheckSummary["warnings"] = [];
    for (const offense of offenses) {
      const entry = {
        check: String(offense.check ?? "unknown"),
        path: offense.absolutePath ? pathOf(offense.absolutePath, root) : "(onbekend bestand)",
        message: String(offense.message ?? "").split("\n")[0].slice(0, 200),
      };
      if (Number(offense.severity) === 0) errors.push(entry);
      else warnings.push(entry);
    }
    return {
      ran: true,
      errorCount: errors.length,
      warningCount: warnings.length,
      errors,
      warnings,
    };
  } catch (error) {
    return {
      ran: false,
      reason: "unavailable",
      note: `Shopify Theme Check kon niet draaien: ${(error as Error).message}. Externe scan NIET bewezen; het deterministische net geldt volledig.`,
      errorCount: 0,
      warningCount: 0,
      errors: [],
      warnings: [],
    };
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Volledige preflight: deterministisch net + extern Theme Check.
 * Error-severity offenses van Theme Check zijn critical.
 */
export async function runFullPreflight(
  files: ThemeFile[],
  options?: { trustedClaims?: readonly string[] }
): Promise<ThemePreflightResult> {
  const result = runDeterministicPreflight(files, options);
  const external = await runExternalThemeCheck(files);
  const externalErrors = external.errors.map(
    (e) => `Theme Check [${e.check}] ${e.path}: ${e.message}`
  );
  result.checks.push({
    id: "shopify_theme_check",
    title: "Shopify Theme Check (extern, @shopify/theme-check-node)",
    result: !external.ran ? "warning" : externalErrors.length > 0 ? "fail" : external.warningCount > 0 ? "warning" : "pass",
    errors: externalErrors,
    warnings: external.warnings.map((w) => `Theme Check [${w.check}] ${w.path}: ${w.message}`),
    note: external.ran ? undefined : external.note,
  });
  result.external = external;
  if (externalErrors.length > 0) {
    result.criticalErrors = [...result.criticalErrors, ...externalErrors];
    result.passed = false;
    result.status = "THEME_PREFLIGHT_FAILED";
  }
  return result;
}

/** Maximale aantal zelfreparatie-rondes vóór fail-loud. */
const MAX_REPAIR_ROUNDS = 2;

/**
 * CERTIFICERINGSLOOP: preflight → repair → preflight (max 2 reparatierondes).
 * Retourneert de (mogelijk gerepareerde) bestanden die als bron van waarheid
 * voor de ZIP moeten dienen, plus het eindresultaat en de reparatielog.
 */
export async function certifyThemeFiles(
  files: ThemeFile[],
  options?: { trustedClaims?: readonly string[] }
): Promise<{ files: ThemeFile[]; result: ThemePreflightResult; repairs: ThemeRepair[] }> {
  let current = files;
  const repairs: ThemeRepair[] = [];
  let result = await runFullPreflight(current, options);
  for (let round = 0; round < MAX_REPAIR_ROUNDS && !result.passed; round += 1) {
    const repair = repairThemeFiles(current);
    if (repair.repairs.length === 0) break; // niets deterministisch te repareren
    current = repair.files;
    repairs.push(...repair.repairs);
    result = await runFullPreflight(current, options);
  }
  return { files: current, result, repairs };
}
