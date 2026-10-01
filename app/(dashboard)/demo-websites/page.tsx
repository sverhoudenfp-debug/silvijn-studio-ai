
import { requireStudioOwner } from "@/lib/auth/server";
import { DemoWebsitesView } from "@/components/demo/demo-websites-view";
import { getDemoRepository } from "@/lib/repositories/demo-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { isTestLeadLinked, resolveShowTestData, testLeadIdSet } from "@/lib/leads/test-data";

export default async function DemoWebsitesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStudioOwner();
  const showTestData = resolveShowTestData(await searchParams);
  const [demos, leads] = await Promise.all([
    getDemoRepository().list(),
    getLeadRepository().list(),
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
