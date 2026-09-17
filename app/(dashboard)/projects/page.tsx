
import { requireStudioOwner } from "@/lib/auth/server";
import { ProjectsView } from "@/components/projects/projects-view";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { ProjectService } from "@/lib/projects/service";

/**
 * Projects-overzicht — echte data uit de project-repository (Fase 8).
 */
export default async function ProjectsPage() {
  await requireStudioOwner();
  const [projects, leads] = await Promise.all([
    new ProjectService().list(),
    getLeadRepository().list(),
  ]);

  const leadNames: Record<string, string> = {};
  for (const lead of leads) leadNames[lead.id] = lead.businessName;

  return <ProjectsView projects={projects} leadNames={leadNames} leadStatuses={Object.fromEntries(leads.map(l=>[l.id,l.leadStatus]))} />;
}
