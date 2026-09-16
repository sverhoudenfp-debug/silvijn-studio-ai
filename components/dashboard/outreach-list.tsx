import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { OutreachDraft } from "@/lib/outreach/types";

/** Fase 12 §P — recente outreach-concepten uit de echte repository (verzenden is een latere fase). */

const statusVariants: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  draft: "info",
  ready_for_review: "warning",
  approved: "success",
  failed: "danger",
  cancelled: "neutral",
  sent: "success",
};

export function OutreachList({ drafts }: { drafts: OutreachDraft[] }) {
  const recent = [...drafts].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")).slice(0, 5);

  return (
    <Card>
      <CardHeader title="Recent Outreach" subtitle="Concepten — er worden geen echte e-mails verstuurd" />
      {recent.length === 0 ? (
        <p className="py-6 text-sm text-zinc-500">Nog geen outreach-concepten.</p>
      ) : (
        <ul className="divide-y divide-zinc-800/50">
          {recent.map((draft) => (
            <li key={draft.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-100">{draft.subject || "(geen onderwerp)"}</p>
                <p className="truncate text-xs text-zinc-500">
                  {draft.updatedAt ? new Date(draft.updatedAt).toLocaleString("nl-NL") : "—"}
                </p>
              </div>
              <Badge variant={statusVariants[draft.status] ?? "neutral"}>{draft.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
