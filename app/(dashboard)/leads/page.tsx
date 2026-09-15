"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { leadStatusMeta, leads } from "@/lib/mock-data";
import { cn, scoreVariant, slugify } from "@/lib/utils";

const categories = ["Alle", ...Array.from(new Set(leads.map((lead) => lead.category)))];
const scoreFilters = [
  { label: "Alle scores", min: 0 },
  { label: "60+", min: 60 },
  { label: "80+", min: 80 },
];

export default function LeadsPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Alle");
  const [minScore, setMinScore] = useState(0);
  const [noWebsiteOnly, setNoWebsiteOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((lead) => {
      if (q && !`${lead.name} ${lead.location} ${lead.category}`.toLowerCase().includes(q)) {
        return false;
      }
      if (category !== "Alle" && lead.category !== category) return false;
      if (lead.leadScore < minScore) return false;
      if (noWebsiteOnly && lead.website) return false;
      return true;
    });
  }, [query, category, minScore, noWebsiteOnly]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Zoek bedrijf, locatie of branche..."
          className="h-9 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
        />
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={noWebsiteOnly}
            onChange={(event) => setNoWebsiteOnly(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-900 accent-indigo-500"
          />
          Alleen zonder website
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {categories.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setCategory(item)}
            className={cn(
              "h-8 rounded-lg border px-3 text-xs font-medium transition-colors",
              category === item
                ? "border-indigo-500/50 bg-indigo-950 text-indigo-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
            )}
          >
            {item}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-zinc-800" />
        {scoreFilters.map((filter) => (
          <button
            key={filter.label}
            type="button"
            onClick={() => setMinScore(filter.min)}
            className={cn(
              "h-8 rounded-lg border px-3 text-xs font-medium transition-colors",
              minScore === filter.min
                ? "border-indigo-500/50 bg-indigo-950 text-indigo-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <Card className="p-0">
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-zinc-200">Geen leads gevonden</p>
            <p className="mt-1 text-xs text-zinc-500">Pas je filters of zoekopdracht aan.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-5 py-3 font-medium">Bedrijf</th>
                  <th className="px-3 py-3 font-medium">Branche</th>
                  <th className="px-3 py-3 font-medium">Locatie</th>
                  <th className="px-3 py-3 font-medium">Website</th>
                  <th className="px-3 py-3 font-medium">Score</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Contact</th>
                  <th className="px-3 py-3 font-medium">Demo</th>
                  <th className="px-3 py-3 font-medium">Laatste activiteit</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead) => (
                  <tr key={lead.id} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                    <td className="px-5 py-3">
                      <Link href={`/leads/${lead.id}`} className="font-medium text-zinc-100 hover:text-indigo-300">
                        {lead.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-zinc-400">{lead.category}</td>
                    <td className="px-3 py-3 text-zinc-400">{lead.location}</td>
                    <td className="px-3 py-3 text-zinc-500">{lead.website ?? "—"}</td>
                    <td className="px-3 py-3">
                      <Badge variant={scoreVariant(lead.leadScore)}>{lead.leadScore}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={leadStatusMeta[lead.status].variant}>
                        {leadStatusMeta[lead.status].label}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-zinc-400">{lead.email ?? lead.phone ?? "—"}</td>
                    <td className="px-3 py-3">
                      {lead.hasDemo ? (
                        <Link
                          href={`/demo/${slugify(lead.name)}`}
                          className="text-xs font-medium text-indigo-400 hover:text-indigo-300"
                        >
                          Beschikbaar
                        </Link>
                      ) : (
                        <span className="text-xs text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-zinc-500">{lead.lastActivity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
