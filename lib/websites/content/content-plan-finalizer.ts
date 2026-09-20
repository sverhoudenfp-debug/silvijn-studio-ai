import { z } from "zod";
import type { WebsiteBlueprint } from "../blueprint/blueprint";
import type { BlueprintSectionType } from "../blueprint/section-registry";
import { CONTENT_UNIT_KINDS } from "./content-slots";
import { CONTENT_UNIT_STATUSES } from "./content-plan";
import type { ContentUnitKind } from "./content-slots";
import {
  contentSlotsForSection,
  isEvidenceOnlySection,
  type ContentSlotDefinition,
} from "./content-slots";
import type { ContentSourceBundle, ContentSourceItem } from "./content-source";
import { CONTENT_SOURCE_ORIGINS } from "./content-source";
import type { ContentSourceOrigin } from "./content-source";
import { contentPlanSchema, type ContentPlan, type ContentUnit } from "./content-plan";

/**
 * CONTENT PLAN FINALIZER (C3b, 2026-09-20) — de deterministische machine
 * tussen de AI-output en het ContentPlan-contract (C3a).
 *
 * De AI levert raw units; deze finalizer dwingt AF (geen enkele AI-vrijheid
 * overleeft dit ongecontroleerd):
 *
 * 1. ARCHITECTUUR VAST: units bestaan alleen op bestaande sectie-paden met
 *    slot-kinds uit de CONTENT_SLOT_REGISTRY — hallucinated secties failen
 *    het plan (fail-loud, geen stille drop).
 * 2. FACT-LOCKED = VERBATIM UIT EEN BRON. Elke fact-locked unit moet gronden:
 *    - evidence byte-gelijk aan een bundeltekst, of
 *    - de tekst is een byte-exact deel (substring) van een bundel-/trusted-
 *      tekst.
 *    Byte-gelijk → status "fixed" (deterministisch); verbatim deel →
 *    "generated" met de brontekst als evidence. Ongegrond = FABRICATIE →
 *    het plan faalt met een expliciete reden (geen downgrades: verzinnen
 *    van reviews/prijzen/resultaten/cijfers is nooit "honest gokwerk").
 * 3. EVIDENCE VERPLICHT voor commerciële generated units: zonder evidence
 *    wordt de unit customer_slot met een concrete instructie (eerlijk).
 * 4. COPYWRITING=FALSE: commerciële copy wordt customer_slot met
 *    instructie; fact-locked feiten (fixed/verbatim), microcopy en
 *    structurele CTA-labels blijven functioneel.
 * 5. COVERAGE: elk verplicht slot is gedekt — fact-locked evidence_only-
 *    slots worden deterministisch uit de geregistreerde echte trust-data
 *    gevuld (usp_band/stats); cta_label valt terug op het echte
 *    conversiedoel; de rest wordt customer_slot + missingInformation.
 * 6. Het resultaat doorloopt daarna het C3a-schema + de C3a-consistency
 *    (de service roept die afzonderlijk aan) — dubbele afdwang.
 */

export class ContentPlanFinalizeError extends Error {
  constructor(public readonly errors: string[]) {
    super(`ContentPlan-finalizer verwierp de AI-output: ${errors.join(" ")}`);
    this.name = "ContentPlanFinalizeError";
  }
}

// ---------------------------------------------------------------------------
// Raw AI-output (vóór normalisatie; de finalizer is de strenge poort)
// ---------------------------------------------------------------------------

const rawUnitSchema = z.object({
  path: z.string().min(1).max(120),
  kind: z.enum(CONTENT_UNIT_KINDS),
  status: z.enum(CONTENT_UNIT_STATUSES),
  text: z.string().nullable().default(null),
  // LIVE-LES 2026-09-20 (fixture E2E, STAP-2-run): de AI zendt soms
  // evidence: null i.p.v. [] (semantisch identiek, maar het raw-schema
  // verwierp het plan hard). Nullish -> [] is een veilige normalisatie:
  // de finalizer dwingt de echte evidence-regels daarna alsnog af.
  evidence: z.array(z.string()).nullish().transform((v) => v ?? []),
  sourceOrigin: z.enum(CONTENT_SOURCE_ORIGINS).nullable().default(null),
  instruction: z.string().nullable().default(null),
});

export const rawContentPlanOutputSchema = z.object({
  pages: z
    .array(
      z.object({
        key: z.string().min(1).max(60),
        seo: z
          .object({
            title: z.string().nullable(),
            metaDescription: z.string().nullable(),
          })
          .nullable()
          .default(null),
        units: z.array(rawUnitSchema).default([]),
      })
    )
    .min(1)
    .max(10),
  missingInformation: z.array(z.string()).default([]),
});

export type RawContentPlanOutput = z.infer<typeof rawContentPlanOutputSchema>;

// ---------------------------------------------------------------------------
// Kind-classificatie (deterministisch)
// ---------------------------------------------------------------------------

/** UI/structureel: blijft functioneel, ook bij copywriting=false. */
const UI_KINDS: ReadonlySet<ContentUnitKind> = new Set(["microcopy", "cta_label", "cta_secondary_label"]);
/** Beeldslots: merchant-editable, bewust leeg. */
const MEDIA_KINDS: ReadonlySet<ContentUnitKind> = new Set(["alt_text", "caption"]);

const PER_KIND_INSTRUCTION: Partial<Record<ContentUnitKind, string>> = {
  headline: "Lever een korte, krachtige kop (max. 80 tekens) die de kern van het bedrijf raakt.",
  subheadline: "Lever een ondersteunende zin (max. 140 tekens) onder de kop.",
  heading: "Lever de sectiekop (max. 80 tekens).",
  subheading: "Lever de subkop (max. 120 tekens).",
  body: "Lever de volledige tekst voor deze sectie (2-5 zinnen), in de tone of voice van het bedrijf.",
  item_title: "Lever de exacte naam/feitelijke titel van dit item — zoals klanten die kennen.",
  item_body: "Lever een korte omschrijving (2-3 zinnen) van dit item.",
  item_label: "Lever het korte label (max. 40 tekens).",
  item_hint: "Lever een korte toelichting (max. 100 tekens).",
  item_text: "Lever de tekst van dit item (1-2 zinnen).",
  step_title: "Lever de titel van deze stap (max. 60 tekens).",
  step_body: "Lever de toelichting op deze stap (1-2 zinnen).",
  faq_question: "Lever de echte, terugkerende klantvraag.",
  faq_answer: "Lever het antwoord op de vraag (1-3 zinnen) — alleen feiten.",
  quote: "Lever de exacte klantuitspraak (verbatim) + wie het zei.",
  quote_author: "Lever de naam/functie van de auteur van de uitspraak.",
  member_name: "Lever de echte naam van dit teamlid.",
  member_role: "Lever de echte functie/rol van dit teamlid.",
  stat_label: "Lever wat het cijfer beschrijft (bijv. 'jaar ervaring').",
  stat_value: "Lever het exacte cijfer.",
  rate_value: "Lever het exacte tarief (en eenheid).",
  cta_label: "Lever het knoplabel (max. 30 tekens), bijv. 'Neem contact op'.",
  cta_secondary_label: "Lever het label van de tweede knop (max. 30 tekens).",
  alt_text: "Lever een passende afbeelding voor dit beeldvlak; de alt-tekst vult de merchant later in Shopify in.",
  caption: "Lever een beeld + korte bijschrift voor dit beeldvlak.",
  microcopy: "Lever de gewenste formulier/UI-teksten (labels, knoppen, hulpteksten).",
  seo_title: "Lever de gewenste SEO-paginatitel (max. 60 tekens).",
  seo_description: "Lever de gewenste meta-description (max. 155 tekens).",
};

export function buildSlotInstruction(slot: ContentSlotDefinition): string {
  const perKind = PER_KIND_INSTRUCTION[slot.kind] ?? "Lever de exacte inhoud voor dit veld.";
  return `${perKind} (${slot.description})`;
}

// ---------------------------------------------------------------------------
// Finalisatie
// ---------------------------------------------------------------------------

export interface FinalizeResult {
  plan: ContentPlan;
  /** Deterministische correcties (auditbaar in generationNotes). */
  corrections: string[];
  /** Door de finalizer toegevoegde ontbrekende informatie. */
  addedMissing: string[];
}

interface GroundIndex {
  byText: Map<string, ContentSourceItem>;
  allTexts: string[];
}

function buildGroundIndex(bundle: ContentSourceBundle): GroundIndex {
  const byText = new Map<string, ContentSourceItem>();
  for (const item of bundle.items) byText.set(item.text, item);
  return { byText, allTexts: [...byText.keys(), ...bundle.trustedClaims] };
}

interface GroundMatch {
  item: ContentSourceItem | null;
  text: string;
  exact: boolean;
}

/**
 * Grondt een feit: byte-gelijk aan een bundeltekst (exact) of byte-exact
 * deel van een bundel-/trustedtekst (substring). null = ongegrond.
 */
function groundFact(
  text: string,
  candidates: readonly string[],
  index: GroundIndex
): GroundMatch | null {
  const exact = index.byText.get(text);
  if (exact) return { item: exact, text, exact: true };
  for (const candidate of candidates) {
    if (candidate.length > 0 && text.length > 0 && candidate.includes(text)) {
      return { item: index.byText.get(candidate) ?? null, text: candidate, exact: false };
    }
  }
  return null;
}

export function finalizeRawContentPlan(input: {
  raw: RawContentPlanOutput;
  blueprint: WebsiteBlueprint;
  bundle: ContentSourceBundle;
  copywriting: boolean;
  designPlanId: string;
}): FinalizeResult {
  const { raw, blueprint, bundle, copywriting } = input;
  const errors: string[] = [];
  const corrections: string[] = [];
  const addedMissing: string[] = [];
  const ground = buildGroundIndex(bundle);

  const blueprintPageByKey = new Map(blueprint.pages.map((p) => [p.key, p]));

  function sectionTypeAt(pageKey: string, sectionIndex: number): BlueprintSectionType | null {
    const page = blueprintPageByKey.get(pageKey);
    if (!page || sectionIndex < 0 || sectionIndex >= page.sectionInstances.length) return null;
    return page.sectionInstances[sectionIndex].type as BlueprintSectionType;
  }

  const finalizedPages: { key: string; seo: { title: string | null; metaDescription: string | null } | null; units: ContentUnit[] }[] = [];

  for (const rawPage of raw.pages) {
    const blueprintPage = blueprintPageByKey.get(rawPage.key);
    if (!blueprintPage) {
      errors.push(`AI voegde onbekende pagina "${rawPage.key}" toe — de architectuur staat vast.`);
      continue;
    }

    const units: ContentUnit[] = [];
    const seenPathKind = new Set<string>();

    for (const rawUnit of rawPage.units) {
      const sep = rawUnit.path.lastIndexOf("/");
      const pageKey = sep > 0 ? rawUnit.path.slice(0, sep) : "";
      const sectionIndex = sep > 0 ? Number(rawUnit.path.slice(sep + 1)) : -1;
      const type = sectionTypeAt(pageKey, sectionIndex);
      if (type == null) {
        errors.push(
          `AI verwees naar onbestaand sectiepad "${rawUnit.path}" — secties mogen niet toegevoegd of verplaatst worden.`
        );
        continue;
      }
      const slots = contentSlotsForSection(type);
      const slot = slots.find((s) => s.kind === rawUnit.kind);
      if (!slot) {
        // LIVE-LES 2026-09-20 (fixture E2E, STAP-2-run): de AI hallucineerde
        // soms een slot-kind buiten het gesloten registry (bijv. cta_label op
        // services). Eerlijke reparatie: unit verwijderen met correctielog —
        // de coverage-check dwingt verplichte kinds alsnog af, dus hierdoor
        // ontstaat nooit een ongevuld verplicht slot.
        corrections.push(
          `AI gebruikte slot-kind "${rawUnit.kind}" bij sectietype "${type}" (pad "${rawUnit.path}") — dit slot bestaat daar niet; unit verwijderd.`
        );
        continue;
      }

      const dedupeKey = `${rawUnit.path}\u0000${rawUnit.kind}`;
      if (seenPathKind.has(dedupeKey)) {
        corrections.push(`Dubbele unit (pad "${rawUnit.path}", kind "${rawUnit.kind}") verwijderd — de eerste telt.`);
        continue;
      }
      seenPathKind.add(dedupeKey);

      const factLocked = slot.factLocked;
      const evidenceOnly = isEvidenceOnlySection(type);
      const unit = finalizeUnit(
        { rawUnit, slot, factLocked, evidenceOnly, path: rawUnit.path },
        { ground, errors, corrections, addedMissing, copywriting }
      );
      if (unit) units.push(unit);
    }

    finalizedPages.push({ key: rawPage.key, seo: rawPage.seo, units });
  }

  // ---- Coverage: elk verplicht slot gedekt, per sectie-instantie.
  const pageUnitsByKey = new Map(finalizedPages.map((p) => [p.key, p.units]));
  let uspBandIndex = 0;
  let statsIndex = 0;

  for (const blueprintPage of blueprint.pages) {
    for (let i = 0; i < blueprintPage.sectionInstances.length; i++) {
      const instance = blueprintPage.sectionInstances[i];
      const type = instance.type as BlueprintSectionType;
      const path = `${blueprintPage.key}/${i}`;
      const slots = contentSlotsForSection(type);
      const existing = pageUnitsByKey.get(blueprintPage.key) ?? [];
      const presentKinds = new Set(existing.filter((u) => u.path === path).map((u) => u.kind));

      for (const slot of slots) {
        if (!slot.required || presentKinds.has(slot.kind)) continue;

        // Deterministische trust-fill voor evidence_only bands/cijfers.
        if (type === "usp_band" && slot.kind === "item_label" && blueprint.trustElements.usps.length > 0) {
          for (const usp of blueprint.trustElements.usps) {
            const source = ground.allTexts.find((t) => t.includes(usp.label));
            if (!source) continue;
            existing.push({
              path,
              kind: slot.kind,
              status: "generated",
              text: usp.label,
              evidence: [source],
              sourceOrigin: "blueprint",
              instruction: null,
            });
            presentKinds.add(slot.kind);
          }
          addedMissing.push(`USP-band (pad ${path}): AI dekte de verplichte labels niet — deterministisch gevuld uit de geregistreerde echte trust-data.`);
          uspBandIndex++;
          continue;
        }
        if (type === "stats" && blueprint.trustElements.stats.length > 0 && (slot.kind === "stat_label" || slot.kind === "stat_value")) {
          for (const stat of blueprint.trustElements.stats) {
            const value = slot.kind === "stat_value" ? stat.value : stat.label;
            const source = ground.allTexts.find((t) => t.includes(value));
            if (!source) continue;
            existing.push({
              path,
              kind: slot.kind,
              status: "generated",
              text: value,
              evidence: [source],
              sourceOrigin: "blueprint",
              instruction: null,
            });
            presentKinds.add(slot.kind);
          }
          if (presentKinds.has(slot.kind)) {
            addedMissing.push(`Stats-sectie (pad ${path}): AI dekte "${slot.kind}" niet — deterministisch gevuld uit de geregistreerde echte trust-data.`);
          }
          statsIndex++;
          continue;
        }

        // Structurele CTA-labels: vast uit het echte conversiedoel.
        if (slot.kind === "cta_label") {
          const goalItem = bundle.items.find((item) => item.origin === "blueprint" && item.key === "conversion:primaryGoal");
          if (goalItem) {
            existing.push({
              path,
              kind: slot.kind,
              status: "fixed",
              text: goalItem.text,
              evidence: [],
              sourceOrigin: "blueprint",
              instruction: null,
            });
            presentKinds.add(slot.kind);
            addedMissing.push(`CTA-label (pad ${path}): AI dekte het verplichte label niet — vastgesteld op het echte conversiedoel.`);
            continue;
          }
        }

        // Eerlijke klantinvoer voor de rest.
        existing.push({
          path,
          kind: slot.kind,
          status: "customer_slot",
          text: null,
          evidence: [],
          sourceOrigin: null,
          instruction: buildSlotInstruction(slot),
        });
        presentKinds.add(slot.kind);
        addedMissing.push(`Verplicht slot "${slot.kind}" (pad ${path}) had geen AI-waarde — wordt door de klant aangeleverd.`);
      }
    }
  }

  void uspBandIndex;
  void statsIndex;

  if (errors.length > 0) throw new ContentPlanFinalizeError(errors);

  const missingInformation = [...raw.missingInformation, ...addedMissing]
    .filter((text, i, arr) => arr.indexOf(text) === i)
    .slice(0, 20);

  const plan = contentPlanSchema.parse({
    version: 1,
    designPlanId: input.designPlanId,
    sourceFingerprint: bundle.fingerprint,
    pages: finalizedPages,
    missingInformation,
  });

  return { plan, corrections, addedMissing };
}

// ---------------------------------------------------------------------------
// Per-unit finalisatie
// ---------------------------------------------------------------------------

interface UnitContext {
  ground: GroundIndex;
  errors: string[];
  corrections: string[];
  addedMissing: string[];
  copywriting: boolean;
}

function finalizeUnit(
  input: {
    rawUnit: { text: string | null; evidence: string[]; sourceOrigin: ContentSourceOrigin | null; instruction: string | null; status: string; kind: ContentUnitKind };
    slot: ContentSlotDefinition;
    factLocked: boolean;
    evidenceOnly: boolean;
    path: string;
  },
  ctx: UnitContext
): ContentUnit | null {
  const { rawUnit, slot, factLocked, evidenceOnly, path } = input;
  const text = rawUnit.text?.trim() ? rawUnit.text.trim() : null;
  const where = `(pad "${path}", kind "${slot.kind}")`;

  const pushCustomerSlot = (reason: string): ContentUnit => {
    if (reason) ctx.corrections.push(`${reason} ${where} → klantinvoer met instructie.`);
    return {
      path,
      kind: slot.kind,
      status: "customer_slot",
      text: null,
      evidence: [],
      sourceOrigin: null,
      instruction: buildSlotInstruction(slot),
    };
  };

  // --- status: merchant_slot (beeldslots; bewust leeg) ---
  if (rawUnit.status === "merchant_slot") {
    if (!MEDIA_KINDS.has(slot.kind)) {
      ctx.corrections.push(`merchant_slot op niet-beeldslot ${where} verwijderd — alleen beeldslots zijn merchant-editable.`);
      return null;
    }
    if (evidenceOnly) {
      // LIVE-LES 2026-09-20 (fixture E2E, content_plans v4): de AI volgde de
      // "geen bron -> customer_slot"-regel ook op evidence_only-secties.
      // Eerlijke reparatie: unit weg (de instantie bestaat alleen met echte
      // data), correctie gelogd; verplichte kinds vult de trust-fill of de
      // coverage-check eerlijk aan.
      ctx.corrections.push(`merchant_slot op evidence_only-sectie ${where} verwijderd — deze instantie bestaat alleen met echte data.`);
      return null;
    }
    return { path, kind: slot.kind, status: "merchant_slot", text: null, evidence: [], sourceOrigin: null, instruction: null };
  }

  // --- status: customer_slot ---
  if (rawUnit.status === "customer_slot") {
    if (evidenceOnly) {
      // Zie merchant_slot hierboven: eerlijke drop i.p.v. hard faal — de AI
      // volgde de algemene geen-bron-regel; verplichte echte data vult de
      // deterministische trust-fill aan of de coverage-check faalt eerlijk.
      ctx.corrections.push(`customer_slot op evidence_only-sectie ${where} verwijderd — deze instantie bestaat alleen met echte data.`);
      return null;
    }
    return {
      path,
      kind: slot.kind,
      status: "customer_slot",
      text: null,
      evidence: [],
      sourceOrigin: null,
      instruction: rawUnit.instruction && rawUnit.instruction.trim().length >= 10 ? rawUnit.instruction.trim().slice(0, 400) : buildSlotInstruction(slot),
    };
  }

  // --- status: fixed (deterministisch overgenomen) ---
  if (rawUnit.status === "fixed") {
    if (text == null) {
      if (factLocked) {
        ctx.errors.push(`fact-locked fixed-unit zonder tekst ${where}.`);
        return null;
      }
      return pushCustomerSlot(`fixed-unit zonder tekst ${where}`);
    }
    const exact = ctx.ground.byText.get(text);
    if (exact) {
      if (rawUnit.sourceOrigin && rawUnit.sourceOrigin !== exact.origin) {
        ctx.corrections.push(`fixed-unit ${where}: sourceOrigin gecorrigeerd ${rawUnit.sourceOrigin} → ${exact.origin}.`);
      }
      return { path, kind: slot.kind, status: "fixed", text: exact.text, evidence: [], sourceOrigin: exact.origin, instruction: null };
    }
    // Verbatim deel van een bron: geen fixed maar generated mét de brontekst
    // als evidence (C3a-consistency eist byte-gelijkheid bij fixed).
    const grounded = groundFact(text, ctx.ground.allTexts, ctx.ground);
    if (grounded && (grounded.item || grounded.text !== text)) {
      const origin = grounded.item?.origin ?? "design_plan";
      ctx.corrections.push(`fact-locked fixed-unit ${where}: byte-gelijk aan bron, maar verbatim deel — omgezet naar generated met de brontekst als evidence.`);
      return {
        path,
        kind: slot.kind,
        status: "generated",
        text,
        evidence: [grounded.text],
        sourceOrigin: origin,
        instruction: null,
      };
    }
    if (factLocked) {
      ctx.errors.push(`fact-locked claim zonder geldige bron ${where}: "${text.slice(0, 60)}" — fabricatie is verboden.`);
      return null;
    }
    return pushCustomerSlot(`fixed-unit zonder byte-gelijke brontekst ${where}`);
  }

  // --- status: generated ---
  const evidence = rawUnit.evidence.map((fragment) => fragment.trim()).filter((fragment) => fragment.length > 0);

  if (factLocked) {
    // Byte-exacte evidence-grondslag verplicht; anders verbatim-substring.
    for (const fragment of evidence) {
      const exact = ctx.ground.byText.get(fragment);
      if (exact) {
        if (text && text === exact.text) {
          return { path, kind: slot.kind, status: "fixed", text: exact.text, evidence: [], sourceOrigin: exact.origin, instruction: null };
        }
        // AI-tekst is verbatim deel van de exacte bron: behoud de AI-tekst.
        if (text && exact.text.includes(text)) {
          if (text !== exact.text) {
            ctx.corrections.push(`fact-locked unit ${where}: verbatim deel van de bron behouden (geen reformulering).`);
          }
          return { path, kind: slot.kind, status: "generated", text, evidence: [exact.text], sourceOrigin: exact.origin, instruction: null };
        }
        // AI reformuleerde het feit: herstel naar de exacte brontekst.
        ctx.corrections.push(`fact-locked unit ${where}: AI reformuleerde het feit — hersteld naar de exacte brontekst.`);
        return { path, kind: slot.kind, status: "generated", text: exact.text, evidence: [exact.text], sourceOrigin: exact.origin, instruction: null };
      }
    }
    // Geen byte-exacte evidence: verbatim-substring van een bron?
    if (text) {
      const grounded = groundFact(text, ctx.ground.allTexts, ctx.ground);
      if (grounded && grounded.text.includes(text) && grounded.text !== text) {
        ctx.corrections.push(`fact-locked unit ${where}: evidence ontbrak, maar de tekst is een verbatim deel van een bron — evidence aangevuld.`);
        return {
          path,
          kind: slot.kind,
          status: "generated",
          text,
          evidence: [grounded.text],
          sourceOrigin: grounded.item?.origin ?? "design_plan",
          instruction: null,
        };
      }
      if (grounded && grounded.text === text) {
        return {
          path,
          kind: slot.kind,
          status: "generated",
          text,
          evidence: [grounded.text],
          sourceOrigin: grounded.item?.origin ?? "design_plan",
          instruction: null,
        };
      }
    }
    ctx.errors.push(
      `fact-locked claim zonder geldige bron ${where}: "${(text ?? evidence[0] ?? "").slice(0, 60)}" — verzinnen van bedrijfsfeiten is verboden.`
    );
    return null;
  }

  // Commerciële/UI-copy (niet fact-locked).
  if (!ctx.copywriting && !UI_KINDS.has(slot.kind) && !MEDIA_KINDS.has(slot.kind)) {
    return pushCustomerSlot(`copywriting=false: commerciële copy ${where}`);
  }
  if (evidence.length === 0) {
    ctx.addedMissing.push(`Generated unit ${where} had geen evidence — wordt door de klant aangeleverd.`);
    return pushCustomerSlot(`generated unit zonder evidence ${where}`);
  }
  return {
    path,
    kind: slot.kind,
    status: "generated",
    text,
    evidence: evidence.slice(0, 6),
    sourceOrigin: null,
    instruction: null,
  };
}
