import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";

const stats = [
  { label: "Bedrijven ontdekt", value: "1.284", delta: "+248 deze maand" },
  { label: "Leads gekwalificeerd", value: "386", delta: "30% kwalificatie rate" },
  { label: "Demo's gegenereerd", value: "142", delta: "36% van gekwalificeerd" },
  { label: "E-mails verzonden", value: "512", delta: "+96 deze week" },
  { label: "Reply rate", value: "24%", delta: "+3% vs vorige maand" },
  { label: "Interest rate", value: "9%", delta: "+1% vs vorige maand" },
  { label: "Projecten gewonnen", value: "4", delta: "€ 4.050 omzet" },
  { label: "Gem. projectwaarde", value: "€ 1.013", delta: "Doel: € 1.200" },
];

const bestPerforming = [
  { label: "Beste branche", value: "Dakdekkers", detail: "38% reply rate" },
  { label: "Beste locatie", value: "Eindhoven", detail: "31 leads, 4 geïnteresseerd" },
  { label: "Beste e-mail", value: "Jansen Dakwerken", detail: "Antwoord binnen 12 minuten" },
  { label: "Gem. lead score", value: "72/100", detail: "+5 vs vorige maand" },
];

export default function AnalyticsPage() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} kpi={stat} />
        ))}
      </div>

      <Card>
        <CardHeader title="Best presterend" subtitle="AI-prestaties over de laatste 30 dagen" />
        <div className="grid gap-4 md:grid-cols-2">
          {bestPerforming.map((item) => (
            <div key={item.label} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="text-xs text-zinc-500">{item.label}</p>
              <p className="mt-1 text-sm font-semibold text-zinc-100">{item.value}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{item.detail}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
