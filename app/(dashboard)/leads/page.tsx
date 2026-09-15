import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { leadStatusMeta, leads } from "@/lib/mock-data";
import { scoreVariant } from "@/lib/utils";

export default function LeadsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {["Alle scores", "Dakdekkers", "Loodgieters", "Kappers", "Alle locaties", "Geen website", "Met contact"].map(
          (label) => (
            <button
              key={label}
              type="button"
              className="h-8 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
            >
              {label}
            </button>
          )
        )}
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-5 py-3 font-medium">Bedrijf</th>
                <th className="px-3 py-3 font-medium">Branche</th>
                <th className="px-3 py-3 font-medium">Locatie</th>
                <th className="px-3 py-3 font-medium">Website</th>
                <th className="px-3 py-3 font-medium">Score</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Contact</th>
                <th className="px-3 py-3 font-medium">Demo</th>
                <th className="px-3 py-3 font-medium">Laatste activiteit</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                  <td className="px-5 py-3 font-medium text-zinc-100">{lead.name}</td>
                  <td className="px-3 py-3 text-zinc-400">{lead.category}</td>
                  <td className="px-3 py-3 text-zinc-400">{lead.location}</td>
                  <td className="px-3 py-3 text-zinc-500">{lead.website ? lead.website : "—"}</td>
                  <td className="px-3 py-3">
                    <Badge variant={scoreVariant(lead.leadScore)}>{lead.leadScore}</Badge>
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant={leadStatusMeta[lead.status].variant}>
                      {leadStatusMeta[lead.status].label}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-zinc-400">{lead.email ?? lead.phone ?? "—"}</td>
                  <td className="px-3 py-3">
                    {lead.hasDemo ? (
                      <span className="text-xs font-medium text-indigo-400">Beschikbaar</span>
                    ) : (
                      <span className="text-xs text-zinc-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-zinc-500">{lead.lastActivity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
