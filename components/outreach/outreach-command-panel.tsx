"use client";

import { useState, useTransition } from "react";
import {
  startOutreachCampaignAction,
  processDueFollowupsAction,
  getDueFollowupsAction,
} from "@/app/actions/outreach";
import { Badge } from "@/components/ui/badge";
import type { OutreachCommandRecord } from "@/lib/outreach/command-types";

/**
 * Outreach-orchestratie-paneel (Fase E) — outreach start uitsluitend via
 * deze expliciete owner-opdracht. Geen nepknoppen: alles komt uit de echte
 * command-records en repository's.
 *
 *   review-modus: AI maakt concepten; menselijke review blijft bestaan.
 *   auto-modus:    AI selecteert, genereert en verzendt binnen de opdracht.
 */

type Mode = "review" | "auto";

interface RunResult {
  ok: boolean;
  detail: string;
  errors: string[];
}

export function OutreachCommandPanel({
  commands,
  dueFollowups,
}: {
  commands: OutreachCommandRecord[];
  dueFollowups: { leadId: string; businessName: string; sentFollowups: number }[];
}) {
  const [mode, setMode] = useState<Mode>("review");
  const [limit, setLimit] = useState(10);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runCampaign() {
    startTransition(async () => {
      setError(null);
      try {
        const r = await startOutreachCampaignAction({ mode, limit });
        setResult({
          ok: true,
          detail: `${r.sent} verzonden, ${r.draftsCreated} concepten klaar voor review`,
          errors: r.errors,
        });
        window.location.reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Opdracht mislukt");
      }
    });
  }

  function runFollowups(followupMode: Mode) {
    startTransition(async () => {
      setError(null);
      try {
        const r = await processDueFollowupsAction({ mode: followupMode });
        setResult({
          ok: true,
          detail:
            followupMode === "auto"
              ? `${r.sentFollowups} follow-up(s) verzonden van ${r.dueCount} due`
              : `${r.dueCount} follow-upconcepten klaar voor review`,
          errors: r.errors,
        });
        window.location.reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Follow-upronde mislukt");
      }
    });
  }

  function refreshDue() {
    startTransition(async () => {
      setError(null);
      try {
        const due = await getDueFollowupsAction();
        setResult({ ok: true, detail: `${due.length} lead(s) due voor een follow-up (max 2 per lead)`, errors: [] });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Status ophalen mislukt");
      }
    });
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-100">Outreach-opdracht</h2>
        <Badge variant="neutral">Fase E</Badge>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Outreach start uitsluitend op deze expliciete opdracht. Review = concepten voor menselijke
        controle; Auto = selecteren, genereren en verzenden binnen de opdracht (begrensd).
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-zinc-400">
          Modus
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            className="mt-1 block rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="review">Review (concepten)</option>
            <option value="auto">Auto (verzenden binnen opdracht)</option>
          </select>
        </label>
        <label className="text-xs text-zinc-400">
          Limiet
          <input
            type="number"
            min={1}
            max={25}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="mt-1 block w-24 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <button
          type="button"
          onClick={runCampaign}
          disabled={pending}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
        >
          {pending ? "Bezig…" : "Start outreach"}
        </button>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-zinc-400">
            Vervolgfollow-ups: <span className="text-zinc-100">{dueFollowups.length}</span> due (max 2 per lead,
            stop direct bij reactie of afmelding)
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={refreshDue}
              disabled={pending}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              Verversen
            </button>
            <button
              type="button"
              onClick={() => runFollowups("auto")}
              disabled={pending || dueFollowups.length === 0}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              Follow-ups auto-verzenden
            </button>
            <button
              type="button"
              onClick={() => runFollowups("review")}
              disabled={pending || dueFollowups.length === 0}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              Follow-upconcepten
            </button>
          </div>
        </div>
        {dueFollowups.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-zinc-400">
            {dueFollowups.slice(0, 5).map((d) => (
              <li key={d.leadId}>
                {d.businessName} — follow-up {d.sentFollowups + 1}/2
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      {result && !error && (
        <div className="mt-3 text-xs text-zinc-300">
          <p>{result.detail}</p>
          {result.errors.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-red-400">
              {result.errors.slice(0, 3).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {commands.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-medium text-zinc-300">Opdrachtgeschiedenis</h3>
          <ul className="mt-2 space-y-2">
            {commands.slice(0, 5).map((c) => (
              <li key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-zinc-200">{c.command}</span>
                  <Badge variant={c.status === "completed" ? "success" : c.status === "failed" ? "danger" : "warning"}>
                    {c.status}
                  </Badge>
                </div>
                <p className="mt-1 text-zinc-500">
                  {c.mode === "auto" ? "auto" : "review"} · {c.selectedLeads ?? 0} geselecteerd ·{" "}
                  {c.draftsCreated ?? 0} concepten · {c.sent ?? 0} verzonden
                  {c.qualityFailed ? ` · ${c.qualityFailed} quality-fail` : ""}
                  {c.errors.length > 0 ? ` · ${c.errors.length} fouten` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
