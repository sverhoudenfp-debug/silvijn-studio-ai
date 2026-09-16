"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { SalesInteraction } from "@/lib/sales/types";

/**
 * Sales-overzicht (/sales, Fase 7) — echte repository-data, geen nepstatistieken.
 */

const intentLabels: Record<string, string> = {
  interested: "Geïnteresseerd", question: "Vraag", price_request: "Prijsaanvraag",
  demo_request: "Demo-aanvraag", call_request: "Belverzoek", more_information: "Meer info",
  not_interested: "Niet geïnteresseerd", objection: "Bezwaar", not_now: "Nu niet",
  wrong_contact: "Verkeerd contact", opt_out: "Afmelding", unclear: "Onduidelijk",
};

const statusMeta: Record<string, { label: string; variant: "warning" | "info" | "success" | "neutral" }> = {
  draft: { label: "Concept", variant: "info" },
  ready_for_silvijn: { label: "READY FOR SILVIJN", variant: "warning" },
  handled: { label: "Afgehandeld", variant: "success" },
  cancelled: { label: "Geannuleerd", variant: "neutral" },
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-50">{value}</p>
    </div>
  );
}

export function SalesView({
  interactions,
  leadNames,
}: {
  interactions: SalesInteraction[];
  leadNames: Record<string, string>;
}) {
  const count = (fn: (i: SalesInteraction) => boolean) => interactions.filter(fn).length;
  const highInterest = count((i) => ["medium", "high"].includes(i.qualification.interestLevel));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">AI Sales</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Inkomende reacties geanalyseerd door de sales-agent. Concepten en kwalificaties — niets wordt automatisch verzonden.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Interessant (medium/hoog)" value={highInterest} />
        <Stat label="Kwalificatie: qualifying" value={count((i) => i.qualification.status === "qualifying")} />
        <Stat label="Kwalificatie: qualified" value={count((i) => i.qualification.status === "qualified")} />
        <Stat label="Ready for Silvijn" value={count((i) => i.status === "ready_for_silvijn")} />
        <Stat label="Onduidelijk" value={count((i) => i.intent === "unclear")} />
      </div>

      {interactions.length === 0 ? (
        <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-400">
          Nog geen sales-interacties. Open een lead, registreer een inkomende reactie en laat de AI deze analyseren.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/60 text-left text-xs text-zinc-400">
                <th className="px-3 py-2.5 font-medium">Lead</th>
                <th className="px-3 py-2.5 font-medium">Intent</th>
                <th className="px-3 py-2.5 font-medium">Kwalificatie</th>
                <th className="px-3 py-2.5 font-medium">Interesse</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Datum</th>
              </tr>
            </thead>
            <tbody>
              {interactions.map((interaction) => (
                <tr key={interaction.id} className="border-b border-zinc-800/60 last:border-0">
                  <td className="px-3 py-2.5">
                    <Link href={`/leads/${interaction.leadId}`} className="font-medium text-zinc-100 hover:text-indigo-400">
                      {leadNames[interaction.leadId] ?? interaction.leadId}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-zinc-300">{intentLabels[interaction.intent] ?? interaction.intent}</td>
                  <td className="px-3 py-2.5 text-zinc-300">{interaction.qualification.status}</td>
                  <td className="px-3 py-2.5 text-zinc-300">{interaction.qualification.interestLevel}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant={statusMeta[interaction.status]?.variant ?? "neutral"}>
                      {statusMeta[interaction.status]?.label ?? interaction.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-zinc-500">
                    {new Date(interaction.createdAt).toLocaleDateString("nl-NL")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
