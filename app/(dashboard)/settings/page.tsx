import { requireStudioOwner } from "@/lib/auth/server";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { gmailIngestStatus } from "@/lib/gmail/ingest";
import { GmailSettingsCard } from "@/components/settings/gmail-settings-card";
import { EnvironmentStatusCard } from "@/components/settings/environment-status-card";
import { loadEnvironmentStatus } from "@/lib/config/environment-status";
import { ReplyHandlingCard } from "@/components/settings/reply-handling-card";
import { getReplyHandlingMode, REPLY_HANDLING_LABELS } from "@/lib/settings/studio-settings";

const sections = [
  { title: "Studio gegevens", description: "Bedrijfsnaam, e-mailadres, handtekening voor outreach" },
  { title: "E-mail instellingen", description: "Afzender, provider-API, dagelijkse limieten, opt-out" },
  { title: "AI instellingen", description: "Model, tone of voice, prompts per agent" },
  { title: "Lead scoring", description: "Weging van reviews, locatie, branche en contactgegevens" },
  { title: "Prijsregels", description: "Basisprijs per pagina, functies, SEO en onderhoud — configureerbaar" },
  { title: "Website generatie", description: "Standaard stijlen, platforms (Next.js / Shopify), templates" },
  { title: "Security & AVG", description: "Gegevensbewaring, logging, toestemmingen" },
];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail_error?: string; gmail_connected?: string; authorized?: string; required?: string; send_as_status?: string }>;
}) {
  await requireStudioOwner();
  const [params, gmail, environment, replyMode] = await Promise.all([searchParams, gmailIngestStatus(), loadEnvironmentStatus(), getReplyHandlingMode()]);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Settings</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Configuratie van de studio — secties worden fase voor fase geactiveerd.
        </p>
      </div>
      <GmailSettingsCard gmail={gmail} flash={{ error: params.gmail_error ?? null, connected: params.gmail_connected ?? null, authorized: params.authorized ?? null, required: params.required ?? null, sendAsStatus: params.send_as_status ?? null }} />
      <ReplyHandlingCard mode={replyMode} options={REPLY_HANDLING_LABELS} />
      <EnvironmentStatusCard checks={environment.checks} unavailable={environment.unavailable} />
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
    </div>
  );
}
