"use client";

import { useState } from "react";
import { processPendingRepliesAction } from "@/app/actions/sales";
import { Badge } from "@/components/ui/badge";

/**
 * Reply-pipeline-paneel (Fase E) — verwerkt nieuwe confirmed reacties en zet
 * het verkoopgesprek voort binnen de expliciete eigenaarsmodus.
 *
 *   review: AI analyseert en maakt antwoordconcepten; mens stuurt.
 *   auto:    AI beantwoordt autonoom; afmelding stopt direct; prijzen en
 *            andere menselijke beslissingen blijven uitsluitend menselijk.
 */

type Mode = "review" | "auto";

export function ReplyPipelinePanel({ pendingCount }: { pendingCount: number }) {
  const [mode, setMode] = useState<Mode>("review");
  const [detail, setDetail] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run() {
    setError(null);
    setPending(true);
    try {
      const r = await processPendingRepliesAction({ mode });
      const parts: string[] = [`${r.processedCount} reactie(s) verwerkt`];
      if (r.sentCount) parts.push(`${r.sentCount} beantwoord`);
      if (r.escalatedCount) parts.push(`${r.escalatedCount} geëscaleerd naar Silvijn`);
      setDetail(parts.join(" · "));
      setErrors(r.errors);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pipeline mislukt");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-100">Reply-pipeline</h2>
        <Badge variant={pendingCount > 0 ? "warning" : "neutral"}>
          {pendingCount} open reacties
        </Badge>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Nieuwe confirmed reacties worden geanalyseerd (intent, kwalificatie) en binnen de gekozen
        modus beantwoord. Afmelding stopt alles direct; prijsaanvragen en menselijke beslissingen
        gaan altijd naar Silvijn.
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
            <option value="auto">Auto (autonoom beantwoorden)</option>
          </select>
        </label>
        <button
          type="button"
          onClick={run}
          disabled={pending || pendingCount === 0}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
        >
          {pending ? "Bezig…" : "Verwerk open reacties"}
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      {detail && !error && <p className="mt-3 text-xs text-zinc-300">{detail}</p>}
      {errors.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-xs text-red-400">
          {errors.slice(0, 3).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
