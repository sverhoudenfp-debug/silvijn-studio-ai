"use client";

import { useState, useTransition } from "react";
import { runDiscovery, type DiscoveryFormInput } from "@/app/(dashboard)/lead-discovery/actions";
import { DISCOVERY_SOURCES } from "@/lib/discovery/providers";
import type { DiscoveryResult } from "@/lib/discovery/types";
import { cn } from "@/lib/utils";

/**
 * Lead Discovery UI — gecontroleerde discovery-runs. Geen automatische
 * loops: elke run start expliciet via [Discover Leads].
 */

const inputClass =
  "h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none";

const statusStyles: Record<string, string> = {
  created: "border-emerald-500/40 bg-emerald-950 text-emerald-300",
  duplicate: "border-amber-500/40 bg-amber-950 text-amber-300",
  invalid: "border-red-500/40 bg-red-950 text-red-300",
  skipped: "border-zinc-700 bg-zinc-900 text-zinc-400",
  new: "border-indigo-500/40 bg-indigo-950 text-indigo-300",
};

const statusLabels: Record<string, string> = {
  created: "Created",
  duplicate: "Duplicate",
  invalid: "Invalid",
  skipped: "Skipped",
  new: "New",
};

const websiteStatusLabels: Record<string, string> = {
  no_website: "No website",
  has_website: "Has website",
  website_poor: "Poor website",
  unknown: "Unknown",
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

export function DiscoveryView() {
  const [form, setForm] = useState<DiscoveryFormInput>({
    country: "NL",
    province: "",
    city: "",
    industry: "",
    query: "",
    source: "mock",
    limit: 20,
  });
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      setResult(await runDiscovery(form));
    });
  }

  const set = (key: keyof DiscoveryFormInput) => (value: string | number) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Lead Discovery</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Vind potentiële klanten, controleer op duplicaten en sla ze op als lead — gecontroleerd, per handmatige run.
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
            <span className="text-xs font-medium text-zinc-400">Provincie (optioneel)</span>
            <input
              value={form.province}
              onChange={(e) => set("province")(e.target.value)}
              placeholder="bijv. Noord-Brabant"
              className={inputClass}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Stad (optioneel)</span>
            <input
              value={form.city}
              onChange={(e) => set("city")(e.target.value)}
              placeholder="bijv. Eindhoven"
              className={inputClass}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Branche (optioneel)</span>
            <input
              value={form.industry}
              onChange={(e) => set("industry")(e.target.value)}
              placeholder="bijv. Dakdekker"
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
              className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-medium text-zinc-50 transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Discovery draait..." : "Discover Leads"}
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Max. 50 kandidaten per run (configureerbaar). Mock-bron bevat uitsluitend fictieve testbedrijven — geen echte externe data.
        </p>
      </div>

      {result && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Chip label="Found" value={result.totalFound} />
            <Chip label="Created" value={result.createdLeads} tone="ok" />
            <Chip label="Duplicates" value={result.duplicatesSkipped} tone="warn" />
            <Chip label="Invalid" value={result.invalidCandidatesSkipped} tone="warn" />
            <Chip label="Errors" value={result.errors.length} tone={result.errors.length ? "error" : undefined} />
            <Chip label="Duration" value={`${result.durationMs}ms`} />
          </div>

          {result.errors.length > 0 && (
            <div className="rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-sm text-red-300">
              {result.errors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          )}

          {result.candidates.length === 0 ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
              Geen kandidaten gevonden voor deze filters.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/60 text-left text-xs text-zinc-400">
                    <th className="px-3 py-2.5 font-medium">Bedrijf</th>
                    <th className="px-3 py-2.5 font-medium">Branche</th>
                    <th className="px-3 py-2.5 font-medium">Stad</th>
                    <th className="px-3 py-2.5 font-medium">Website</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Resultaat</th>
                  </tr>
                </thead>
                <tbody>
                  {result.candidates.map((item, index) => (
                    <tr
                      key={`${item.candidate.businessName}-${index}`}
                      className="border-b border-zinc-800/60 last:border-0"
                    >
                      <td className="px-3 py-2.5 text-zinc-100">{item.candidate.businessName || <span className="text-zinc-600">(naamloos)</span>}</td>
                      <td className="px-3 py-2.5 text-zinc-300">{item.candidate.industry}</td>
                      <td className="px-3 py-2.5 text-zinc-300">{item.candidate.city}</td>
                      <td className="px-3 py-2.5 text-zinc-400">{item.candidate.website ?? "—"}</td>
                      <td className="px-3 py-2.5 text-zinc-300">
                        {websiteStatusLabels[item.websiteStatus] ?? item.websiteStatus}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            "inline-flex rounded-md border px-2 py-0.5 text-xs font-medium",
                            statusStyles[item.status]
                          )}
                        >
                          {statusLabels[item.status]}
                        </span>
                        {item.reason && <span className="ml-2 text-xs text-zinc-500">{item.reason}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
