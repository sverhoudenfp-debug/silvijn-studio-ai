import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { Automation } from "@/lib/automation/types";

/** Fase 12 §P — echte automations uit de database. */

const statusVariants: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  active: "success",
  paused: "warning",
  disabled: "neutral",
  draft: "info",
  completed: "success",
  failed: "danger",
};

export function AutomationStatus({ automations }: { automations: Automation[] }) {
  return (
    <Card>
      <CardHeader title="Automation Status" subtitle="Actuele automations — geen scheduler actief" />
      {automations.length === 0 ? (
        <EmptyState title="Nog geen automations gedefinieerd" className="border-0 bg-transparent py-4" />
      ) : (
        <ul className="space-y-3">
          {automations.map((automation) => (
            <li key={automation.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-zinc-300">{automation.name}</span>
              <Badge variant={statusVariants[automation.status] ?? "neutral"}>{automation.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
