/**
 * Testdata-scheiding (productiestelling 2026-10-01).
 *
 * Eén centrale, PURE definitie van wat een test-/fixture-lead is. Alle
 * productieoppervlakken (leadslijst, dashboard "Wacht op jou", analytics,
 * sales/conversations/outreach/vragenlijsten/projecten/websites) filteren
 * testleads standaard weg; via ?test=1 is de testdata expliciet zichtbaar
 * (regressietests en opruimen blijven zo mogelijk).
 *
 * Markeringen (bewust dubbel, onmiskenbaar):
 *  1. businessName start met "[TEST-FIXTURE]" (zie lib/testing/project-zip-fixture.ts:
 *     ZIP_FLOW_FIXTURE_MARKER + TESTFIXTURE-ZIP-FLOW note-token).
 *  2. source === "mock": de historische Fase 2-mockdataset (fictieve bedrijven,
 *     nooit echte klanten; in productie weigert discovery source "mock" hard).
 *
 * Fixtures blijven BESTAAN in de database (regressietests, opruim-RPC's);
 * ze verdwijnen alleen uit de normale productie-uitvoer en uit automatische
 * outreach-selectie. Detailpagina's blijven via directe link bereikbaar.
 *
 * Dit module is bewust puur (geen server-only imports) zodat unit-tests,
 * server- en clientcode het veilig kunnen gebruiken.
 */


/** Prefix uit lib/testing/project-zip-fixture.ts (ZIP_FLOW_FIXTURE_MARKER). */
export const TEST_FIXTURE_NAME_PREFIX = "[TEST-FIXTURE]";

export interface TestLeadMarker {
  readonly businessName: string;
  readonly source: string;
}

/** True als de bedrijfsnaam met de [TEST-FIXTURE]-prefix begint. */
export function isTestLeadName(businessName: string | null | undefined): boolean {
  return Boolean(businessName?.trim().startsWith(TEST_FIXTURE_NAME_PREFIX));
}

/** True voor de historische mock-dataset (source "mock", fictieve bedrijven). */
export function isTestLeadSource(source: string | null | undefined): boolean {
  return source === "mock";
}

/** True als de lead volgens de centrale regels testdata is. */
export function isTestLead(lead: TestLeadMarker): boolean {
  return isTestLeadName(lead.businessName) || isTestLeadSource(lead.source);
}

/** Productieleads: alles wat géén testdata is. */
export function filterProductionLeads<T extends TestLeadMarker>(leads: T[]): T[] {
  return leads.filter((lead) => !isTestLead(lead));
}

/** Id-verzameling van testleads voor koppelfilters (drafts, interacties, etc.). */
export function testLeadIdSet(leads: readonly TestLeadMarkerWithId[]): Set<string> {
  const ids = new Set<string>();
  for (const lead of leads) {
    if (isTestLead(lead)) ids.add(lead.id);
  }
  return ids;
}

export interface TestLeadMarkerWithId {
  readonly id: string;
  readonly businessName: string;
  readonly source: string;
}

/** True als record.leadId naar een testlead verwijst (lege set = nooit). */
export function isTestLeadLinked(
  testIds: ReadonlySet<string>,
  leadId: string | null | undefined
): boolean {
  return Boolean(leadId && testIds.has(leadId));
}

/**
 * ?test=1 toont expliciet testdata op een productiepagina; default verbergen.
 * Elke waarde behalve "1" verbergt (strict, geen "true"/"yes"-varianten).
 */
export function resolveShowTestData(searchParams: Record<string, string | string[] | undefined>): boolean {
  const value = searchParams?.test;
  if (Array.isArray(value)) return value.includes("1");
  return value === "1";
}
