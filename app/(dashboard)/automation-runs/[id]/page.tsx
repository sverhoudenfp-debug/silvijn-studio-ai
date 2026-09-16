import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { RunResumeControl } from "@/components/automation/automation-controls";
import { AutomationService } from "@/lib/automation/service";

export const metadata = { title: "Automation run | Silvijn Studio" };

/**
 * Run-detail (Fase 11): status, timing, entity, huidige step,
 * volledige step-history met errors/retries, AI-calls, cost en
 * blocked reason — de debugging-pagina van de automation engine.
 */

const stepVariant: Record<string, "success" | "warning" | "info" | "neutral"> = {
  completed: "success",
  running: "info",
  pending: "neutral",
  blocked: "warning",
  failed: "neutral",
  skipped: "neutral",
};

export default async function AutomationRunPage(props: PageProps<"/automation-runs/[id]">) {
  const { id } = await props.params;
  const service = new AutomationService();
  const run = await service.getRun(id);
  if (!run) notFound();

  const automation = await service.getAutomation(run.automationId);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/automations/${run.automationId}`} className="text-xs text-zinc-500 hover:text-zinc-300">
          ← {automation?.name ?? run.automationId}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Run</h2>
          <Badge variant={run.status === "completed" ? "success" : run.status === "paused" ? "warning" : run.status === "failed" ? "neutral" : "info"}>
            {run.status}
          </Badge>
          <span className="font-mono text-xs text-zinc-500">{run.id}</span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Entity: {run.entityType} {run.entityId ? `(${run.entityId})` : ""} · gestart{" "}
          {run.startedAt ? new Date(run.startedAt).toLocaleString("nl-NL") : "—"} · afgerond{" "}
          {run.completedAt ? new Date(run.completedAt).toLocaleString("nl-NL") : "—"} · retries: {run.retryCount}
        </p>
      </div>

      {run.waitingReason && (
        <Card>
          <CardHeader title="Wachtreden / blocker" subtitle="Waarom is deze run gestopt?" />
          <p className="text-sm text-zinc-300">{run.waitingReason}</p>
          <div className="mt-3">
            <RunResumeControl runId={run.id} status={run.status} />
          </div>
        </Card>
      )}

      {run.error && (
        <Card>
          <CardHeader title="Fout" subtitle="Definitieve fout die de run beëindigde" />
          <p className="text-sm text-red-300">{run.error}</p>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Step history"
          subtitle="Elke step met status, resultaat, retries, AI-calls en kosten — de observability-tijdlijn"
        />
        <ol className="space-y-2">
          {run.steps.map((step, index) => (
            <li key={step.stepId} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-[10px] font-semibold text-zinc-400">
                  {index + 1}
                </span>
                <span className="font-mono text-xs text-zinc-400">{step.stepId}</span>
                <Badge variant={stepVariant[step.status] ?? "neutral"}>{step.status}</Badge>
                {step.outcome && <span className="text-xs text-zinc-500">outcome: {step.outcome}</span>}
                {step.retryCount > 0 && <span className="text-xs text-amber-400/80">{step.retryCount}× retry</span>}
                {step.aiCalls > 0 && <span className="text-xs text-zinc-500">{step.aiCalls} AI-calls · ${step.estimatedCostUsd.toFixed(4)}</span>}
                {step.completedAt && (
                  <span className="ml-auto text-[11px] text-zinc-600">{new Date(step.completedAt).toLocaleTimeString("nl-NL")}</span>
                )}
              </div>
              {step.result && <p className="mt-1.5 text-sm text-zinc-300">{step.result}</p>}
              {step.error && <p className="mt-1.5 text-xs text-amber-300/90">{step.error}</p>}
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Kosten" subtitle="Technische indicator via de bestaande AI-logging" />
          <p className="text-sm text-zinc-300">
            AI-calls: {run.aiCalls} · geschat: ${run.estimatedCostUsd.toFixed(4)}
          </p>
          {run.warnings.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-amber-300/80">
              {run.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Metadata" subtitle="Context tussen steps doorgegeven" />
          <pre className="max-h-40 overflow-x-auto text-xs text-zinc-400">{JSON.stringify(run.metadata, null, 2)}</pre>
        </Card>
      </div>
    </div>
  );
}
