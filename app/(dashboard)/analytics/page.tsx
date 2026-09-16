import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { getAgencyAnalytics } from "@/lib/services/analytics";
export const dynamic = "force-dynamic";

/**
 * Fase 12 §P — productie-analytics met uitsluitend ECHTE data uit de
 * repositories (live Supabase of bewuste mock-laag). Geen hard-coded KPI's.
 */

function kpi(label: string, value: string | number, delta?: string) {
  return { label, value: String(value), delta: delta ?? "" };
}

export default async function AnalyticsPage() {
  const data = await getAgencyAnalytics();

  const hasAnyData =
    data.leads.total > 0 ||
    data.outreach.drafts + data.outreach.sent > 0 ||
    data.sales.inboundMessages > 0 ||
    data.projects.total > 0 ||
    data.ai.totalRuns > 0 ||
    data.automation.totalRuns > 0;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Analytics</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Echte cijfers uit de database (bron: {data.leadSource === "supabase" ? "live Supabase" : "mock-laag (geen Supabase geconfigureerd)"}).
        </p>
      </div>

      {!hasAnyData && (
        <Card>
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-zinc-200">Nog geen data</p>
            <p className="mt-1 text-sm text-zinc-400">
              Zodra er leads, AI-runs of automatiseringen zijn, verschijnen hier de echte cijfers.
            </p>
          </div>
        </Card>
      )}

      {data.leads.total > 0 && (
        <>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Leads</h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard kpi={kpi("Totaal leads", data.leads.total)} />
            <StatCard kpi={kpi("Nieuw", data.leads.new)} />
            <StatCard kpi={kpi("Gekwalificeerd", data.leads.qualified)} />
            <StatCard kpi={kpi("Gecontacteerd", data.leads.contacted)} />
            <StatCard kpi={kpi("Geïnteresseerd", data.leads.interested)} />
            <StatCard kpi={kpi("Gewonnen", data.leads.won)} />
            <StatCard kpi={kpi("Verloren", data.leads.lost)} />
          </div>
        </>
      )}

      {(data.outreach.drafts > 0 || data.outreach.sent > 0) && (
        <>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Outreach</h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard kpi={kpi("Concepten", data.outreach.drafts)} />
            <StatCard kpi={kpi("Klaar voor review", data.outreach.readyForReview)} />
            <StatCard kpi={kpi("Goedgekeurd (mens)", data.outreach.approved)} />
            <StatCard kpi={kpi("Verzonden", data.outreach.sent)} />
            <StatCard kpi={kpi("Geopend", data.outreach.opened)} />
            <StatCard kpi={kpi("Beantwoord", data.outreach.replied)} />
            <StatCard kpi={kpi("Geïnteresseerd", data.outreach.interested)} />
            <StatCard kpi={kpi("Opt-outs", data.outreach.optedOut)} />
          </div>
        </>
      )}

      {data.sales.inboundMessages > 0 && (
        <>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Sales</h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard kpi={kpi("Inkomende berichten", data.sales.inboundMessages)} />
            <StatCard kpi={kpi("Gekwalificeerd", data.sales.qualified)} />
            <StatCard kpi={kpi("Eis human review", data.sales.needsHuman)} />
            <StatCard kpi={kpi("Bezwaren", data.sales.objections)} />
            <StatCard kpi={kpi("Demo-aanvragen", data.sales.demoRequests)} />
            <StatCard kpi={kpi("Belverzoeken", data.sales.callRequests)} />
          </div>
        </>
      )}

      {data.projects.total > 0 && (
        <>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Projecten</h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard kpi={kpi("Totaal", data.projects.total)} />
            <StatCard kpi={kpi("Wacht op goedkeuring", data.projects.awaitingApproval)} />
            <StatCard kpi={kpi("In uitvoering", data.projects.inProgress)} />
            <StatCard kpi={kpi("Klaar voor review", data.projects.readyForReview)} />
            <StatCard kpi={kpi("Afgerond", data.projects.completed)} />
            <StatCard kpi={kpi("Geannuleerd", data.projects.cancelled)} />
          </div>
        </>
      )}

      {data.websites.generated > 0 || data.websites.approved > 0 ? (
        <>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Websites</h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard kpi={kpi("Gegenereerd", data.websites.generated)} />
            <StatCard kpi={kpi("QC geslaagd", data.websites.qcPass)} />
            <StatCard kpi={kpi("QC revisie nodig", data.websites.qcRevision)} />
            <StatCard kpi={kpi("Klaar voor Silvijn", data.websites.readyForSilvijn)} />
            <StatCard kpi={kpi("Goedgekeurd", data.websites.approved)} />
          </div>
        </>
      ) : null}

      {data.ai.totalRuns > 0 && (
        <>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">AI</h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard kpi={kpi("Totaal AI-runs", data.ai.totalRuns)} />
            <StatCard kpi={kpi("Geslaagd", data.ai.successful)} />
            <StatCard kpi={kpi("Mislukt", data.ai.failed)} />
            <StatCard kpi={kpi("Tokens", data.ai.totalTokens)} />
            <StatCard kpi={kpi("Kosten (USD)", data.ai.totalCostUsd.toFixed(4))} />
            <StatCard kpi={kpi("Kosten per lead (USD)", data.ai.costPerLead !== null ? data.ai.costPerLead.toFixed(4) : "—")} />
            <StatCard
              kpi={kpi(
                "Kosten per gekwalificeerde lead (USD)",
                data.ai.costPerQualifiedLead !== null ? data.ai.costPerQualifiedLead.toFixed(4) : "—"
              )}
            />
          </div>
        </>
      )}

      {data.automation.totalRuns > 0 && (
        <>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Automatisering</h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard kpi={kpi("Runs", data.automation.totalRuns)} />
            <StatCard kpi={kpi("Geslaagd", data.automation.completed)} />
            <StatCard kpi={kpi("Mislukt", data.automation.failed)} />
            <StatCard kpi={kpi("Gestopt", data.automation.stopped)} />
            <StatCard kpi={kpi("Gem. duur (ms)", data.automation.averageDurationMs ?? "—")} />
            <StatCard kpi={kpi("AI-calls", data.automation.aiCalls)} />
          </div>
        </>
      )}
    </div>
  );
}
