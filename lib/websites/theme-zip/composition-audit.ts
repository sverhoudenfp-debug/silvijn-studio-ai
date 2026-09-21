import type { ThemeFile } from "./theme-structure";
import { getD3Composition } from "../blueprint/composition-registry";
import type { BlueprintSectionType } from "../blueprint/section-registry";

export interface D3CompositionAudit {
  active: boolean;
  errors: string[];
  warnings: string[];
  sectionCount: number;
  variants: string[];
}

const FUNCTIONAL = new Set(["contact", "cta", "newsletter", "booking"]);
const CONTENT_FIELDS = new Set(["body", "text", "title", "description", "quote", "author", "caption", "subheading", "heading", "label", "name", "email", "phone", "address"]);
const SUBSTANCE_FIELDS = new Set(["body", "text", "description", "quote", "caption", "subheading", "email", "phone", "address"]);
const MEDIA_FIELDS = new Set(["image", "portrait", "background_image"]);
function hasText(value: unknown): boolean {
  return typeof value === "string" && value.replace(/<[^>]*>/g, "").trim().length > 0;
}
function hasAny(settings: Record<string, unknown>, fields: Set<string>): boolean {
  return Object.entries(settings).some(([key, value]) => fields.has(key) && hasText(value));
}

/** Evidence from actual ZIP template settings, NOT AI hints or intended content.
 * Empty merchant/customer slots are reported, never filled or silently deleted.
 * These are measurable heuristics, not a visual-design score or pixel proof.
 */
export function auditD3CompositionFiles(files: ThemeFile[]): D3CompositionAudit {
  const result: D3CompositionAudit = { active: false, errors: [], warnings: [], sectionCount: 0, variants: [] };
  const signatures = new Map<string, string[]>();
  const variants = new Set<string>();
  const hasCss = files.some((file) => file.path === "assets/composition.css");
  const layout = files.find((file) => file.path === "layout/theme.liquid");
  for (const file of files) {
    if (!/^templates\/(index|page\.[^/]+)\.json$/.test(file.path)) continue;
    let page: { sections?: Record<string, { type: string; settings?: Record<string, unknown>; blocks?: Record<string, { settings?: Record<string, unknown> }> }>; order?: string[] };
    try { page = JSON.parse(file.content); } catch { continue; } // Existing JSON validation owns this error.
    let previous = "";
    let repeatedRun = 0;
    let cards = 0;
    for (const id of page.order ?? []) {
      const section = page.sections?.[id];
      if (!section) continue;
      const settings = section.settings ?? {};
      const variant = settings.composition;
      if (typeof variant !== "string" || variant === "legacy" || !variant) { previous = ""; repeatedRun = 0; continue; }
      result.active = true;
      result.sectionCount++;
      const type = section.type.replace(/-/g, "_") as BlueprintSectionType;
      const descriptor = getD3Composition(type, variant);
      const ref = `${file.path}/${id}`;
      if (!descriptor) { result.errors.push(`D3_UNKNOWN_COMPOSITION ${ref}: ${type}/${variant}.`); continue; }
      variants.add(`${type}/${variant}`);
      const blocks = Object.values(section.blocks ?? {}).map((block) => block.settings ?? {});
      const meaningfulItems = blocks.filter((block) => hasAny(block, CONTENT_FIELDS) || hasAny(block, MEDIA_FIELDS)).length;
      const substantive = hasAny(settings, SUBSTANCE_FIELDS) || hasAny(settings, MEDIA_FIELDS) || meaningfulItems > 0;
      if (!substantive && !FUNCTIONAL.has(type)) {
        result.warnings.push(`D3_EMPTY_CONTENT_ROLE ${ref}: alleen een kop of lege slots; merchant/customer-content nodig. Geen inhoud gefabriceerd; lege body/blokken worden niet opgerekt.`);
      }
      if (descriptor.minItems > 0 && meaningfulItems < descriptor.minItems) {
        result.warnings.push(`D3_CONTENT_DENSITY ${ref}: ${meaningfulItems} gevulde items voor ${variant} (richtminimum ${descriptor.minItems}); lege slots blijven expliciet invulbaar.`);
      }
      const actualMedia = hasAny(settings, MEDIA_FIELDS) || blocks.some((block) => hasAny(block, MEDIA_FIELDS));
      if (descriptor.requiresMedia && !actualMedia) {
        result.warnings.push(`D3_MEDIA_SLOT_PENDING ${ref}: ${variant} heeft nog geen echte afbeelding; tekstfallback tot de merchant het mediaslot invult.`);
      }
      if (settings.composition_density === "airy" && meaningfulItems < 2 && !hasAny(settings, SUBSTANCE_FIELDS) && !FUNCTIONAL.has(type)) {
        result.warnings.push(`D3_EXCESSIVE_SPACE_RISK ${ref}: airy bij weinig inhoud; compacte dichtheid aanbevolen (geen pixelmeting).`);
      }
      if (FUNCTIONAL.has(type)) { previous = ""; repeatedRun = 0; continue; }
      const signature = `${type}/${variant}`;
      signatures.set(signature, [...(signatures.get(signature) ?? []), ref]);
      const family = descriptor.family;
      if (/card|bento|grid/.test(family)) cards++;
      repeatedRun = previous === family ? repeatedRun + 1 : 1;
      previous = family;
      if (repeatedRun === 3) result.warnings.push(`D3_REPEATED_VISUAL_PATTERN ${ref}: drie opeenvolgende inhoudssecties uit familie ${family}.`);
    }
    if (cards >= 3) result.warnings.push(`D3_TOO_MANY_CARD_COMPOSITIONS ${file.path}: ${cards} grid/card-composities; wissel informatiehiërarchie af.`);
  }
  for (const [signature, refs] of signatures) {
    if (refs.length >= 2) result.warnings.push(`D3_REPEATED_COMPOSITION ${signature}: ${refs.length} instanties (${refs.join(", ")}).`);
  }
  if (result.active && (!hasCss || !layout?.content.includes("'composition.css'"))) {
    result.errors.push("D3_RENDER_CONTRACT: compositie-instanties vereisen assets/composition.css én de stylesheetbinding in theme.liquid.");
  }
  result.variants = [...variants].sort();
  return result;
}
