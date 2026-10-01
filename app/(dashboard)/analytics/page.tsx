import Link from "next/link";
import { requireStudioOwner } from "@/lib/auth/server";
import { Card } from "@/components/ui/card";
import { BarChart, FunnelChart } from "@/components/analytics/charts";
import { parsePeriodSearchParams, type PeriodKind } from "@/lib/analytics/period";
import { getPeriodAnalytics } from "@/lib/analytics/metrics";
export const dynamic = "force-dynamic";

/**
 * Analytics (2026-10-01) — uitsluitend echte, menselijk bevestigde data:
 * omzet komt alleen uit payment_events (bevestigde betalingen). Onbekende
 * cijfers worden nooit als feit getoond; nul betekent hier echt nul.
 */

const PERIOD_OPTIONS: { kind: PeriodKind; label: string }[] = [
  { kind: "today", label: "Vandaag" },
  { kind: "week", label: "Deze week" },
  { kind: "month", label: "Deze maand" },
  { kind: "year", label: "Dit jaar" },
  { kind: "all", label: "Sinds start" },
];

function euro(value: number): string {
  return `€${value.toLocaleString("nl-NL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function delta(current: number, previous: number | null): { text: string; tone: "info" | "success" | "warning" } | null {
  if (previous === null) return null;
  if (previous === 0) return current > 0 ? { text: "nieuw", tone: "success" } : null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return null;
  return { text: `${pct > 0 ? "+" : ""}${pct}%`, tone: pct > 0 ? "success" : "warning" };
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStudioOwner();
  const params = await searchParams;
  const now = new Date();
  const range = parsePeriodSearchParams(params, now);
  const data = await getPeriodAnalytics(range);

  const kpiCards = [
    {
      label: `Omzet — ${range.label.toLowerCase()}`,
      value: euro(data.kpis.revenue.total),
      delta: delta(data.kpis.revenue.total, data.kpis.previousRevenue ? data.kpis.previousRevenue.total : null),
      hint: data.kpis.revenue.count > 0
        ? `${data.kpis.revenue.count} bevestigde betaling${data.kpis.revenue.count === 1 ? "" : "en"}${data.kpis.revenue.average !== null ? ` · gem. ${euro(data.kpis.revenue.average)}` : ""}`
        : "Nog geen bevestigde betalingen in deze periode",
    },
    {
      label: "Nieuwe leads",
      value: String(data.kpis.newLeads),
      delta: delta(data.kpis.newLeads, data.kpis.previousNewLeads),
      hint: "Leads aangemaakt in de geselecteerde periode",
    },
    {
      label: "Reacties (inbound)",
      value: String(data.kpis.replies),
      delta: delta(data.kpis.replies, data.kpis.previousReplies),
      hint: "Binnenkomende klantreacties per e-mail",
    },
    {
      label: "Outreach verzonden",
      value: String(data.kpis.outreachSent),
      hint: "Verzonden e-mails in de geselecteerde periode",
    },
    {
      label: "AI-runs",
      value: String(data.kpis.aiRuns),
      hint: data.kpis.aiCostUsd > 0 ? `geschatte kosten $${data.kpis.aiCostUsd.toFixed(4)}` : "alle runs bij elkaar",
    },
    {
      label: "Omzet sinds start",
      value: euro(data.lifetimeRevenue.total),
      hint: data.lifetimeRevenue.count > 0
        ? `${data.lifetimeRevenue.count} betaling${data.lifetimeRevenue.count === 1 ? "" : "en"} in totaal`
        : "Nog geen bevestigde betalingen",
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Analytics</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Echte cijfers uit de database (bron: {data.leadSource === "supabase" ? "live Supabase" : "mock-laag"}). Omzet
            telt uitsluitend door jou bevestigde betalingen.
          </p>
        </div>
        {/* Periodefilter: server-side via Links, geen client-state, directe navigatie */}
        <nav className="flex flex-wrap gap-1.5" aria-label="Periodefilter">
          {PERIOD_OPTIONS.map((option) => {
            const active = range.kind === option.kind;
            return (
              <Link
                key={option.kind}
                href={`/analytics?period=${option.kind}`}
                className={
                  active
                    ? "rounded-lg bg-indigo-500/15 px-3 py-1.5 text-xs font-semibold text-indigo-300 ring-1 ring-indigo-500/40"
                    : "rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-200"
                }
                aria-current={active ? "page" : undefined}
              >
                {option.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <p className="-mt-5 text-xs text-zinc-500">Geselecteerde periode: {range.label}</p>

      {!data.hasAnyProductionData ? (
        <Card>
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-zinc-200">Nog geen productiedata</p>
            <p className="mt-1 text-sm text-zinc-400">
              Zodra er echte leads, outreach, reacties of betalingen zijn, verschijnen hier de cijfers. Er wordt niets
              verzonnen of op nul gezet wat onbekend is.
            </p>
          </div>
        </Card>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {kpiCards.map((kpi) => (
              <div key={kpi.label} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
                <p className="text-xs font-medium text-zinc-400">{kpi.label}</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">{kpi.value}</p>
                {kpi.delta ? (
                  <p className={`mt-1 text-xs ${kpi.delta.tone === "success" ? "text-emerald-400" : kpi.delta.tone === "warning" ? "text-amber-400" : "text-indigo-300"}`}>
                    {kpi.delta.text} t.o.v. vorige periode
                  </p>
                ) : null}
                <p className="mt-1 text-[11px] text-zinc-500">{kpi.hint}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <BarChart
              title="Omzet over tijd"
              description="Bevestigde betalingen per periode"
              bucketLabels={data.series.buckets.map((b) => b.label)}
              series={[{ label: "Omzet", values: data.series.revenue, tone: "primary" }]}
              formatValue={(v) => euro(v)}
            />
            <BarChart
              title="Nieuwe leads over tijd"
              bucketLabels={data.series.buckets.map((b) => b.label)}
              series={[{ label: "Leads", values: data.series.leads, tone: "primary" }]}
            />
            <BarChart
              title="Outreach en reacties"
              description="Verzonden e-mails tegenover binnenkomende reacties"
              bucketLabels={data.series.buckets.map((b) => b.label)}
              series={[
                { label: "Verzonden", values: data.series.outreachSent, tone: "primary" },
                { label: "Reacties", values: data.series.replies, tone: "muted" },
              ]}
            />
            <Card>
              <div className="p-5">
                <p className="text-sm font-semibold text-zinc-100">Lead-funnel</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Cumulatieve lifecycle-treden (een &quot;gecontacteerde&quot; lead is ook gekwalificeerd geweest).
                </p>
                <div className="mt-4">
                  <FunnelChart rows={data.leadsByStage} />
                </div>
              </div>
            </Card>
            <Card>
              <div className="p-5">
                <p className="text-sm font-semibold text-zinc-100">Outreach-funnel</p>
                <p className="mt-1 text-xs text-zinc-500">Verzonden → geopend → gereageerd (per lead).</p>
                <div className="mt-4">
                  <FunnelChart rows={data.outreachFunnel} />
                </div>
              </div>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
