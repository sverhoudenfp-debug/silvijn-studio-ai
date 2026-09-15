import { Card, CardHeader } from "@/components/ui/card";
import { pipeline } from "@/lib/mock-data";

export function LeadPipeline() {
  const maxCount = Math.max(...pipeline.map((stage) => stage.count));

  return (
    <Card>
      <CardHeader title="Lead Pipeline" subtitle="Van ontdekking tot klant" />
      <div className="space-y-4">
        {pipeline.map((stage) => (
          <div key={stage.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-zinc-400">{stage.label}</span>
              <span className="font-medium text-zinc-200">{stage.count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800">
              <div
                className="h-1.5 rounded-full bg-indigo-500"
                style={{ width: `${Math.max((stage.count / maxCount) * 100, 3)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
