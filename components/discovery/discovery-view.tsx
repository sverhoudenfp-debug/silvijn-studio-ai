"use client";

import { useState } from "react";
import { runDiscovery, type DiscoveryFormInput } from "@/app/(dashboard)/lead-discovery/actions";
import { DISCOVERY_SOURCES } from "@/lib/discovery/providers";
import type { DiscoveryCommandResult } from "@/lib/discovery/orchestrator";
import type { DiscoveryRunRecord } from "@/lib/discovery/run-types";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

/**
 * Lead Discovery UI — gecontroleerde discovery-opdrachten. Geen automatische
 * loops: elke run start expliciet via [Discover Leads] (owner-gated server
 * action). Na afloop: samenvatting met tellingen, scores/prioriteiten,
 * overgeslagen duplicaten/bestaande leads en fouten, plus de recente
 * opdrachtgeschiedenis.
 */

const inputClass =
  "h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none";

const statusVariants: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  created: "success",
  duplicate: "warning",
  invalid: "danger",
  skipped: "neutral",
  new: "info",
};

const statusLabels: Record<string, string> = {
  created: "Nieuw",
  duplicate: "Duplicaat",
  invalid: "Ongeldig",
  skipped: "Overgeslagen",
  new: "Gevonden",
};

const priorityVariants: Record<string, "success" | "warning" | "neutral"> = {
  hoog: "success",
  middel: "warning",
  laag: "neutral",
};

const runStatusVariants: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  completed: "success",
  failed: "danger",
  running: "info",
};

const runStatusLabels: Record<string, string> = {
  completed: "Voltooid",
  failed: "Mislukt",
  running: "Bezig",
};

const websiteStatusLabels: Record<string, string> = {
  no_website: "Geen website",
  has_website: "Heeft website",
  website_poor: "Zwakke website",
  unknown: "Onbekend",
};

function Chip({ label, value, tone }: { label: string; value: number | string; tone?: "warn" | "error" | "ok" }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs">
      <span className="text-zinc-500">{label}</span>
      <span
        className={cn(
          "font-semibold",
          tone === "ok" && "text-emerald-400",
          tone === "warn" && "text-amber-400",
          tone === "error" && "text-red-400",
          !tone && "text-zinc-100"
        )}
      >
        {value}
      </span>
    </span>
  );
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" });
}

export function DiscoveryView({ recentRuns }: { recentRuns: DiscoveryRunRecord[] }) {
  const [form, setForm] = useState<DiscoveryFormInput>({
    country: "NL",
    province: "",
    city: "",
    industry: "",
    query: "",
    source: "mock",
    limit: 20,
  });
  const [result, setResult] = useState<DiscoveryCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setError(null);
    setPending(true);
    try {
      setResult(await runDiscovery(form));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Discovery-opdracht mislukt");
    } finally {
      setPending(false);
    }
  }

  const set = (key: keyof DiscoveryFormInput) => (value: string | number) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const discovery = result?.discovery ?? null;
  const rejected = result?.status === "rejected";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Lead Discovery</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Geef een expliciete discovery-opdracht: bedrijven ontdekken, controleren op duplicaten, verrijken, scoren en opslaan als lead — nooit outreach.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Land</span>
            <select
              value={form.country}
              onChange={(e) => set("country")(e.target.value)}
              className={inputClass}
              aria-label="Land"
            >
              <option value="NL">Nederland (NL)</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Provincie / regio</span>
            <input
              value={form.province}
              onChange={(e) => set("province")(e.target.value)}
              placeholder="bijv. Noord-Brabant"
              className={inputClass}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Plaats</span>
            <input
              value={form.city}
              onChange={(e) => set("city")(e.target.value)}
              placeholder="bijv. Eindhoven"
              className={inputClass}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Branche</span>
            <input
              value={form.industry}
              onChange={(e) => set("industry")(e.target.value)}
              placeholder="bijv. Restaurants"
              className={inputClass}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Zoekterm (optioneel)</span>
            <input
              value={form.query}
              onChange={(e) => set("query")(e.target.value)}
              placeholder="bijv. loodgieters in Eindhoven"
              className={inputClass}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Bron</span>
            <select
              value={form.source}
              onChange={(e) => set("source")(e.target.value)}
              className={inputClass}
              aria-label="Discovery-bron"
            >
              {DISCOVERY_SOURCES.map((source) => (
                <option key={source.id} value={source.id} disabled={!source.available}>
                  {source.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Limiet</span>
            <input
              type="number"
              min={1}
              max={50}
              value={form.limit}
              onChange={(e) => set("limit")(Number.parseInt(e.target.value, 10) || 20)}
              className={inputClass}
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-zinc-50 transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Discovery draait..." : "Discover Leads"}
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        <p className="mt-3 text-xs text-zinc-500">
          Minimaal een branche, plaats of regio vereist. Max. 50 kandidaten per run (configureerbaar). Discovery start nooit outreach. Mock-bron bevat uitsluitend fictieve testbedrijven — geen echte externe data.
        </p>
      </div>

      {result && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant={runStatusVariants[result.status] ?? "neutral"}>
              {runStatusLabels[result.status] ?? result.status}
            </Badge>
            {result.command && <span className="text-sm text-zinc-400">{result.command}</span>}
          </div>

          {rejected && result.errors.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-950/40 p-3 text-sm text-amber-300">
              {result.errors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          )}

          {discovery && (
            <>
              <div className="flex flex-wrap gap-2">
                <Chip label="Gevonden" value={discovery.totalFound} />
                <Chip label="Nieuwe leads" value={discovery.createdLeads} tone="ok" />
                <Chip label="Duplicaten/bestaand" value={discovery.duplicatesSkipped} tone="warn" />
                <Chip label="Ongeldig" value={discovery.invalidCandidatesSkipped} tone="warn" />
                <Chip label="Fouten" value={discovery.errors.length} tone={discovery.errors.length ? "error" : undefined} />
                <Chip label="Duur" value={`${discovery.durationMs}ms`} />
              </div>

              {discovery.errors.length > 0 && (
                <div className="rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-sm text-red-300">
                  {discovery.errors.map((error) => (
                    <p key={error}>{error}</p>
                  ))}
                </div>
              )}

              {result.createdLeadSummaries.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-zinc-200">Nieuwe leads met score en prioriteit</h3>
                  <div className="overflow-x-auto rounded-xl border border-zinc-800">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-zinc-800 bg-zinc-900/60 text-left text-xs text-zinc-400">
                          <th className="px-3 py-2.5 font-medium">Bedrijf</th>
                          <th className="px-3 py-2.5 font-medium">Branche</th>
                          <th className="px-3 py-2.5 font-medium">Plaats</th>
                          <th className="px-3 py-2.5 font-medium">Score</th>
                          <th className="px-3 py-2.5 font-medium">Prioriteit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.createdLeadSummaries.map((lead) => (
                          <tr key={lead.leadId} className="border-b border-zinc-800/60 last:border-0">
                            <td className="px-3 py-2.5 text-zinc-100">{lead.businessName}</td>
                            <td className="px-3 py-2.5 text-zinc-300">{lead.industry}</td>
                            <td className="px-3 py-2.5 text-zinc-300">{lead.city}</td>
                            <td className="px-3 py-2.5 font-semibold text-zinc-100">{lead.score}</td>
                            <td className="px-3 py-2.5">
                              <Badge variant={priorityVariants[lead.priority] ?? "neutral"}>{lead.priority}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {discovery.candidates.length === 0 ? (
                <EmptyState title="Geen kandidaten gevonden" description="Probeer andere filters of een grotere limiet." />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-zinc-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-900/60 text-left text-xs text-zinc-400">
                        <th className="px-3 py-2.5 font-medium">Bedrijf</th>
                        <th className="px-3 py-2.5 font-medium">Branche</th>
                        <th className="px-3 py-2.5 font-medium">Plaats</th>
                        <th className="px-3 py-2.5 font-medium">Website</th>
                        <th className="px-3 py-2.5 font-medium">Status</th>
                        <th className="px-3 py-2.5 font-medium">Resultaat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {discovery.candidates.map((item, index) => (
                        <tr
                          key={`${item.candidate.businessName}-${index}`}
                          className="border-b border-zinc-800/60 last:border-0"
                        >
                          <td className="px-3 py-2.5 text-zinc-100">{item.candidate.businessName || <span className="text-zinc-500">(naamloos)</span>}</td>
                          <td className="px-3 py-2.5 text-zinc-300">{item.candidate.industry}</td>
                          <td className="px-3 py-2.5 text-zinc-300">{item.candidate.city}</td>
                          <td className="px-3 py-2.5 text-zinc-400">{item.candidate.website ?? "—"}</td>
                          <td className="px-3 py-2.5 text-zinc-300">
                            {websiteStatusLabels[item.websiteStatus] ?? item.websiteStatus}
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge variant={statusVariants[item.status] ?? "neutral"}>
                              {statusLabels[item.status] ?? item.status}
                            </Badge>
                            {item.reason && <span className="ml-2 text-xs text-zinc-500">{item.reason}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-zinc-200">Recente opdrachten</h3>
        {recentRuns.length === 0 ? (
          <EmptyState title="Nog geen discovery-opdrachten" description="Elke expliciete opdracht wordt hier vastgelegd met tellingen en resultaat." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/60 text-left text-xs text-zinc-400">
                  <th className="px-3 py-2.5 font-medium">Opdracht</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Gevonden</th>
                  <th className="px-3 py-2.5 font-medium">Nieuw</th>
                  <th className="px-3 py-2.5 font-medium">Duplicaten</th>
                  <th className="px-3 py-2.5 font-medium">Gestart</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr key={run.id} className="border-b border-zinc-800/60 last:border-0">
                    <td className="max-w-[280px] truncate px-3 py-2.5 text-zinc-100" title={run.command}>
                      {run.command}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={runStatusVariants[run.status] ?? "neutral"}>
                        {runStatusLabels[run.status] ?? run.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-zinc-300">{run.totalFound ?? "—"}</td>
                    <td className="px-3 py-2.5 text-emerald-400">{run.createdLeads ?? "—"}</td>
                    <td className="px-3 py-2.5 text-amber-400">{run.duplicatesSkipped ?? "—"}</td>
                    <td className="px-3 py-2.5 text-zinc-400">{formatDateTime(run.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
