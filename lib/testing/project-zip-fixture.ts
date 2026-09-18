import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getProjectRepository } from "@/lib/projects/repository";
import { getInboundMessageRepository } from "@/lib/sales/repository";
import type { ProjectRequirements } from "@/lib/projects/types";
import type { Lead } from "@/lib/types";

/**
 * Zip-flow testfixture (Fase I.2) — veilige, owner-only testdata voor de
 * interne Project → Requirements → Design Plan → Theme ZIP flow.
 *
 * AANLEIDING: de lifecycle-guard CONFIRMED_PROSPECT_REPLY_REQUIRED (migratie
 * 0012) blokkeert terecht het handmatig doorklikken van een lead naar
 * statussen die een bevestigde prospect-reactie vereisen. Die guard wordt
 * NIET omzeild: er wordt géén (fake) reactie aangemaakt.
 *
 * In plaats daarvan levert deze fixture het veilige startpunt voor de flow
 * die erachter komt: een expliciet gemarkeerde, fictieve lead die via de
 * WETTIGE transition new→qualified gaat (geen enkele reactie vereist),
 * plus een project met complete requirements. Vanaf daar loopt de eigenaar
 * de bestaande UI-flow: financiering (prijs, betaalplan, betaling —
 * menselijke gates), Design Plan en websitegeneratie incl. Theme ZIP.
 *
 * GARANTIES:
 * - De fixture is ONMISKENBAAR gemarkeerd: "[TEST-FIXTURE]"-prefix in de
 *   naam PLUS het token "TESTFIXTURE-ZIP-FLOW" in de notes. De
 *   opruimfunctie (SQL, migratie 0022) accepteert uitsluitend leads met
 *   BEIDE markeringen.
 * - Maximaal één actieve fixture; een tweede wordt geweigerd.
 * - Bestaande (niet-gemarkeerde) leads worden nooit geraakt: geen enkele
 *   functie in deze module muteert of verwijdert niet-gemarkeerde data.
 * - De fixture gebruikt uitsluitend bestaande services en RPC's
 *   (transition_lead, set_project_requirements_complete): géén enkele
 *   productie-gate, guard of lifecycle-regel wordt gewijzigd.
 */

/** Naam-prefix van de fixture-lead (zichtbaar in alle overzichten). */
export const ZIP_FLOW_FIXTURE_MARKER = "[TEST-FIXTURE]";
/** Exact token in de notes; de SQL-opruimfunctie vereist dit token woordelijk. */
export const ZIP_FLOW_FIXTURE_NOTE_TOKEN = "TESTFIXTURE-ZIP-FLOW";

/** Vaste, fictieve bedrijfsnaam van de fixture (geen echt bedrijf). */
export const ZIP_FLOW_FIXTURE_BUSINESS_NAME = `${ZIP_FLOW_FIXTURE_MARKER} Studio Fictief (Project→ZIP flow)`;

/**
 * Fixture-requirements: doorlopen de zes blokkerende completeness-checks
 * (lib/projects/completeness.ts, 1-op-1 met de SQL evaluate) — zodat de
 * owner-RPC set_project_requirements_complete ze kan goedkeuren.
 * Uitsluitend neutrale waarden; géén verzonnen bedrijfsfeiten.
 */
export const ZIP_FLOW_FIXTURE_REQUIREMENTS: ProjectRequirements = {
  websiteType: "business_website",
  numberOfPages: 3,
  designLevel: "standard",
  responsive: true,
  ecommerce: false,
  // copywriting: false — BEWUST: de pricing-engine prijst "Tekstschrijving"
  // als add-on, en die is (terecht) niet geconfigureerd in de masterconfig.
  // copywriting: true levert daardoor ALTIJD een missing_information-
  // prijsindicatie (PRICE_NOT_READY), waardoor de fixture de
  // financieringspoort (prijs/betaling) nóóit kan doorlopen en de
  // Project→ZIP-flow doodloopt. copywriting: false is nog steeds
  // completeness-geldig (copywriting_known) en verzint geen prijs.
  copywriting: false,
  seo: false,
};

/** Herkent een fixture-lead: BEIDE markeringen vereist (prefix + note-token). */
export function isZipFlowFixtureLead(lead: Pick<Lead, "businessName" | "notes">): boolean {
  return (
    lead.businessName.startsWith(ZIP_FLOW_FIXTURE_MARKER) &&
    lead.notes.includes(ZIP_FLOW_FIXTURE_NOTE_TOKEN)
  );
}

export class ZipFlowFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipFlowFixtureError";
  }
}

export interface ZipFlowFixtureSummary {
  leadId: string;
  businessName: string;
  leadStatus: Lead["leadStatus"];
  projectId: string | null;
  /** requirements_complete van het gekoppelde project (indien aanwezig). */
  requirementsComplete: boolean;
}

export class ProjectZipFlowFixtureService {
  /** Alle actieve fixtures (uitsluitend gemarkeerde testdata; nooit echte leads). */
  async listFixtures(): Promise<ZipFlowFixtureSummary[]> {
    const leads = await getLeadRepository().list();
    const projectRepo = getProjectRepository();
    const summaries: ZipFlowFixtureSummary[] = [];
    for (const lead of leads.filter(isZipFlowFixtureLead)) {
      const project = await projectRepo.getByLeadId(lead.id);
      summaries.push({
        leadId: lead.id,
        businessName: lead.businessName,
        leadStatus: lead.leadStatus,
        projectId: project?.id ?? null,
        requirementsComplete: project?.requirementsComplete ?? false,
      });
    }
    return summaries;
  }

  /** Weigert een tweede fixture zolang er één actief is. */
  async assertNoActiveFixture(): Promise<void> {
    if ((await this.listFixtures()).length > 0) {
      throw new ZipFlowFixtureError(
        "Er bestaat al een testfixture — verwijder die eerst voordat je een nieuwe aanmaakt."
      );
    }
  }

  /**
   * Stap 1: gemarkeerde, fictieve testlead (status new — de repository start
   * elke lead als new; de wettige new→qualified-transition volgt in de
   * action via de bestaande owner-RPC). Geen prospect-reactie, geen
   * outreach, geen verzending — niets klant-zichtbaars.
   */
  async createFixtureLead(): Promise<Lead> {
    await this.assertNoActiveFixture();
    return getLeadRepository().create({
      businessName: ZIP_FLOW_FIXTURE_BUSINESS_NAME,
      industry: "Designstudio",
      city: "Utrecht",
      province: "Utrecht",
      country: "Nederland",
      websiteStatus: "no_website",
      source: "manual",
      notes: [
        ZIP_FLOW_FIXTURE_NOTE_TOKEN,
        "Fictieve testfixture voor de interne Project→Requirements→Design Plan→Theme ZIP flow. Geen echt bedrijf; nooit benaderen, mailen of als productiedata behandelen.",
      ],
    });
  }

  /**
   * Bewijs dat de fixture nooit een prospect-reply nodig heeft: een
   * fixture-lead mag geen inbound messages hebben. (Assertie-hulp.)
   */
  async assertNoProspectReply(leadId: string): Promise<void> {
    const inbound = await getInboundMessageRepository().listByLead(leadId);
    if (inbound.length > 0) {
      throw new ZipFlowFixtureError(
        "Fixture-lead heeft inbound messages — de fixture heeft nooit een reactie nodig; dit duidt op misbruik van de fixture-lead."
      );
    }
  }
}

/**
 * Verwijdert de privé storage-objecten van theme-ZIP-artefacten van de
 * fixture (vóór de SQL-opruimfunctie, die de rijen verwijdert). Server-side
 * met de service-role client; retourneert het aantal verwijderde objecten.
 * In memory-mode (tests) is dit een no-op.
 */
export async function removeFixtureZipArtifactsFromStorage(leadId: string): Promise<number> {
  const { getSupabaseServerClient, isSupabaseConfigured } = await import("@/lib/supabase/server");
  if (!isSupabaseConfigured()) return 0;
  const db = getSupabaseServerClient();
  const websites = await db.from("generated_websites").select("id").eq("lead_id", leadId);
  const websiteIds = (websites.data ?? []).map((w: { id: string }) => w.id);
  if (websiteIds.length === 0) return 0;
  const artifacts = await db
    .from("theme_zip_artifacts")
    .select("storage_bucket, storage_path")
    .in("website_id", websiteIds)
    .not("storage_path", "is", null);
  let removed = 0;
  for (const artifact of artifacts.data ?? []) {
    if (!artifact.storage_bucket || !artifact.storage_path) continue;
    const { error } = await db.storage.from(artifact.storage_bucket).remove([artifact.storage_path]);
    if (!error) removed += 1;
  }
  return removed;
}
