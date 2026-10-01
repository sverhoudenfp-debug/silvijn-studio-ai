
import { requireStudioOwner } from "@/lib/auth/server";
import { GeneratedWebsitesView } from "@/components/websites/generated-websites-view";
import { getThemeZipArtifactRepository, type ThemeZipArtifact } from "@/lib/websites/theme-zip/repository";
import { selectDownloadableArtifact, toArtifactSummary, type DownloadableArtifactSummary } from "@/lib/websites/theme-zip/download";
import { isTestLeadLinked, isTestLeadName, resolveShowTestData, testLeadIdSet } from "@/lib/leads/test-data";
import { cachedListLeads, cachedListProjects, cachedListWebsites } from "@/lib/dashboard/cached-reads";

/**
 * Websites-overzicht (Fase 9) — echte data uit de repository.
 */
export default async function GeneratedWebsitesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStudioOwner();
  const showTestData = resolveShowTestData(await searchParams);
  const [allWebsites, projects, allLeads] = await Promise.all([
    cachedListWebsites(),
    cachedListProjects(),
    cachedListLeads(),
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
  // N+1-fix: alle artefacten in één batch-query i.p.v. per website.
  const artifactRepository = getThemeZipArtifactRepository();
  const zipArtifacts: Record<string, DownloadableArtifactSummary> = {};
  const artifactsByWebsite = new Map<string, ThemeZipArtifact[]>();
  for (const artifact of await artifactRepository.listByWebsites(websites.map((w) => w.id))) {
    const list = artifactsByWebsite.get(artifact.websiteId) ?? [];
    list.push(artifact);
    artifactsByWebsite.set(artifact.websiteId, list);
  }
  for (const website of websites) {
    const artifact = selectDownloadableArtifact(artifactsByWebsite.get(website.id) ?? []);
    if (artifact) zipArtifacts[website.id] = toArtifactSummary(artifact);
  }

  return <GeneratedWebsitesView websites={websites} projectNames={projectNames} zipArtifacts={zipArtifacts} />;
}
