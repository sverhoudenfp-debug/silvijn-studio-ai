import { requireStudioOwner } from "@/lib/auth/server";
import { ProjectsView } from "@/components/projects/projects-view";
import { ZipFlowFixturePanel } from "@/components/projects/zip-flow-fixture-panel";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { ProjectService } from "@/lib/projects/service";
import { ProjectZipFlowFixtureService } from "@/lib/testing/project-zip-fixture";

/**
 * Projects-overzicht — echte data uit de project-repository (Fase 8).
 * Plus het interne, owner-only zip-flow fixture-paneel (Fase I.2).
 */
export default async function ProjectsPage() {
  await requireStudioOwner();
  const [projects, leads, fixtures] = await Promise.all([
    new ProjectService().list(),
    getLeadRepository().list(),
    new ProjectZipFlowFixtureService().listFixtures(),
  ]);

  const leadNames: Record<string, string> = {};
  for (const lead of leads) leadNames[lead.id] = lead.businessName;

  return (
    <div className="space-y-6">
      <ProjectsView projects={projects} leadNames={leadNames} leadStatuses={Object.fromEntries(leads.map(l=>[l.id,l.leadStatus]))} />
      <ZipFlowFixturePanel fixtures={fixtures} />
    </div>
  );
}
