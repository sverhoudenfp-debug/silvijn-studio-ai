
import { requireStudioOwner } from "@/lib/auth/server";
import { DemoWebsitesView } from "@/components/demo/demo-websites-view";
import { isTestLeadLinked, resolveShowTestData, testLeadIdSet } from "@/lib/leads/test-data";
import { cachedListDemos, cachedListLeads } from "@/lib/dashboard/cached-reads";

export default async function DemoWebsitesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStudioOwner();
  const showTestData = resolveShowTestData(await searchParams);
  const [demos, leads] = await Promise.all([
    cachedListDemos(),
    cachedListLeads(),
  ]);
  // Testdata-scheiding (2026-10-01): demo's van testleads zijn verborgen;
  // de publieke /demo/[slug]-URL's blijven werken (per-lead artefacten).
  const testIds = testLeadIdSet(leads);
  const visibleDemos = showTestData ? demos : demos.filter((demo) => !isTestLeadLinked(testIds, demo.leadId));
  const rows = visibleDemos.map((demo) => ({
    demo,
    lead: leads.find((item) => item.id === demo.leadId) ?? null,
  }));
  return <DemoWebsitesView rows={rows} />;
}
