import { ActivityList } from "@/components/dashboard/activity-list";
import { AutomationStatus } from "@/components/dashboard/automation-status";
import { LeadPipeline } from "@/components/dashboard/lead-pipeline";
import { OpportunityList } from "@/components/dashboard/opportunity-list";
import { OutreachList } from "@/components/dashboard/outreach-list";
import { StatCard } from "@/components/ui/stat-card";
export const dynamic = "force-dynamic";
import { getAgencyAnalytics } from "@/lib/services/analytics";
import { getAIActivityRepository } from "@/lib/repositories/ai-activity-repository";
import { getOutreachRepository } from "@/lib/outreach/repository";
import { getAutomationRepository } from "@/lib/automation/repositories";
import { getAIConfig } from "@/lib/ai/config";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { getLeadRepository } from "@/lib/repositories/lead-repository";

/**
 * Fase 12 §P — dashboard met uitsluitend ECHTE data uit repositories.
 * Geen mock KPI's; geen nep-narratief.
 */

export default async function DashboardPage() {
  const [analytics, activities, outreachDrafts, automations, leads] = await Promise.all([
    getAgencyAnalytics(),
    getAIActivityRepository().listRecent(8),
    getOutreachRepository().list(),
    getAutomationRepository().list(),
    getLeadRepository().list(),
  ]);

  // AI-mode veilig lezen (fail-loud config in productie vangbaar tonen).
  let aiModeLabel: string;
  try {
    const config = getAIConfig();
    aiModeLabel = config.mode === "live" ? "live AI" : "mock AI";
  } catch (error) {
    aiModeLabel = error instanceof Error ? `configfout: ${error.message}` : "configfout";
  }

  const kpis = [
    { label: "Leads", value: String(analytics.leads.total), delta: analytics.leads.new > 0 ? `${analytics.leads.new} nieuw` : "" },
    { label: "Gekwalificeerd", value: String(analytics.leads.qualified), delta: "" },
    { label: "Geïnteresseerd", value: String(analytics.leads.interested), delta: "" },
    { label: "Projecten", value: String(analytics.projects.total), delta: analytics.projects.awaitingApproval > 0 ? `${analytics.projects.awaitingApproval} wachten op jou` : "" },
    { label: "Outreach-concepten", value: String(analytics.outreach.drafts), delta: analytics.outreach.readyForReview > 0 ? `${analytics.outreach.readyForReview} klaar voor review` : "" },
    { label: "Websites klaar voor review", value: String(analytics.websites.readyForSilvijn), delta: "" },
    { label: "AI-runs", value: String(analytics.ai.totalRuns), delta: analytics.ai.totalCostUsd > 0 ? `$${analytics.ai.totalCostUsd.toFixed(4)}` : "" },
    { label: "Automation-runs", value: String(analytics.automation.totalRuns), delta: "" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Goedendag, Silvijn</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Alle cijfers zijn echt (bron: {analytics.leadSource === "supabase" ? "live Supabase" : "mock-laag"}). AI draait in {aiModeLabel}{isSupabaseConfigured() ? "" : "; Supabase is niet geconfigureerd"}. Automatische e-mails, publicaties en goedkeuringen zijn uitgeschakeld — alles wacht op jou.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {kpis.map((kpi) => (
          <StatCard
            key={kpi.label}
            kpi={kpi}
            deltaTone={
              kpi.label === "Projecten" || kpi.label === "Outreach-concepten" ? "warning" : "info"
            }
          />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <ActivityList activities={activities} />
          <OpportunityList leads={leads} />
          <OutreachList drafts={outreachDrafts} />
        </div>
        <div className="space-y-6">
          <LeadPipeline byStatus={analytics.leads.byStatus} />
          <AutomationStatus automations={automations} />
        </div>
      </div>
    </div>
  );
}
