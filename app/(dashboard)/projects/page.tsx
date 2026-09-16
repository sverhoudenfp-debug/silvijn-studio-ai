import { ProjectsView } from "@/components/projects/projects-view";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { ProjectService } from "@/lib/projects/service";

/**
 * Projects-overzicht — echte data uit de project-repository (Fase 8).
 */
export default async function ProjectsPage() {
  const [projects, leads] = await Promise.all([
    new ProjectService().list(),
    getLeadRepository().list(),
  ]);

  const leadNames: Record<string, string> = {};
  for (const lead of leads) leadNames[lead.id] = lead.businessName;

  return <ProjectsView projects={projects} leadNames={leadNames} />;
}
