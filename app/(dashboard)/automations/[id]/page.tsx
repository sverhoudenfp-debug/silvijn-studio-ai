import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { AutomationControls } from "@/components/automation/automation-controls";
import { AutomationService } from "@/lib/automation/service";

export const metadata = { title: "Automation | Silvijn Studio" };

/**
 * Automation-detail (Fase 11): workflow, steps, recente runs, errors,
 * retries, huidige step, wachtreden, cost-summary en events — zodat
 * altijd duidelijk is WAAR de automation is gestopt.
 */

export default async function AutomationDetailPage(props: PageProps<"/automations/[id]">) {
  const { id } = await props.params;
  const service = new AutomationService();
  const { automation, runs } = await service.getAutomationWithRuns(id);
  if (!automation) notFound();

  const totalAiCalls = runs.reduce((sum, run) => sum + run.aiCalls, 0);
  const totalCost = runs.reduce((sum, run) => sum + run.estimatedCostUsd, 0);
  const waiting = runs.find((r) => r.status === "paused");
  const latestEvents = await service.listEvents(20);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/automations" className="text-xs text-zinc-500 hover:text-zinc-300">
            ← Automations
          </Link>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">{automation.name}</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">{automation.description}</p>
          <p className="mt-2 text-xs text-zinc-500">
            Type: {automation.type} · Trigger: {automation.trigger} · Status: {automation.status} · {automation.executionCount} runs ·{" "}
            {automation.successCount}× succes · {automation.failureCount}× gefaald
          </p>
        </div>
        <AutomationControls automationId={automation.id} status={automation.status} enabled={automation.enabled} />
      </div>

      {waiting && (
        <Card>
          <CardHeader title="Waar is de automation gestopt?" subtitle={`Run ${waiting.id}`} />
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="warning">WAITING FOR HUMAN</Badge>
            <span className="text-sm text-zinc-300">{waiting.waitingReason ?? "onbekende reden"}</span>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Hervatten kan alléén via de run-detailpagina nadat de human gate is vervuld (bijv. website goedgekeurd via het
            QC-rapport).{" "}
            <Link href={`/automation-runs/${waiting.id}`} className="text-indigo-400 hover:text-indigo-300">
              Naar de run →
            </Link>
          </p>
        </Card>
      )}

      <Card>
        <CardHeader title="Workflow" subtitle="Steps in vaste volgorde — de AI kan geen nieuwe steps creëren of uitvoeren" />
        <ol className="space-y-2">
          {automation.steps.map((step, index) => (
            <li key={step.id} className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-[10px] font-semibold text-zinc-400">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-100">
                  {step.name} <span className="font-mono text-xs text-zinc-500">({step.type})</span>
                  {step.type === "wait_for_human" && <Badge variant="warning">HUMAN GATE</Badge>}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">{step.description}</p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  timeout {Math.round(step.timeoutMs / 1000)}s · max {step.maxRetries} retries · autonomie ≥ {step.requiredAutonomy}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Cost summary" subtitle="Via de bestaande AI-run-logging; technische indicator" />
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xs text-zinc-400">Runs</p>
              <p className="mt-1 text-xl font-semibold text-zinc-50">{runs.length}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-400">AI-calls</p>
              <p className="mt-1 text-xl font-semibold text-zinc-50">{totalAiCalls}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-400">Geschat ($)</p>
              <p className="mt-1 text-xl font-semibold text-zinc-50">{totalCost.toFixed(4)}</p>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Recente events" subtitle="Typed event-log (observability)" />
          {latestEvents.length === 0 ? (
            <p className="text-sm text-zinc-400">Nog geen events.</p>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto text-xs">
              {latestEvents.map((event) => (
                <li key={event.id} className="flex gap-2">
                  <span className="shrink-0 text-zinc-500">{new Date(event.timestamp).toLocaleTimeString("nl-NL")}</span>
                  <span className="text-zinc-300">
                    <span className="font-mono text-[11px] text-zinc-500">{event.type}</span>
                    {event.entityId ? ` · ${event.entityId}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Runs" subtitle="Met step-history, errors en retries" />
        {runs.length === 0 ? (
          <p className="text-sm text-zinc-400">Nog geen runs voor deze automation.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-400">
                  <th className="py-2.5 pr-3 font-medium">Run</th>
                  <th className="py-2.5 pr-3 font-medium">Status</th>
                  <th className="py-2.5 pr-3 font-medium">Huidige step</th>
                  <th className="py-2.5 pr-3 font-medium">Wachtreden</th>
                  <th className="py-2.5 pr-3 font-medium">Gestart</th>
                  <th className="py-2.5 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b border-zinc-800/60 last:border-0">
                    <td className="py-2.5 pr-3 font-mono text-xs text-zinc-500">{run.id.slice(0, 18)}…</td>
                    <td className="py-2.5 pr-3">
                      <Badge variant={run.status === "completed" ? "success" : run.status === "paused" ? "warning" : run.status === "failed" ? "danger" : "info"}>
                        {run.status}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-3 text-zinc-300">{run.currentStep ?? "—"}</td>
                    <td className="py-2.5 pr-3 max-w-xs truncate text-xs text-zinc-500" title={run.waitingReason ?? ""}>
                      {run.waitingReason ?? "—"}
                    </td>
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
      <AutomationStepLegend />
    </div>
  );
}

function AutomationStepLegend() {
  return (
    <p className="text-xs text-zinc-500">
      Step-statussen: pending → running → completed / failed / blocked / skipped. BLOCKED-steps worden niet
      automatisch opnieuw geprobeerd zonder dat de blocker verandert.
    </p>
  );
}
