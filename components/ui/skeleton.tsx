import { cn } from "@/lib/utils";

/**
 * Route-skeletons (2026-10-01): direct zichtbare structuur tijdens de
 * server-render van een pagina, i.p.v. een blanco scherm. Puur decoratief —
 * aria-hidden, geen data-verzening.
 */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-lg bg-zinc-800/60", className)} />;
}

/** KPI-rij + hoofdinhoud-blokken (dashboard-achtige pagina's). */
export function PageSkeleton({ kpiCount = 4, rows = 3 }: { kpiCount?: number; rows?: number }) {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: kpiCount }).map((_, i) => (
          <Skeleton key={i} className="h-[104px]" />
        ))}
      </div>
      <div className="space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    </div>
  );
}

/** Tabel-skeleton (leads-, projects-, websites-achtige overzichten). */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    </div>
  );
}
