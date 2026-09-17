
import { requireStudioOwner } from "@/lib/auth/server";
import { GeneratedWebsitesView } from "@/components/websites/generated-websites-view";
import { getProjectRepository } from "@/lib/projects/repository";
import { WebsiteGenerationService } from "@/lib/websites/service";

/**
 * Websites-overzicht (Fase 9) — echte data uit de repository.
 */
export default async function GeneratedWebsitesPage() {
  await requireStudioOwner();
  const [websites, projects] = await Promise.all([
    new WebsiteGenerationService().list(),
    getProjectRepository().list(),
  ]);

  const projectNames: Record<string, string> = {};
  for (const project of projects) projectNames[project.id] = project.name;

  return <GeneratedWebsitesView websites={websites} projectNames={projectNames} />;
}
