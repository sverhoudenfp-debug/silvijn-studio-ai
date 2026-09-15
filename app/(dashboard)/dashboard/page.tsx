import { ActivityList } from "@/components/dashboard/activity-list";
import { AutomationStatus } from "@/components/dashboard/automation-status";
import { LeadPipeline } from "@/components/dashboard/lead-pipeline";
import { OpportunityList } from "@/components/dashboard/opportunity-list";
import { OutreachList } from "@/components/dashboard/outreach-list";
import { StatCard } from "@/components/ui/stat-card";
import { kpis } from "@/lib/mock-data";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Goedendag, Silvijn</h2>
        <p className="mt-1 text-sm text-zinc-400">
          De AI heeft vandaag 42 nieuwe leads gevonden, 3 demo&apos;s gegenereerd en 2 gesprekken
          gevoerd. Alle modules draaien in mock mode.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {kpis.map((kpi) => (
          <StatCard key={kpi.label} kpi={kpi} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <ActivityList />
          <OpportunityList />
          <OutreachList />
        </div>
        <div className="space-y-6">
          <LeadPipeline />
          <AutomationStatus />
        </div>
      </div>
    </div>
  );
}
