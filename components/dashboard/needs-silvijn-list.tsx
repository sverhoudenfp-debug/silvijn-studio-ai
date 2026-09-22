import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { NeedsSilvijnItem, NeedsSilvijnKind } from "@/lib/dashboard/needs-silvijn";

/** G7: "Wacht op jou" — alle openstaande menselijke beslissingen op één plek (read-only). */

const KIND_LABEL: Record<NeedsSilvijnKind, string> = {
  website_review: "Website",
  price_approval: "Prijs",
  payment_confirmation: "Betaling",
  escalated_conversation: "Escalatie",
  conversation_review: "Antwoord",
  inbound_unprocessed: "Inbox",
  outreach_review: "Outreach",
  questionnaire_attention: "Vragenlijst",
};

const KIND_VARIANT: Record<NeedsSilvijnKind, "success" | "warning" | "danger" | "neutral" | "info"> = {
  website_review: "success",
  price_approval: "warning",
  payment_confirmation: "warning",
  escalated_conversation: "danger",
  conversation_review: "info",
  inbound_unprocessed: "danger",
  outreach_review: "info",
  questionnaire_attention: "warning",
};

function formatSince(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

export function NeedsSilvijnList({ items, unavailable }: { items: NeedsSilvijnItem[]; unavailable: string[] }) {
  return (
    <Card>
      <CardHeader
        title="Wacht op jou"
        subtitle={items.length === 0 ? "Geen openstaande beslissingen" : `${items.length} beslissing${items.length === 1 ? "" : "en"} — niets gebeurt zonder jouw klik`}
      />
      {unavailable.length > 0 && (
        <p className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Niet geladen: {unavailable.join(", ")}. Deze bronnen kunnen openstaande items bevatten.
        </p>
      )}
      {items.length === 0 ? (
        <EmptyState title="Alles is afgehandeld" description="Nieuwe beslispunten verschijnen hier automatisch." className="border-0 bg-transparent py-6" />
      ) : (
        <ul className="divide-y divide-zinc-800/50">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="flex items-start justify-between gap-3 py-2.5 transition-colors hover:bg-zinc-900/40">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-100">{item.title}</p>
                  <p className="truncate text-xs text-zinc-500">{item.detail}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.since && <span className="text-xs text-zinc-500">{formatSince(item.since)}</span>}
                  <Badge variant={KIND_VARIANT[item.kind]}>{KIND_LABEL[item.kind]}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
