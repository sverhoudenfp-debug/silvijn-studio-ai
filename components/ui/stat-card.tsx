import { cn } from "@/lib/utils";
import type { Kpi } from "@/lib/types";

/**
 * Fase 13: delta is optioneel (geen leeg element met marge) en
 * visueel neutraal-informatief i.p.v. hardcoded groen; de kleur
 * kan per KPI worden meegegeven (bijv. "success"/"warning").
 */
export function StatCard({
  kpi,
  deltaTone = "info",
}: {
  kpi: Kpi;
  deltaTone?: "info" | "success" | "warning";
}) {
  const deltaClasses = {
    info: "text-indigo-300",
    success: "text-emerald-400",
    warning: "text-amber-400",
  } as const;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 transition-colors hover:border-zinc-700">
      <p className="text-xs font-medium text-zinc-400">{kpi.label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">{kpi.value}</p>
      {kpi.delta ? (
        <p className={cn("mt-1 text-xs", deltaClasses[deltaTone])}>{kpi.delta}</p>
      ) : null}
    </div>
  );
}
