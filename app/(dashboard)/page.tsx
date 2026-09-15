import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { activities, kpis, leadStatusMeta, leads, pipeline } from "@/lib/mock-data";
import { scoreVariant } from "@/lib/utils";

const activityColors: Record<string, string> = {
  search: "bg-sky-400",
  check: "bg-zinc-400",
  score: "bg-violet-400",
  demo: "bg-indigo-400",
  email: "bg-amber-400",
  send: "bg-emerald-400",
  reply: "bg-emerald-300",
  qualify: "bg-pink-400",
};

export default function DashboardPage() {
  const topOpportunities = [...leads].sort((a, b) => b.leadScore - a.leadScore).slice(0, 5);
  const maxCount = Math.max(...pipeline.map((stage) => stage.count));

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Goedemorgen, Silvijn</h2>
        <p className="mt-1 text-sm text-zinc-400">
          De AI heeft afgelopen nacht 18 nieuwe leads gevonden, 3 demo&apos;s gegenereerd en 2 gesprekken gevoerd.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {kpis.map((kpi) => (
          <StatCard key={kpi.label} kpi={kpi} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="AI Activity"
            subtitle="Wat het systeem de afgelopen uren heeft uitgevoerd"
            action={<Badge variant="success">Live</Badge>}
          />
          <ol className="relative space-y-5 border-l border-zinc-800 pl-5">
            {activities.map((entry, index) => (
              <li key={index} className="relative">
                <span
                  className={`absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ${activityColors[entry.type] ?? "bg-zinc-400"}`}
                />
                <p className="text-xs font-mono text-zinc-500">{entry.time}</p>
                <p className="mt-0.5 text-sm text-zinc-300">{entry.message}</p>
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Lead Pipeline" subtitle="Van ontdekking tot klant" />
            <div className="space-y-4">
              {pipeline.map((stage) => (
                <div key={stage.label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-zinc-400">{stage.label}</span>
                    <span className="font-medium text-zinc-200">{stage.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-800">
                    <div
                      className="h-1.5 rounded-full bg-indigo-500"
                      style={{ width: `${Math.max((stage.count / maxCount) * 100, 3)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Automation" subtitle="Volgende run: morgen 07:00" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-300">Alle automations</span>
              <Badge variant="success">Actief</Badge>
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Top Opportunities"
          subtitle="Best scorende leads op dit moment"
          action={
            <Link href="/leads" className="text-xs font-medium text-indigo-400 hover:text-indigo-300">
              Alle leads →
            </Link>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                <th className="pb-2 pr-4 font-medium">Bedrijf</th>
                <th className="pb-2 pr-4 font-medium">Branche</th>
                <th className="pb-2 pr-4 font-medium">Locatie</th>
                <th className="pb-2 pr-4 font-medium">Reviews</th>
                <th className="pb-2 pr-4 font-medium">Score</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {topOpportunities.map((lead) => (
                <tr key={lead.id} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                  <td className="py-2.5 pr-4 font-medium text-zinc-100">{lead.name}</td>
                  <td className="py-2.5 pr-4 text-zinc-400">{lead.category}</td>
                  <td className="py-2.5 pr-4 text-zinc-400">{lead.location}</td>
                  <td className="py-2.5 pr-4 text-zinc-400">
                    {lead.rating ?? "—"} ({lead.reviewCount ?? 0})
                  </td>
                  <td className="py-2.5 pr-4">
                    <Badge variant={scoreVariant(lead.leadScore)}>{lead.leadScore}</Badge>
                  </td>
                  <td className="py-2.5">
                    <Badge variant={leadStatusMeta[lead.status].variant}>
                      {leadStatusMeta[lead.status].label}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
