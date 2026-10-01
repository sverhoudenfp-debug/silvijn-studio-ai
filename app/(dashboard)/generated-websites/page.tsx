
import { requireStudioOwner } from "@/lib/auth/server";
import { GeneratedWebsitesView } from "@/components/websites/generated-websites-view";
import { getProjectRepository } from "@/lib/projects/repository";
import { WebsiteGenerationService } from "@/lib/websites/service";
import { getThemeZipArtifactRepository } from "@/lib/websites/theme-zip/repository";
import { selectDownloadableArtifact, toArtifactSummary, type DownloadableArtifactSummary } from "@/lib/websites/theme-zip/download";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { isTestLeadLinked, isTestLeadName, resolveShowTestData, testLeadIdSet } from "@/lib/leads/test-data";

/**
 * Websites-overzicht (Fase 9) — echte data uit de repository.
 */
export default async function GeneratedWebsitesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStudioOwner();
  const showTestData = resolveShowTestData(await searchParams);
  const [allWebsites, projects, allLeads] = await Promise.all([
    new WebsiteGenerationService().list(),
    getProjectRepository().list(),
    getLeadRepository().list(),
  ]);
  // Testdata-scheiding (2026-10-01): fixture-websites zijn verborgen in het
  // normale overzicht; ?test=1 toont expliciet (regressietests/opruimen).
  const testIds = testLeadIdSet(allLeads);
  const websites = showTestData
    ? allWebsites
    : allWebsites.filter((w) => !isTestLeadLinked(testIds, w.leadId) && !isTestLeadName(w.businessName));

  const projectNames: Record<string, string> = {};
  for (const project of projects) projectNames[project.id] = project.name;

  // Downloadbaar theme-ZIP per websiteversie (uitsluitend bestaande,
  // gevalideerde artefacten — geen generatie, geen gate-verandering).
  const artifactRepository = getThemeZipArtifactRepository();
  const zipArtifacts: Record<string, DownloadableArtifactSummary> = {};
  for (const website of websites) {
    const artifact = selectDownloadableArtifact(await artifactRepository.listByWebsite(website.id));
    if (artifact) zipArtifacts[website.id] = toArtifactSummary(artifact);
  }

  return <GeneratedWebsitesView websites={websites} projectNames={projectNames} zipArtifacts={zipArtifacts} />;
}
