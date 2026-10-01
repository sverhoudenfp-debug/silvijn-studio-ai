import Link from "next/link";
import { requireStudioOwner } from "@/lib/auth/server";
import { LeadsView } from "@/components/leads/leads-view";
import { cachedListLeads } from "@/lib/dashboard/cached-reads";
import { filterProductionLeads, isTestLead, resolveShowTestData } from "@/lib/leads/test-data";

export const dynamic = "force-dynamic";

/**
 * Productieleads als normaal overzicht. Test-/fixture-/mock-leads zijn
 * verborgen (2026-10-01); via ?test=1 zijn ze expliciet zichtbaar voor
 * regressietests en opruimen. Detailpagina's blijven direct bereikbaar.
 */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStudioOwner();
  const params = await searchParams;
  const showTestData = resolveShowTestData(params);
  const allLeads = await cachedListLeads();
  const testLeads = allLeads.filter(isTestLead);
  const leads = showTestData ? allLeads : filterProductionLeads(allLeads);

  return (
    <div className="space-y-4">
      {testLeads.length > 0 && (
        <p className="text-sm text-zinc-400">
          {showTestData ? (
            <>
              {testLeads.length} testlead{testLeads.length === 1 ? "" : "s"} zichtbaar (gemarkeerd als testdata).{" "}
              <Link href="/leads" className="underline underline-offset-2 hover:text-zinc-200">Verberg testleads</Link>
            </>
          ) : (
            <>
              {testLeads.length} testlead{testLeads.length === 1 ? "" : "s"} verborgen.{" "}
              <Link href="/leads?test=1" className="underline underline-offset-2 hover:text-zinc-200">Toon testleads</Link>
            </>
          )}
        </p>
      )}
      <LeadsView leads={leads} />
    </div>
  );
}
