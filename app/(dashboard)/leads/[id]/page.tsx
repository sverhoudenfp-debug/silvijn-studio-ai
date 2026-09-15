import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { scoreLead } from "@/lib/agents/lead-scoring";
import { leadStatusMeta, leads } from "@/lib/mock-data";
import { scoreVariant, slugify } from "@/lib/utils";

export default async function LeadDetailPage(props: PageProps<"/leads/[id]">) {
  const { id } = await props.params;
  const lead = leads.find((item) => item.id === id);
  if (!lead) notFound();

  const status = leadStatusMeta[lead.status];
  const { score, reason, factors } = scoreLead(lead);

  const info: Array<[string, string]> = [
    ["Branche", lead.category],
    ["Locatie", lead.location],
    ["Website", lead.website ?? "Geen website gevonden"],
    ["Telefoon", lead.phone ?? "Niet beschikbaar"],
    ["E-mail", lead.email ?? "Niet beschikbaar"],
    ["Reviews", lead.rating ? `${lead.rating.toFixed(1)} sterren (${lead.reviewCount ?? 0} reviews)` : "Onbekend"],
    ["Laatste activiteit", lead.lastActivity],
  ];

  return (
    <div className="space-y-6">
      <Link href="/leads" className="text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200">
        ← Alle leads
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">{lead.name}</h2>
            <Badge variant={scoreVariant(score)}>{score}/100</Badge>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            {lead.category} · {lead.location}
          </p>
        </div>
        {lead.hasDemo ? (
          <Link
            href={`/demo/${slugify(lead.name)}`}
            className="inline-flex h-9 items-center rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-indigo-500"
          >
            Bekijk demo website →
          </Link>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="AI-analyse" subtitle="Lead Scoring Agent" />
          <p className="text-sm leading-relaxed text-zinc-300">{reason}</p>
          <div className="mt-6 space-y-4">
            {factors.map((factor) => (
              <div key={factor.label}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-zinc-400">{factor.label}</span>
                  <span className="text-zinc-300">
                    {Math.round(factor.earned)}/{factor.max}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-800">
                  <div
                    className="h-1.5 rounded-full bg-indigo-500"
                    style={{ width: `${Math.max((factor.earned / factor.max) * 100, 2)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs text-zinc-500">
            Scoreweging is configureerbaar via de settings (ScoringWeights) — geen hardcoded logica.
          </p>
        </Card>

        <Card>
          <CardHeader title="Bedrijfsgegevens" />
          <dl className="space-y-3">
            {info.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4 text-sm">
                <dt className="shrink-0 text-zinc-500">{label}</dt>
                <dd className="text-right text-zinc-200">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
