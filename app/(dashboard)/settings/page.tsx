import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const sections = [
  { title: "Studio gegevens", description: "Bedrijfsnaam, e-mailadres, handtekening voor outreach" },
  { title: "E-mail instellingen", description: "Afzender, provider-API, dagelijkse limieten, opt-out" },
  { title: "AI instellingen", description: "Model, tone of voice, prompts per agent" },
  { title: "Lead scoring", description: "Weging van reviews, locatie, branche en contactgegevens" },
  { title: "Prijsregels", description: "Basisprijs per pagina, functies, SEO en onderhoud — configureerbaar" },
  { title: "Website generatie", description: "Standaard stijlen, platforms (Next.js / Shopify), templates" },
  { title: "API integraties", description: "Google Maps, Supabase, e-mailprovider — via environment variables" },
  { title: "Security & AVG", description: "Gegevensbewaring, logging, toestemmingen" },
];

export default function SettingsPage() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {sections.map((section) => (
        <Card key={section.title} className="cursor-pointer transition-colors hover:border-zinc-700">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-100">{section.title}</p>
              <p className="mt-1 text-xs text-zinc-500">{section.description}</p>
            </div>
            <Badge variant="neutral">Binnenkort</Badge>
          </div>
        </Card>
      ))}
    </div>
  );
}
