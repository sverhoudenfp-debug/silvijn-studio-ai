import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { EnvironmentCheck, EnvironmentCheckLevel } from "@/lib/config/environment-status";

/** G8: omgevingscontrole — toont uitsluitend aanwezigheid en waargenomen gedrag, nooit waarden. */

const LEVEL: Record<EnvironmentCheckLevel, { label: string; variant: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  ok: { label: "OK", variant: "success" },
  warning: { label: "Let op", variant: "warning" },
  missing: { label: "Ontbreekt", variant: "danger" },
  info: { label: "Info", variant: "neutral" },
};

export function EnvironmentStatusCard({ checks, unavailable }: { checks: EnvironmentCheck[]; unavailable: string[] }) {
  const problems = checks.filter((c) => c.level === "missing" || c.level === "warning").length;
  return (
    <Card>
      <CardHeader
        title="Omgevingscontrole"
        subtitle={problems === 0 ? "Alle productie-instellingen aanwezig; waarden worden nooit getoond" : `${problems} punt${problems === 1 ? "" : "en"} vragen aandacht; waarden worden nooit getoond`}
      />
      {unavailable.length > 0 && (
        <p className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Niet geladen: {unavailable.join(", ")}. Het bewijs uit waargenomen gedrag is daardoor onvolledig.
        </p>
      )}
      <ul className="divide-y divide-zinc-800/50">
        {checks.map((check) => (
          <li key={check.key} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-100">{check.label}</p>
              <p className="text-xs text-zinc-400">{check.detail}</p>
              {check.evidence && <p className="mt-0.5 text-xs text-zinc-500">{check.evidence}</p>}
            </div>
            <Badge variant={LEVEL[check.level].variant}>{LEVEL[check.level].label}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
