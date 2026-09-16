"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  approveOutreachDraft,
  cancelOutreachDraft,
  generateOutreachDraft,
  listOutreachDrafts,
} from "@/app/actions/outreach";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { OutreachDraft } from "@/lib/outreach/types";


/**
 * Outreach-sectie op de lead-detailpagina (Fase 6). Alles hier is CONCEPT:
 * elke draft is AI-gegenereerd en wordt nooit automatisch verzonden.
 */

const statusMeta: Record<string, { label: string; variant: "warning" | "info" | "success" | "danger" | "neutral" }> = {
  draft: { label: "Draft — kwaliteitscheck mislukt", variant: "warning" },
  ready_for_review: { label: "Klaar voor review", variant: "info" },
  approved: { label: "Goedgekeurd (nog niet verzonden)", variant: "success" },
  sent: { label: "Verzonden", variant: "neutral" },
  failed: { label: "Mislukt", variant: "danger" },
  cancelled: { label: "Geannuleerd", variant: "neutral" },
};

export function OutreachSection({
  leadId,
  leadBusinessName,
  demoUrl,
}: {
  leadId: string;
  leadBusinessName: string;
  demoUrl: string | null;
}) {
  const [drafts, setDrafts] = useState<OutreachDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    const result = await listOutreachDrafts(leadId);
    setDrafts(result);
    setLoaded(true);
  }, [leadId]);

  useEffect(() => {
    let active = true;
    listOutreachDrafts(leadId)
      .then((result) => {
        if (active) {
          setDrafts(result);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setError("Concepten konden niet worden geladen");
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [leadId]);

  function generate() {
    setError(null);
    startTransition(async () => {
      try {
        await generateOutreachDraft(leadId);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Generatie mislukt");
      }
    });
  }

  function updateStatus(draftId: string, action: "approve" | "cancel") {
    startTransition(async () => {
      try {
        await (action === "approve" ? approveOutreachDraft(draftId) : cancelOutreachDraft(draftId));
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Bijwerken mislukt");
      }
    });
  }

  const latest = drafts[0];

  return (
    <Card>
      <CardHeader
        title="Outreach"
        subtitle={latest ? `Laatste concept van ${new Date(latest.createdAt).toLocaleString("nl-NL")}` : "Nog geen concepten"}
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={generate}
            disabled={pending}
            className="inline-flex h-9 items-center rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-zinc-50 transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Concept genereren..." : "Generate Outreach Draft"}
          </button>
          {demoUrl && (
            <Link
              href={demoUrl}
              className="text-xs font-medium text-indigo-400 transition-colors hover:text-indigo-300"
              target="_blank"
            >
              Demo openen →
            </Link>
          )}
          <span className="text-xs text-zinc-500">
            AI genereert een concept — er wordt nooit automatisch iets verzonden.
          </span>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        {!loaded ? (
          <p className="text-sm text-zinc-500">Concepten laden...</p>
        ) : drafts.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Nog geen outreach-concept voor {leadBusinessName}. Genereer er één — het resultaat verschijnt als draft voor review.
          </p>
        ) : (
          drafts.map((draft) => {
            const meta = statusMeta[draft.status] ?? statusMeta.draft;
            return (
              <div key={draft.id} className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="warning">AI GENERATED DRAFT</Badge>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    <span className="text-xs text-zinc-500">
                      model: {draft.model} · {new Date(draft.createdAt).toLocaleDateString("nl-NL")}
                    </span>
                  </div>
                  <span className="text-xs font-medium text-amber-400">
                    Deze e-mail is nog NIET verzonden.
                  </span>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Onderwerp</p>
                  <p className="text-sm font-medium text-zinc-100">{draft.subject}</p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">E-mailtekst</p>
                  <p className="whitespace-pre-line text-sm text-zinc-300">{draft.body}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-zinc-500">Personalisatie</p>
                    <p className="text-sm text-zinc-300">{draft.personalizationReason}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-zinc-500">Call-to-action</p>
                    <p className="text-sm text-zinc-300">{draft.callToAction}</p>
                  </div>
                </div>

                {draft.qualityIssues.length > 0 && (
                  <div className="rounded-lg border border-red-500/40 bg-red-950/40 p-3">
                    <p className="text-xs font-semibold text-red-300">
                      Kwaliteitscheck mislukt — status blijft draft:
                    </p>
                    <ul className="mt-1 list-inside list-disc text-xs text-red-300/80">
                      {draft.qualityIssues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {draft.status === "ready_for_review" && (
                    <>
                      <button
                        type="button"
                        onClick={() => updateStatus(draft.id, "approve")}
                        disabled={pending}
                        className="h-9 rounded-lg border border-emerald-500/40 bg-emerald-950/60 px-3 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-emerald-500"
                      >
                        Goedkeuren
                      </button>
                      <button
                        type="button"
                        onClick={() => updateStatus(draft.id, "cancel")}
                        disabled={pending}
                        className="h-9 rounded-lg border border-zinc-700 px-3 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-indigo-500"
                      >
                        Annuleren
                      </button>
                    </>
                  )}
                  <Link
                    href="/outreach"
                    className="inline-flex h-8 items-center px-3 text-xs font-medium text-indigo-400 transition-colors hover:text-indigo-300"
                  >
                    Alle concepten →
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

