import { z } from "zod";
import type { WebsiteBlueprint } from "../blueprint/blueprint";
import { BLUEPRINT_SECTION_TYPES, type BlueprintSectionType } from "../blueprint/section-registry";
import { CONTENT_SOURCE_ORIGINS } from "./content-source";
import type { ContentSourceBundle } from "./content-source";
import {
  CONTENT_UNIT_KINDS,
  contentSlotsForSection,
  isEvidenceOnlySection,
  validateContentSlotRegistryConformance,
  type ContentUnitKind,
} from "./content-slots";

/**
 * CONTENT PLAN (C3a, 2026-09-20) — het interne, per blueprint-sectie
 * gestructureerde content-artefact van de ContentPass (C3: Content
 * Intelligence).
 *
 * ARCHITECTUUR: het ContentPlan is een APART artefact, gekoppeld aan één
 * specifieke Design Plan-versie (record: content_plans.design_plan_id met
 * eigen versienummering per design plan — zie migratie 0023). Zo kan content
 * her-genereren (revisierondes) zonder herplanning van de architectuur, en
 * maakt de source-fingerprint zichtbaar of de bronnen zijn gewijzigd sinds
 * de laatste pass.
 *
 * Statussemantiek per unit (C3-ontwerp §5.2):
 * - generated     — AI-copy gedragen door evidence (C3b); commerciële feiten
 *                   daarin zijn factLocked en verbatim (C3c dwingt af)
 * - customer_slot — de klant levert dit aan; instruction zegt precies wat
 * - merchant_slot — bewust leeg, merchant-editable in Shopify (beeldslots)
 * - fixed         — deterministisch overgenomen waarde (geen AI)
 *
 * HARD REGELS:
 * - GESLOTEN kinds/statussen: alles buiten de enums faalt de Zod-validatie.
 * - Het plan leeft uitsluitend binnen de blueprint-architectuur: elk unit-
 *   path verwijst naar een bestaande pagina + sectie-instantie; slotkinds
 *   moeten in CONTENT_SLOT_REGISTRY bij dat sectietype bestaan; verplichte
 *   slots zijn gedekt (consistency-functie hieronder).
 * - evidence_only-sectie-instanties kennen géén customer/merchant slots:
 *   zij bestaan alleen met echte data (blueprint-consistency), dus hun
 *   content is óók uitsluitend bron-gebonden.
 * - Nog NIET in C3a: AI-contentgeneratie, policy-pass, Shopify-integratie.
 */

// ---------------------------------------------------------------------------
// Content-units
// ---------------------------------------------------------------------------

export const CONTENT_UNIT_STATUSES = ["generated", "customer_slot", "merchant_slot", "fixed"] as const;
export type ContentUnitStatus = (typeof CONTENT_UNIT_STATUSES)[number];

export const contentUnitSchema = z
  .object({
    /**
     * Pad naar de sectie-instantie: "<pageKey>/<sectionIndex>" — exact de
     * plek in het blueprint (index binnen pages[].sectionInstances).
     */
    path: z.string().min(1).max(120),
    kind: z.enum(CONTENT_UNIT_KINDS),
    status: z.enum(CONTENT_UNIT_STATUSES),
    text: z.string().nullable(),
    /** Alleen relevant bij status=generated: verbatim bewijsfragmenten. */
    evidence: z.array(z.string().min(2).max(300)).max(6),
    sourceOrigin: z.enum(CONTENT_SOURCE_ORIGINS).nullable(),
    /** Alleen bij customer_slot: wat de klant moet aanleveren en waar het komt. */
    instruction: z.string().min(10).max(400).nullable(),
  })
  .superRefine((unit, ctx) => {
    if (unit.status === "generated" && unit.evidence.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Een generated unit vereist minimaal één evidence-fragment." });
    }
    if (unit.status === "customer_slot" && unit.instruction == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Een customer_slot vereist een instructie voor de klant." });
    }
    if (unit.status === "merchant_slot" && unit.text != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Een merchant_slot heeft geen AI-tekst (bewust leeggelaten)." });
    }
    if (unit.status === "fixed" && (unit.text == null || unit.sourceOrigin == null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Een fixed unit vereist text én sourceOrigin (deterministisch overgenomen)." });
    }
    if (unit.status !== "generated" && unit.evidence.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Alleen generated units dragen evidence." });
    }
  });

export type ContentUnit = z.infer<typeof contentUnitSchema>;

// ---------------------------------------------------------------------------
// Pagina's en het volledige plan
// ---------------------------------------------------------------------------

export const contentPlanPageSchema = z.object({
  /** Moet exact overeenkomen met blueprint.pages[].key (consistency-check). */
  key: z.string().min(1).max(60),
  seo: z
    .object({
      title: z.string().min(3).max(120).nullable(),
      metaDescription: z.string().min(10).max(300).nullable(),
    })
    .nullable(),
  units: z.array(contentUnitSchema).max(120),
});

export const contentPlanSchema = z.object({
  version: z.literal(1),
  /** Design Plan-versie (record-id) waar dit ContentPlan bij hoort. */
  designPlanId: z.string().min(1),
  /** Fingerprint van de SourceBundle waaruit dit plan is ontstaan. */
  sourceFingerprint: z.string().min(1),
  pages: z.array(contentPlanPageSchema).min(1).max(10),
  missingInformation: z.array(z.string().min(3).max(200)).max(20),
});

export type ContentPlanPage = z.infer<typeof contentPlanPageSchema>;
export type ContentPlan = z.infer<typeof contentPlanSchema>;

export const CONTENT_PLAN_STATUS = ["draft", "completed", "failed"] as const;
export type ContentPlanStatus = (typeof CONTENT_PLAN_STATUS)[number];

// ---------------------------------------------------------------------------
// Deterministische consistency (puur; de AI-producent volgt in C3b)
// ---------------------------------------------------------------------------

export interface ContentPlanConsistencyResult {
  passed: boolean;
  errors: string[];
}

function sectionTypeAt(blueprint: WebsiteBlueprint, path: string): BlueprintSectionType | null {
  const sep = path.lastIndexOf("/");
  if (sep <= 0) return null;
  const pageKey = path.slice(0, sep);
  const index = Number(path.slice(sep + 1));
  if (!Number.isInteger(index) || index < 0) return null;
  const page = blueprint.pages.find((p) => p.key === pageKey);
  if (!page || index >= page.sectionInstances.length) return null;
  return page.sectionInstances[index].type as BlueprintSectionType;
}

/**
 * Valideert het ContentPlan tegen het blueprint en de SourceBundle:
 * 1. slot-registry-conformance van de catalogus zelf;
 * 2. elk unit-path resolveert naar een bestaande sectie-instantie;
 * 3. slotkinds horen bij het sectietype van hun instantie;
 * 4. verplichte slotkinds zijn gedekt per instantie (coverage);
 * 5. fixed units zijn byte-gelijk aan een brontekst (deterministische
 *    herkomst, géén AI-vrijheid);
 * 6. evidence_only-instanties kennen alleen bron-gebonden units
 *    (geen customer/merchant slots, sourceOrigin verplicht).
 */
export function validateContentPlanConsistency(
  plan: ContentPlan,
  blueprint: WebsiteBlueprint,
  bundle: ContentSourceBundle
): ContentPlanConsistencyResult {
  const errors: string[] = [];

  // 1. De slot-catalogus zelf moet conforme zijn (fail-loud bij divergentie).
  const registryConformance = validateContentSlotRegistryConformance();
  if (!registryConformance.passed) {
    errors.push(...registryConformance.errors);
  }

  const bundleTexts = new Set(bundle.items.map((item) => item.text));
  const blueprintPageKeys = new Set(blueprint.pages.map((p) => p.key));

  // Pagina's van het plan moeten exact de blueprint-pagina's dekken.
  for (const page of plan.pages) {
    if (!blueprintPageKeys.has(page.key)) {
      errors.push(`Pagina "${page.key}" bestaat niet in het blueprint.`);
    }
  }
  for (const blueprintPage of blueprint.pages) {
    if (!plan.pages.some((p) => p.key === blueprintPage.key)) {
      errors.push(`Blueprint-pagina "${blueprintPage.key}" mist in het ContentPlan.`);
    }
  }

  for (const page of plan.pages) {
    for (const unit of page.units) {
      // 2. Het pad moet naar een echte sectie-instantie wijzen.
      const type = sectionTypeAt(blueprint, unit.path);
      if (type == null) {
        errors.push(`Unit-pad "${unit.path}" verwijst niet naar een bestaande sectie-instantie.`);
        continue;
      }
      // 3. Het slot-kind moet bij het sectietype horen.
      const allowedKinds = new Set(contentSlotsForSection(type).map((s) => s.kind));
      if (!allowedKinds.has(unit.kind)) {
        errors.push(`Slot-kind "${unit.kind}" is niet toegestaan bij sectietype "${type}" (pad "${unit.path}").`);
        continue;
      }
      // 5. fixed units: byte-gelijk aan een brontekst.
      if (unit.status === "fixed" && unit.text != null && !bundleTexts.has(unit.text)) {
        errors.push(`fixed unit (pad "${unit.path}") is niet byte-gelijk aan een brontekst: "${unit.text.slice(0, 60)}..."`);
      }
      // 6. evidence_only-instanties: alleen bron-gebonden units.
      if (isEvidenceOnlySection(type)) {
        if (unit.status === "customer_slot" || unit.status === "merchant_slot") {
          errors.push(
            `Evidence_only-sectie "${type}" (pad "${unit.path}") kent geen ${unit.status}-units — deze instantie bestaat alleen met echte data.`
          );
        } else if (unit.sourceOrigin == null) {
          errors.push(`Unit op evidence_only-sectie (pad "${unit.path}") vereist een sourceOrigin.`);
        }
      }
    }
  }

  // 4. Coverage: elke sectie-instantie dekt al zijn verplichte slotkinds.
  for (const blueprintPage of blueprint.pages) {
    for (let i = 0; i < blueprintPage.sectionInstances.length; i++) {
      const instance = blueprintPage.sectionInstances[i];
      const path = `${blueprintPage.key}/${i}`;
      const pageUnits = plan.pages.find((p) => p.key === blueprintPage.key)?.units ?? [];
      const presentKinds = new Set<ContentUnitKind>(
        pageUnits.filter((u) => u.path === path).map((u) => u.kind as ContentUnitKind)
      );
      for (const requiredKind of contentSlotsForSection(instance.type as BlueprintSectionType)
        .filter((s) => s.required)
        .map((s) => s.kind)) {
        if (!presentKinds.has(requiredKind)) {
          errors.push(`Sectie-instantie "${path}" mist verplicht content-slot "${requiredKind}".`);
        }
      }
    }
  }

  return { passed: errors.length === 0, errors };
}

/** Her-export voor gemakkelijke import vanuit de C3b-service. */
export { BLUEPRINT_SECTION_TYPES };
