import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { automationModules } from "@/lib/mock-data";

export function AutomationStatus() {
  return (
    <Card>
      <CardHeader
        title="Automation Status"
        subtitle="Fase 1 — uitsluitend UI, geen echte automations"
      />
      <ul className="space-y-3">
        {automationModules.map((module) => (
          <li key={module.name} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-zinc-300">{module.name}</span>
            <Badge variant={module.variant}>{module.status}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
