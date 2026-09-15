import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { demoStatusMeta, leads } from "@/lib/mock-data";
import { scoreVariant, slugify } from "@/lib/utils";

export default function DemoWebsitesPage() {
  const demos = leads.filter((lead) => lead.demoStatus !== "not_created");

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {demos.map((lead) => {
        const ready = lead.demoStatus === "ready";
        const content = (
          <Card className="h-full transition-colors hover:border-indigo-500/50">
            <div className="mb-4 flex h-32 items-center justify-center rounded-lg bg-gradient-to-br from-zinc-800 to-zinc-950 text-sm text-zinc-500">
              /demo/{slugify(lead.businessName)}
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-100">{lead.businessName}</p>
                <p className="text-xs text-zinc-500">{lead.city}</p>
              </div>
              <Badge variant={scoreVariant(lead.leadScore)}>{lead.leadScore}</Badge>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <Badge variant={demoStatusMeta[lead.demoStatus].variant}>
                {demoStatusMeta[lead.demoStatus].label}
              </Badge>
              {ready ? (
                <span className="text-xs font-medium text-indigo-400 group-hover:text-indigo-300">
                  Preview →
                </span>
              ) : null}
            </div>
          </Card>
        );

        return ready ? (
          <Link key={lead.id} href={`/demo/${slugify(lead.businessName)}`} className="group">
            {content}
          </Link>
        ) : (
          <div key={lead.id} title="Demo nog niet gereed">{content}</div>
        );
      })}
    </div>
  );
}
