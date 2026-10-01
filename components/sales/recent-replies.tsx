import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { messagePreview } from "@/lib/sales/message-clean";
import type { InboundMessage, SalesInteraction } from "@/lib/sales/types";

/**
 * Recente klantreacties (AI Sales) — de reacties zelf centraal, niet
 * alleen statistieken. Per reactie: bedrijf, laatste bericht, interesse,
 * kwalificatie, status en of er een antwoordconcept klaarstaat. Klik
 * opent de volledige conversation/thread.
 */

const intentLabels: Record<string, string> = {
  interested: "Geïnteresseerd", question: "Vraag", price_request: "Prijsaanvraag",
  demo_request: "Demo-aanvraag", call_request: "Belverzoek", more_information: "Meer info",
  not_interested: "Niet geïnteresseerd", objection: "Bezwaar", not_now: "Nu niet",
  wrong_contact: "Verkeerd contact", opt_out: "Afmelding", unclear: "Onduidelijk",
};

const statusMeta: Record<string, { label: string; variant: "warning" | "info" | "success" | "neutral" }> = {
  draft: { label: "REVIEW", variant: "info" },
  ready_for_silvijn: { label: "READY_FOR_SILVIJN", variant: "warning" },
  handled: { label: "Afgehandeld", variant: "success" },
  cancelled: { label: "Geannuleerd", variant: "neutral" },
};

export function RecentReplies({
  inbounds,
  interactions,
  leadNames,
  conversationsByLead,
}: {
  inbounds: InboundMessage[];
  interactions: SalesInteraction[];
  leadNames: Record<string, string>;
  conversationsByLead: Record<string, string>;
}) {
  const byInbound = new Map(interactions.map((i) => [i.inboundMessageId, i]));
  const recent = [...inbounds].filter((m) => m.replyConfirmed).sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1)).slice(0, 8);
  if (recent.length === 0) {
    return (
      <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-400">
        Nog geen klantreacties. Zodra een prospect antwoordt op jouw outreach verschijnt de reactie hier automatisch.
      </p>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {recent.map((message) => {
        const interaction = byInbound.get(message.id);
        const conversationId = message.conversationId ?? conversationsByLead[message.leadId];
        const badge = interaction ? (statusMeta[interaction.status] ?? { label: interaction.status, variant: "neutral" as const }) : { label: "NIEUW", variant: "warning" as const };
        return (
          <div key={message.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-semibold text-zinc-100">{leadNames[message.leadId] ?? "Lead"}</p>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{messagePreview(message.body)}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
              <span>Interesse: <span className="text-zinc-200">{interaction?.qualification.interestLevel ?? "—"}</span></span>
              <span>Kwalificatie: <span className="text-zinc-200">{interaction?.qualification.status ?? "—"}</span></span>
              {interaction && <span>Intent: <span className="text-zinc-200">{intentLabels[interaction.intent] ?? interaction.intent}</span></span>}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-xs text-zinc-500">{interaction?.responseDraft ? "Concept beschikbaar" : "Nog geen concept"}</p>
              {conversationId ? (
                <Link className="text-xs text-indigo-300 hover:text-indigo-200" href={`/conversations?id=${conversationId}`}>Open gesprek →</Link>
              ) : (
                <Link className="text-xs text-indigo-300 hover:text-indigo-200" href={`/leads/${message.leadId}`}>Open lead →</Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
