import type { ContentPlan, ContentUnit } from "./content-plan";
import type { ContentUnitKind } from "./content-slots";

/**
 * CONTENTPLAN-CONSUMPTIE (C3d, 2026-09-20) — de zuivere index tussen een
 * completed ContentPlan en de Shopify theme-compositie.
 *
 * CONTRACT:
 * - Een unit hoort bij exact één plek: "<pageKey>/<sectionIndex>" binnen het
 *   blueprint. Meerdere instanties van hetzelfde sectietype hebben daarom
 *   per definitie verschillende content (pad is de sleutel).
 * - De compositie (blueprint-composition.ts) beslist WAAR een unit landt;
 *   deze module levert alléén de deterministische opzoeking. Er wordt hier
 *   niets verzonden, geschreven of gevalideerd.
 * - Puur en deterministisch: geen repos, geen AI, geen tijd.
 */

export interface PageContentIndex {
  /** Pagina-SEO uit het plan (title/metaDescription) — handover-waarde. */
  readonly seo: { title: string | null; metaDescription: string | null };
  /**
   * path ("<pageKey>/<sectionIndex>") → kind → units in planvolgorde.
   * Meerdere units van hetzelfde kind (bijv. per dienstblok) behouden hun
   * arrayvolgorde — de finalizer garandeert dat die volgorde overeenkomt
   * met de blokvolgorde in het blueprint.
   */
  readonly unitsByPath: ReadonlyMap<string, ReadonlyMap<ContentUnitKind, readonly ContentUnit[]>>;
}

/**
 * Bouwt de opzoekindex voor het hele plan, per blueprint-paginakey.
 * Dubbele paden kunnen niet voorkomen (de unit-path is per pagina uniek
 * gepland; de finalizer dedupliceert per pad+kind).
 */
export function buildContentPlanIndex(plan: ContentPlan): Map<string, PageContentIndex> {
  const index = new Map<string, PageContentIndex>();
  for (const page of plan.pages) {
    const unitsByPath = new Map<string, Map<ContentUnitKind, ContentUnit[]>>();
    for (const unit of page.units) {
      const slash = unit.path.indexOf("/");
      if (slash <= 0) continue; // Ongeldige paden zijn upstream al afgewezen.
      const path = unit.path;
      let byKind = unitsByPath.get(path);
      if (!byKind) {
        byKind = new Map<ContentUnitKind, ContentUnit[]>();
        unitsByPath.set(path, byKind);
      }
      const list = byKind.get(unit.kind);
      if (list) list.push(unit);
      else byKind.set(unit.kind, [unit]);
    }
    index.set(page.key, {
      seo: page.seo ?? { title: null, metaDescription: null },
      unitsByPath,
    });
  }
  return index;
}

/**
 * Verwerkt één unit naar renderbare tekst:
 * - generated/fixed → de tekst van de unit (evidence-gedragen c.q.
 *   fact-locked verbatim; de finalizer garandeert byte-exacte afstemming).
 * - customer_slot/merchant_slot → null: de content moet nog worden aangeleverd
 *   (klant/merchant) en wordt nergens als verzonnen tekst weergegeven.
 * - text=null bij een generated/fixed unit (schema-defensief) → null; de
 *   compositie noteert dit als niet-toegepaste unit.
 */
export function unitRenderText(unit: ContentUnit): string | null {
  if (unit.status === "generated" || unit.status === "fixed") {
    return unit.text != null && unit.text.trim().length > 0 ? unit.text : null;
  }
  return null;
}

/**
 * Slotresolutie voor sectie-instellingen (tri-state):
 * - unit afwezig → fallback (bestaande specificatie-flow blijft leidend).
 * - unit aanwezig én generated/fixed → unit-tekst.
 * - unit aanwezig én customer/merchant_slot → null (bewust leeg, invulbaar).
 */
export function resolveSlotText(
  units: ReadonlyMap<ContentUnitKind, readonly ContentUnit[]> | null,
  kind: ContentUnitKind,
  fallback: string | null
): string | null {
  const unit = units?.get(kind)?.[0];
  if (unit === undefined) return fallback;
  return unitRenderText(unit);
}

/**
 * Blokteksten voor blokgedreven secties: per blokindex i de geresolveerde
 * tekst van de i-de unit van `kind`. Blokken zonder unit vallen terug op de
 * bestaande specificatie-waarde; slots blijven leeg bij customer/merchant.
 */
export function resolveBlockTexts(
  units: ReadonlyMap<ContentUnitKind, readonly ContentUnit[]> | null,
  kind: ContentUnitKind,
  plannedCount: number,
  specTexts: readonly (string | null)[]
): (string | null)[] {
  const unitList = units?.get(kind) ?? [];
  const count = Math.max(plannedCount, unitList.length, specTexts.length);
  const out: (string | null)[] = [];
  for (let i = 0; i < count; i += 1) {
    const unit = unitList[i];
    if (unit === undefined) {
      out.push(specTexts[i] ?? null);
      continue;
    }
    out.push(unitRenderText(unit));
  }
  return out;
}

/**
 * Fact-locked teksten (status=fixed) uit het plan — verbatim brondata die
 * de fabricatie-scan rechtvaardig mogen passeren richting ZIP-validatie
 * (één bron van waarheid: alleen wat deterministisch uit de bron is
 * overgenomen, geen AI-geformuleerde claims).
 */
export function contentPlanTrustedClaims(plan: ContentPlan): string[] {
  const claims: string[] = [];
  for (const page of plan.pages) {
    for (const unit of page.units) {
      if (unit.status === "fixed" && unit.text != null && unit.text.trim().length > 0) {
        claims.push(unit.text);
      }
    }
  }
  return claims;
}

/**
 * Samenvattende tellingen voor rapportage (ZIP-notities/QC-inzage): hoeveel
 * units zijn toegepast, hoeveel slots wachten op klant-/merchant-content.
 */
export function summarizeContentPlanApplication(
  plan: ContentPlan,
  appliedPaths: ReadonlySet<string>
): { applied: number; customerSlots: number; merchantSlots: number; fixedUnits: number } {
  let applied = 0;
  let customerSlots = 0;
  let merchantSlots = 0;
  let fixedUnits = 0;
  for (const page of plan.pages) {
    for (const unit of page.units) {
      if (unit.status === "customer_slot") customerSlots += 1;
      else if (unit.status === "merchant_slot") merchantSlots += 1;
      else {
        if (unit.status === "fixed") fixedUnits += 1;
        if (unitRenderText(unit) != null && appliedPaths.has(unit.path)) applied += 1;
      }
    }
  }
  return { applied, customerSlots, merchantSlots, fixedUnits };
}
