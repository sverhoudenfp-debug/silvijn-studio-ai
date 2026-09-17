"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { approveOutreachDraft, cancelOutreachDraft } from "@/app/actions/outreach";
import { sendApprovedOutreachDraft } from "@/app/actions/gmail";
import { Badge } from "@/components/ui/badge";
import type { OutreachDraft } from "@/lib/outreach/types";

/**
 * Outreach-overzicht (/outreach, Fase 6). Alle cijfers komen uit de echte
 * draft-repository — geen nepstatistieken; SENT is daardoor per definitie 0
 * tot verzenden in een latere fase bestaat.
 */

const statusMeta: Record<string, { label: string; variant: "warning" | "info" | "success" | "neutral" }> = {
  draft: { label: "Draft (check mislukt)", variant: "warning" },
  ready_for_review: { label: "Klaar voor review", variant: "info" },
  approved: { label: "Goedgekeurd", variant: "success" },
  sent: { label: "Verzonden", variant: "neutral" },
  failed: { label: "Mislukt", variant: "warning" },
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

export function OutreachView({
  initialDrafts,
  leadNames,
  gmailReady = false,
}: {
  initialDrafts: OutreachDraft[];
  leadNames: Record<string, { name: string; hasDemo: boolean; demoUrl: string | null }>;
  gmailReady?: boolean;
}) {
  const [drafts, setDrafts] = useState(initialDrafts);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function sendDraft(draftId: string) {
    startTransition(async () => {
      setPendingId(draftId);
      try {
        await sendApprovedOutreachDraft(draftId);
        setError(null);
        // Ververs via router: sent-status + provider-bewijs komen uit de server.
        window.location.reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Verzenden mislukt");
      } finally {
        setPendingId(null);
      }
    });
  }

  function updateStatus(draftId: string, action: "approve" | "cancel") {
    startTransition(async () => {
      try {
        const updated =
          action === "approve" ? await approveOutreachDraft(draftId) : await cancelOutreachDraft(draftId);
        setDrafts((prev) => prev.map((d) => (d.id === draftId ? updated : d)));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Bijwerken mislukt");
      }
    });
  }

  const count = (status: string) => drafts.filter((d) => d.status === status).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Outreach</h2>
        <p className="mt-1 text-sm text-zinc-400">
          AI-gegenereerde concepten per lead. Concepten worden nooit automatisch verzonden; versturen is uitsluitend een expliciete eigenaarsactie via het verbonden Gmail-account.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Totaal concepten" value={drafts.length} />
        <Stat label="Draft" value={count("draft")} />
        <Stat label="Klaar voor review" value={count("ready_for_review")} />
        <Stat label="Goedgekeurd" value={count("approved")} />
        <Stat label="Verzonden" value={count("sent")} />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {drafts.length === 0 ? (
        <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-400">
          Nog geen concepten. Open een lead en genereer een outreach-draft.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/60 text-left text-xs text-zinc-400">
                <th className="px-3 py-2.5 font-medium">Lead</th>
                <th className="px-3 py-2.5 font-medium">Onderwerp</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Model</th>
                <th className="px-3 py-2.5 font-medium">Aangemaakt</th>
                <th className="px-3 py-2.5 font-medium">Acties</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => {
                const lead = leadNames[draft.leadId];
                const meta = statusMeta[draft.status] ?? statusMeta.draft;
                return (
                  <tr key={draft.id} className="border-b border-zinc-800/60 last:border-0">
                    <td className="px-3 py-2.5">
                      <Link href={`/leads/${draft.leadId}`} className="font-medium text-zinc-100 hover:text-indigo-400">
                        {lead?.name ?? draft.leadId}
                      </Link>
                      {lead?.demoUrl && (
                        <Link
                          href={lead.demoUrl}
                          target="_blank"
                          className="ml-2 text-xs text-indigo-400 hover:text-indigo-300"
                        >
                          demo ↗
                        </Link>
                      )}
                    </td>
                    <td className="max-w-64 truncate px-3 py-2.5 text-zinc-300">{draft.subject}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-zinc-500">{draft.model}</td>
                    <td className="px-3 py-2.5 text-zinc-500">
                      {new Date(draft.createdAt).toLocaleDateString("nl-NL")}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-2">
                        {draft.status === "ready_for_review" && (
                          <>
                            <button
                              type="button"
                              onClick={() => updateStatus(draft.id, "approve")}
                              disabled={pending}
                              className="h-9 rounded-lg border border-emerald-500/40 bg-emerald-950/60 px-3 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-emerald-500"
                            >
                              Goedkeuren
                            </button>
                            <button
                              type="button"
                              onClick={() => updateStatus(draft.id, "cancel")}
                              disabled={pending}
                              className="h-9 rounded-lg border border-zinc-700 px-3 text-xs font-semibold text-zinc-300 hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-indigo-500"
                            >
                              Annuleren
                            </button>
                          </>
                        )}
                        {draft.status === "approved" && (
                          gmailReady ? (
                            <button
                              type="button"
                              onClick={() => sendDraft(draft.id)}
                              disabled={pending}
                              className="h-9 rounded-lg border border-indigo-500/40 bg-indigo-950/60 px-3 text-xs font-semibold text-indigo-300 hover:bg-indigo-900/60 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-indigo-500"
                            >
                              {pendingId === draft.id ? "Versturen…" : "Versturen via Gmail"}
                            </button>
                          ) : (
                            <span className="text-xs text-zinc-500">Versturen vereist een verbonden Gmail-account (Settings)</span>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
