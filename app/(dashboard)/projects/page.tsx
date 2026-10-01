import { requireStudioOwner } from "@/lib/auth/server";
import { ProjectsView } from "@/components/projects/projects-view";
import { ZipFlowFixturePanel } from "@/components/projects/zip-flow-fixture-panel";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { ProjectService } from "@/lib/projects/service";
import { ProjectZipFlowFixtureService } from "@/lib/testing/project-zip-fixture";
import { isTestLead, isTestLeadLinked, resolveShowTestData, testLeadIdSet } from "@/lib/leads/test-data";

/**
 * Projects-overzicht — echte data uit de project-repository (Fase 8).
 * Plus het interne, owner-only zip-flow fixture-paneel (Fase I.2).
 */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStudioOwner();
  const showTestData = resolveShowTestData(await searchParams);
  const [allProjects, allLeads, fixtures] = await Promise.all([
    new ProjectService().list(),
    getLeadRepository().list(),
    new ProjectZipFlowFixtureService().listFixtures(),
  ]);
  // Testdata-scheiding (2026-10-01): fixture-projecten zijn verborgen in het
  // normale overzicht; het expliciete ZipFlowFixturePanel hieronder blijft
  // de zichtbare, bedoelde fixture-beheeromgeving (?test=1 toont alles).
  const testIds = testLeadIdSet(allLeads);
  const projects = showTestData ? allProjects : allProjects.filter((p) => !isTestLeadLinked(testIds, p.leadId));
  const leads = showTestData ? allLeads : allLeads.filter((l) => !isTestLead(l));

  const leadNames: Record<string, string> = {};
  for (const lead of leads) leadNames[lead.id] = lead.businessName;

  return (
    <div className="space-y-6">
      <ProjectsView projects={projects} leadNames={leadNames} leadStatuses={Object.fromEntries(leads.map(l=>[l.id,l.leadStatus]))} />
      <ZipFlowFixturePanel fixtures={fixtures} />
    </div>
  );
}
