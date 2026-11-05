import type { WebsiteBlueprint } from "../blueprint/blueprint";
import type { ContentPlan, ContentUnit } from "./content-plan";

/**
 * REPARATIERONDE (W2, 2026-11-05)
 *
 * De contentkeuring kan een plan afkeuren op diepgang of op een onbewijsbare
 * bewering. De afgesproken keten is generate → fix → re-QC met een luslimiet;
 * zonder herstelronde belandt een betaalde, grotendeels goede pass in de
 * prullenbak (live gezien bij Veld & Vorm: over-ons 100 woorden).
 *
 * Deze module houdt het herstel deterministisch en klein:
 * - alleen de afgekeurde pagina's worden opnieuw opgevraagd (subset-blueprint);
 * - de overige pagina's blijven byte-identiek;
 * - de samenvoeging is puur en testbaar, zonder AI.
 */

/** Blueprint met alleen de opgegeven paginakeys, in dezelfde volgorde. */
export function subsetBlueprint(blueprint: WebsiteBlueprint, pageKeys: readonly string[]): WebsiteBlueprint {
  const wanted = new Set(pageKeys);
  return {
    ...blueprint,
    pages: blueprint.pages.filter((page) => wanted.has(page.key)),
  };
}

export type RepairedPage = {
  readonly key: string;
  readonly units: readonly ContentUnit[];
};

/**
 * Vervangt de units van de herstelde pagina's. Pagina's die niet zijn
 * opgevraagd blijven onaangeroerd; een pagina die de AI oversloeg houdt zijn
 * oude units (nooit stilzwijgend leegmaken).
 */
export function mergeRepairedPages(
  plan: ContentPlan,
  repaired: readonly RepairedPage[]
): { plan: ContentPlan; replaced: string[]; ignored: string[] } {
  const byKey = new Map(repaired.map((page) => [page.key, page.units]));
  const replaced: string[] = [];
  const ignored: string[] = [];
  const pages = plan.pages.map((page) => {
    const units = byKey.get(page.key);
    if (!units || units.length === 0) {
      if (units) ignored.push(page.key);
      return page;
    }
    replaced.push(page.key);
    return { ...page, units: [...units] };
  });
  for (const page of repaired) {
    if (!plan.pages.some((existing) => existing.key === page.key)) ignored.push(page.key);
  }
  return { plan: { ...plan, pages }, replaced, ignored };
}

/** Paginakeys met een blokkerend keuringspunt, in planvolgorde. */
export function pagesNeedingRepair(
  plan: ContentPlan,
  issues: readonly { page: string; severity: string }[]
): string[] {
  const blocking = new Set(issues.filter((issue) => issue.severity === "blocking").map((issue) => issue.page));
  return plan.pages.map((page) => page.key).filter((key) => blocking.has(key));
}
