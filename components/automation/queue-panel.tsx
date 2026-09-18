"use client";

import { useState } from "react";
import { drainAutomationQueueAction } from "@/app/actions/automations";
import { Badge } from "@/components/ui/badge";
import type { DrainResult } from "@/lib/automation/runtime";
import type { AutomationQueueItem } from "@/lib/automation/types";

/**
 * Queue-panel van de productie-runtime (Masterconfig Automation Runtime).
 *
 * De knop "Verwerk queue nu" hergebruikt EXACT de productie-runtime van de
 * cron-drain (claim → bestaande orchestrator → uitkomst + audit). De
 * runtime claimt alleen al bestaande queue-items en start zelf nooit
 * automations; alle human gates blijven van kracht.
 */

const queueVariant: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  queued: "info",
  processing: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
};

export function QueuePanel({ items }: { items: AutomationQueueItem[] }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DrainResult | null>(null);

  const queued = items.filter((item) => item.status === "queued" || item.status === "processing");

  async function drain() {
    setError(null);
    setResult(null);
    setPending(true);
    try {
      const drained = await drainAutomationQueueAction();
      setResult(drained);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Drain mislukt");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Runtime-queue</h3>
          <p className="mt-0.5 text-xs text-zinc-400">
            Cron ({"/api/cron/automation-runtime"}) verwerkt de queue automatisch (elke 10 min). Handmatige verwerking
            gebruikt exact dezelfde runtime; human gates blijven absoluut.
          </p>
        </div>
        <button
          type="button"
          onClick={drain}
          disabled={pending}
          className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-zinc-50 transition-colors hover:bg-indigo-500 disabled:opacity-60"
        >
          {pending ? "Verwerkt..." : "Verwerk queue nu"}
        </button>
      </div>

      {error && <p className="mt-3 rounded-lg border border-red-900 bg-red-950/40 p-3 text-xs text-red-300">{error}</p>}

      {result && (
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-300">
          <p>
            {result.disabled
              ? "Runtime staat uit (AUTOMATION_RUNTIME_ENABLED=false)."
              : `Verwerkt: ${result.claimed} · voltooid: ${result.completed} · herkans: ${result.retried} · gefaald: ${result.failed} · teruggewonnen: ${result.reclaimed}`}
            {result.timeBudgetExceeded ? " · tijdbudget bereikt, rest blijft queued" : ""}
          </p>
          {result.items.length > 0 && (
            <ul className="mt-2 space-y-1 text-zinc-400">
              {result.items.map((item) => (
                <li key={item.queueItemId} className="font-mono text-[11px]">
                  {item.automationId} → {item.outcome}
                  {item.runId ? ` (run ${item.runId.slice(0, 14)}… ${item.runStatus})` : ""}
                  {item.error ? ` — ${item.error}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-400">Queue is leeg — er staat geen werk klaar.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs text-zinc-400">
                <th className="py-2 pr-3 font-medium">Item</th>
                <th className="py-2 pr-3 font-medium">Automation</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Pogingen</th>
                <th className="py-2 pr-3 font-medium">In queue sinds</th>
                <th className="py-2 font-medium">Fout</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 10).map((item) => (
                <tr key={item.id} className="border-b border-zinc-800/60 last:border-0">
                  <td className="py-2 pr-3 font-mono text-xs text-zinc-500">{item.id.slice(0, 10)}…</td>
                  <td className="py-2 pr-3 text-zinc-200">{item.automationId}</td>
                  <td className="py-2 pr-3">
                    <Badge variant={queueVariant[item.status] ?? "neutral"}>{item.status}</Badge>
                  </td>
                  <td className="py-2 pr-3 text-zinc-300">{item.attempts}</td>
                  <td className="py-2 pr-3 text-zinc-500">{new Date(item.enqueuedAt).toLocaleString("nl-NL")}</td>
                  <td className="max-w-56 truncate py-2 text-xs text-zinc-400" title={item.error ?? ""}>
                    {item.error ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {queued.length > 0 && (
            <p className="mt-2 text-xs text-zinc-500">{queued.length} item(s) wachten op verwerking.</p>
          )}
        </div>
      )}
    </div>
  );
}
