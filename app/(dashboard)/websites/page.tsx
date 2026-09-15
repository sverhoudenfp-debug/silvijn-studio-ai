import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";

const websites = [
  { client: "Beauty by Lisa", url: "beautybylisa.nl", platform: "Next.js", status: "Live", variant: "success" as const, updated: "2 weken geleden", version: "v1.2" },
  { client: "Bakker Webshop", url: "bakkerwebshop.nl", platform: "Shopify", status: "Live", variant: "success" as const, updated: "1 maand geleden", version: "v2.0" },
  { client: "Jansen Dakwerken", url: "jansendakwerken.nl", platform: "Next.js", status: "In review", variant: "warning" as const, updated: "Vandaag", version: "v0.9" },
];

export default function WebsitesPage() {
  return (
    <Card className="p-0">
      <div className="p-5 pb-0">
        <CardHeader title="Geleverde websites" subtitle="Productie-omgevingen per klant" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-5 py-3 font-medium">Klant</th>
              <th className="px-3 py-3 font-medium">URL</th>
              <th className="px-3 py-3 font-medium">Platform</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Versie</th>
              <th className="px-3 py-3 font-medium">Laatste wijziging</th>
            </tr>
          </thead>
          <tbody>
            {websites.map((site) => (
              <tr key={site.client} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                <td className="px-5 py-3 font-medium text-zinc-100">{site.client}</td>
                <td className="px-3 py-3 text-indigo-400">{site.url}</td>
                <td className="px-3 py-3 text-zinc-400">{site.platform}</td>
                <td className="px-3 py-3"><Badge variant={site.variant}>{site.status}</Badge></td>
                <td className="px-3 py-3 text-zinc-500">{site.version}</td>
                <td className="px-3 py-3 text-zinc-500">{site.updated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
