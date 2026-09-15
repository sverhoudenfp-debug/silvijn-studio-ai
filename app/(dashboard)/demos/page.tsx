import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { leads } from "@/lib/mock-data";
import { scoreVariant } from "@/lib/utils";

export default function DemosPage() {
  const demos = leads.filter((lead) => lead.hasDemo);

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {demos.map((lead) => (
        <Card key={lead.id} className="group transition-colors hover:border-indigo-500/50">
          <div className="mb-4 flex h-32 items-center justify-center rounded-lg bg-gradient-to-br from-zinc-800 to-zinc-900 text-sm text-zinc-500">
            /demo/{lead.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-100">{lead.name}</p>
              <p className="text-xs text-zinc-500">{lead.location}</p>
            </div>
            <Badge variant={scoreVariant(lead.leadScore)}>{lead.leadScore}</Badge>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <Badge variant="info">Klaar</Badge>
            <span className="cursor-pointer text-xs font-medium text-indigo-400 group-hover:text-indigo-300">
              Preview →
            </span>
          </div>
        </Card>
      ))}
    </div>
  );
}
