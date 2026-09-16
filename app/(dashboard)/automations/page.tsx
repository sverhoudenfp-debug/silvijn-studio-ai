import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { AutomationControls } from "@/components/automation/automation-controls";
import { AutomationService } from "@/lib/automation/service";
import { getAutomationLimits, getAutonomyLevel } from "@/lib/automation/limits";
import type { Automation } from "@/lib/automation/types";

export const metadata = { title: "Automations | Silvijn Studio" };

/**
 * Automation-dashboard (Fase 11) — echte repository-cijfers, geen fake
 * metrics; lege state zodra er nog niets gedraaid heeft. Manual controls
 * zijn server actions; approve/deliver bestaan hier bewust NIET.
 */

const statusVariant: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  active: "success",
  paused: "warning",
  failed: "danger",
  disabled: "neutral",
  draft: "info",
  completed: "success",
};

function StatTile({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 transition-colors hover:border-zinc-700">
      <p className="text-xs font-medium text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-50">{count}</p>
    </div>
  );
}

export default async function AutomationsPage() {
  const service = new AutomationService();
  const automations = await service.listAutomations();
  const runs = await service.listRuns(100);
  const limits = getAutomationLimits();

  const activeAutomations = automations.filter((a) => a.status === "active" && a.enabled);
  const paused = automations.filter((a) => a.status === "paused");
  const failedRuns = runs.filter((r) => r.status === "failed");
  const waitingRuns = runs.filter((r) => r.status === "paused");
  const completedRuns = runs.filter((r) => r.status === "completed");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Automations</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Event-driven orchestration van de bestaande engines. Autonomieniveau: {getAutonomyLevel()} (deterministisch —
            AI kan dit niet wijzigen). Human gates blijven absoluut.
          </p>
        </div>
        <p className="text-xs text-zinc-500">
          Limieten: {limits.maxRunsPerHour}/uur · {limits.maxAiCallsPerRun} AI-calls/run · ${limits.maxCostUsdPerRun}/run
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Automations actief" count={activeAutomations.length} />
        <StatTile label="Gepauzeerd" count={paused.length} />
        <StatTile label="Runs voltooid" count={completedRuns.length} />
        <StatTile label="Runs gefaald" count={failedRuns.length} />
        <StatTile label="Wacht op mens" count={waitingRuns.length} />
        <StatTile label="Runs totaal" count={runs.length} />
      </div>

      {automations.length === 0 ? (
        <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-400">
          Nog geen automations. De voorbeeldworkflows worden automatisch geseed — ververs of controleer de repository.
        </p>
      ) : (
        <div className="space-y-4">
          {automations.map((automation) => (
            <AutomationRow key={automation.id} automation={automation} />
          ))}
        </div>
      )}

      <Card>
        <CardHeader title="Recente runs" subtitle="Nieuwste eerst — klik voor volledige step-history, kosten en events" />
        {runs.length === 0 ? (
          <p className="text-sm text-zinc-400">Nog geen runs uitgevoerd.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-400">
                  <th className="py-2.5 pr-3 font-medium">Run</th>
                  <th className="py-2.5 pr-3 font-medium">Automation</th>
                  <th className="py-2.5 pr-3 font-medium">Status</th>
                  <th className="py-2.5 pr-3 font-medium">Entity</th>
                  <th className="py-2.5 pr-3 font-medium">AI-calls</th>
                  <th className="py-2.5 pr-3 font-medium">Cost</th>
                  <th className="py-2.5 pr-3 font-medium">Gestart</th>
                  <th className="py-2.5 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 10).map((run) => (
                  <tr key={run.id} className="border-b border-zinc-800/60 last:border-0">
                    <td className="py-2.5 pr-3 font-mono text-xs text-zinc-500">{run.id.slice(0, 18)}…</td>
                    <td className="py-2.5 pr-3 text-zinc-200">{automations.find((a) => a.id === run.automationId)?.name ?? run.automationId}</td>
                    <td className="py-2.5 pr-3">
                      <Badge variant={run.status === "completed" ? "success" : run.status === "failed" ? "danger" : run.status === "paused" ? "warning" : "info"}>
                        {run.status}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-3 text-zinc-400">{run.entityId ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-zinc-300">{run.aiCalls}</td>
                    <td className="py-2.5 pr-3 text-zinc-300">${run.estimatedCostUsd.toFixed(4)}</td>
                    <td className="py-2.5 pr-3 text-zinc-500">{new Date(run.createdAt).toLocaleString("nl-NL")}</td>
                    <td className="py-2.5">
                      <Link href={`/automation-runs/${run.id}`} className="text-indigo-400 hover:text-indigo-300">
                        Bekijk
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function AutomationRow({ automation }: { automation: Automation }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/automations/${automation.id}`} className="text-sm font-semibold text-zinc-100 hover:text-indigo-400">
              {automation.name}
            </Link>
            <Badge variant={statusVariant[automation.status] ?? "neutral"}>{automation.status}</Badge>
            {!automation.enabled && <span className="text-xs text-zinc-500">uitgeschakeld</span>}
          </div>
          <p className="mt-1 max-w-2xl text-xs text-zinc-400">{automation.description}</p>
          <p className="mt-2 text-xs text-zinc-500">
            Trigger: {automation.trigger} · {automation.steps.length} steps · {automation.executionCount} runs ·{" "}
            {automation.successCount}× succes · {automation.failureCount}× gefaald
            {automation.lastRunAt ? ` · laatste run: ${new Date(automation.lastRunAt).toLocaleString("nl-NL")}` : " · nog niet gedraaid"}
          </p>
        </div>
        <AutomationControls automationId={automation.id} status={automation.status} enabled={automation.enabled} />
      </div>
    </Card>
  );
}
