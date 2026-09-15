import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { leadStatusMeta, leads, websiteStatusMeta } from "@/lib/mock-data";
import { scoreVariant } from "@/lib/utils";

export function OpportunityList() {
  const top = [...leads].sort((a, b) => b.leadScore - a.leadScore).slice(0, 5);

  return (
    <Card>
      <CardHeader
        title="Top Opportunities"
        subtitle="Best scorende leads op dit moment"
        action={
          <Link href="/leads" className="text-xs font-medium text-indigo-400 hover:text-indigo-300">
            Alle leads →
          </Link>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <th className="pb-2 pr-4 font-medium">Business</th>
              <th className="pb-2 pr-4 font-medium">Location</th>
              <th className="pb-2 pr-4 font-medium">Lead Score</th>
              <th className="pb-2 pr-4 font-medium">Website</th>
              <th className="pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {top.map((lead) => (
              <tr key={lead.id} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                <td className="py-2.5 pr-4">
                  <Link href={`/leads/${lead.id}`} className="font-medium text-zinc-100 hover:text-indigo-300">
                    {lead.businessName}
                  </Link>
                </td>
                <td className="py-2.5 pr-4 text-zinc-400">{lead.city}</td>
                <td className="py-2.5 pr-4">
                  <Badge variant={scoreVariant(lead.leadScore)}>{lead.leadScore}</Badge>
                </td>
                <td className="py-2.5 pr-4 text-zinc-500">
                  {websiteStatusMeta[lead.websiteStatus].label}
                </td>
                <td className="py-2.5">
                  <Badge variant={leadStatusMeta[lead.leadStatus].variant}>
                    {leadStatusMeta[lead.leadStatus].label}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
