import { cn } from "@/lib/utils";

/**
 * Server-rendered SVG-grafieken (2026-10-01): geen client-JS, geen chart-
 * bibliotheek, direct zichtbaar met de pagina. Rustig kleurgebruik:
 * primair indigo, secundair zink, geen gradients.
 */

export interface ChartSeries {
  label: string;
  values: number[];
  tone: "primary" | "muted";
}

export function BarChart({
  title,
  description,
  bucketLabels,
  series,
  formatValue = (v) => String(v),
  height = 160,
}: {
  title: string;
  description?: string;
  bucketLabels: string[];
  series: ChartSeries[];
  formatValue?: (value: number) => string;
  height?: number;
}) {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const hasData = series.some((s) => s.values.some((v) => v > 0));

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-zinc-100">{title}</p>
        <div className="flex items-center gap-3">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5 text-xs text-zinc-400">
              <span className={cn("h-2 w-2 rounded-[3px]", s.tone === "primary" ? "bg-indigo-400" : "bg-zinc-600")} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      {description ? <p className="mt-1 text-xs text-zinc-500">{description}</p> : null}

      {!hasData ? (
        <div className="flex h-[120px] items-center justify-center">
          <p className="text-xs text-zinc-500">Nog geen data in deze periode.</p>
        </div>
      ) : (
        <div className="mt-4 flex" style={{ height }}>
          {bucketLabels.map((label, i) => {
            const group = series.map((s) => s.values[i] ?? 0);
            const groupHasData = group.some((v) => v > 0);
            return (
              <div key={label + i} className="group relative flex min-w-0 flex-1 flex-col justify-end px-[3px]">
                <div className="flex h-full items-end justify-center gap-[3px]">
                  {series.map((s) => {
                    const value = s.values[i] ?? 0;
                    const pct = Math.round((value / max) * 100);
                    return (
                      <div
                        key={s.label}
                        className={cn(
                          "min-h-[2px] w-full max-w-[14px] rounded-t-[3px] transition-opacity",
                          s.tone === "primary" ? "bg-indigo-400" : "bg-zinc-600",
                          "group-hover:opacity-80",
                        )}
                        style={{ height: `${value > 0 ? Math.max(pct, 3) : 0}%` }}
                      />
                    );
                  })}
                </div>
                {groupHasData ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-full mb-1 hidden justify-center group-hover:flex">
                    <span className="whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200">
                      {label}
                      {series.map((s) => (
                        <span key={s.label} className="ml-1.5">
                          {formatValue(s.values[i] ?? 0)}
                        </span>
                      ))}
                    </span>
                  </div>
                ) : null}
                <p className="mt-2 truncate text-center text-[10px] text-zinc-500">{label}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function FunnelChart({ rows, formatValue = (v) => String(v) }: { rows: { stage: string; count: number; share: number | null }[]; formatValue?: (value: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.stage}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm text-zinc-300">{row.stage}</p>
            <p className="text-sm">
              <span className="font-semibold text-zinc-100">{formatValue(row.count)}</span>
              {row.share !== null ? <span className="ml-1.5 text-xs text-zinc-500">{row.share}%</span> : null}
            </p>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-indigo-400/80"
              style={{ width: `${row.count > 0 ? Math.max((row.count / max) * 100, 2) : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
