import { Card, CardHeader } from "@/components/ui/card";
import type { LeadStatus } from "@/lib/types";

type StatusCounts = Record<LeadStatus, number>;

/** Fase 12 §P — pipeline met echte lead-status tellingen. */

const stageLabels: { key: LeadStatus; label: string }[] = [
  { key: "new", label: "Nieuw" },
  { key: "analyzing", label: "In analyse" },
  { key: "qualified", label: "Gekwalificeerd" },
  { key: "contacted", label: "Gecontacteerd" },
  { key: "interested", label: "Geïnteresseerd" },
  { key: "won", label: "Gewonnen" },
];

export function LeadPipeline({ byStatus }: { byStatus: StatusCounts }) {
  const maxCount = Math.max(...stageLabels.map((s) => byStatus[s.key] ?? 0), 1);

  return (
    <Card>
      <CardHeader title="Lead Pipeline" subtitle="Van ontdekking tot klant" />
      <div className="space-y-4">
        {stageLabels.map((stage) => (
          <div key={stage.key}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-zinc-400">{stage.label}</span>
              <span className="font-medium text-zinc-200">{byStatus[stage.key] ?? 0}</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800">
              <div
                className="h-1.5 rounded-full bg-indigo-500"
                style={{ width: `${Math.max(((byStatus[stage.key] ?? 0) / maxCount) * 100, 3)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
