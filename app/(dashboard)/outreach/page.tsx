import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";

const stats = [
  { label: "E-mails verzonden", value: "96", delta: "+12 vandaag" },
  { label: "Geopend", value: "61", delta: "64% open rate" },
  { label: "Antwoorden", value: "23", delta: "24% reply rate" },
  { label: "Niet geïnteresseerd", value: "7", delta: "3 nieuwe" },
];

const emails = [
  { lead: "Jansen Dakwerken", time: "20:36", status: "Beantwoord", variant: "success" as const, subject: "Voorbeeldwebsite voor Jansen Dakwerken" },
  { lead: "Kapsalon Mirage", time: "19:12", status: "Verzonden", variant: "info" as const, subject: "Meer online zichtbaarheid voor Kapsalon Mirage" },
  { lead: "Elektro Vries", time: "18:48", status: "Geopend", variant: "neutral" as const, subject: "Een website voor Elektro Vries — vrijblijvende demo" },
  { lead: "Groen & Co Hoveniers", time: "17:30", status: "Beantwoord", variant: "success" as const, subject: "Voorbeeldwebsite voor Groen & Co Hoveniers" },
  { lead: "Garage Veldhuis", time: "16:02", status: "In wachtrij", variant: "warning" as const, subject: "Automatisch gegenereerd — wacht op verzending" },
];

export default function OutreachPage() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} kpi={stat} />
        ))}
      </div>

      <Card className="p-0">
        <div className="p-5 pb-0">
          <CardHeader title="Recente outreach" subtitle="AI-gegenereerde e-mails per lead" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-5 py-3 font-medium">Lead</th>
                <th className="px-3 py-3 font-medium">Onderwerp</th>
                <th className="px-3 py-3 font-medium">Verzonden</th>
                <th className="px-3 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((email) => (
                <tr key={email.lead} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                  <td className="px-5 py-3 font-medium text-zinc-100">{email.lead}</td>
                  <td className="px-3 py-3 text-zinc-400">{email.subject}</td>
                  <td className="px-3 py-3 text-zinc-500">{email.time}</td>
                  <td className="px-3 py-3">
                    <Badge variant={email.variant}>{email.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
