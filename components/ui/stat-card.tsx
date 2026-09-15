import type { Kpi } from "@/lib/types";

export function StatCard({ kpi }: { kpi: Kpi }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 transition-colors hover:border-zinc-700">
      <p className="text-xs font-medium text-zinc-400">{kpi.label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">{kpi.value}</p>
      <p className="mt-1 text-xs text-emerald-400">{kpi.delta}</p>
    </div>
  );
}
