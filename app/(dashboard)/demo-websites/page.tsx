"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CopyUrlButton } from "@/components/demo/copy-url-button";
import { Badge } from "@/components/ui/badge";
import { demoTemplates } from "@/lib/demo-templates";
import { demos } from "@/lib/mock-demos";
import { demoStatusMeta, leads } from "@/lib/mock-data";
import type { DemoTemplate } from "@/lib/types";
import { cn, scoreVariant } from "@/lib/utils";

type SortKey = "created_desc" | "created_asc" | "name_asc" | "score_desc";

const selectClass =
  "h-9 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none";

export default function DemoWebsitesPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [template, setTemplate] = useState("all");
  const [industry, setIndustry] = useState("all");
  const [city, setCity] = useState("all");
  const [sort, setSort] = useState<SortKey>("created_desc");

  const industries = useMemo(
    () => Array.from(new Set(demos.map((demo) => demo.industry))).sort(),
    []
  );
  const cities = useMemo(() => Array.from(new Set(demos.map((demo) => demo.city))).sort(), []);

  const summary = useMemo(
    () => ({
      total: demos.length,
      ready: demos.filter((demo) => demo.status === "ready").length,
      generating: demos.filter((demo) => demo.status === "generating").length,
      failed: demos.filter((demo) => demo.status === "failed").length,
    }),
    []
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const withLead = demos.map((demo) => ({
      demo,
      lead: leads.find((item) => item.id === demo.leadId),
    }));

    const filtered = withLead.filter(({ demo }) => {
      if (
        q &&
        !`${demo.businessName} ${demo.city} ${demo.industry} ${demo.slug}`
          .toLowerCase()
          .includes(q)
      ) {
        return false;
      }
      if (status !== "all" && demo.status !== status) return false;
      if (template !== "all" && demo.template !== template) return false;
      if (industry !== "all" && demo.industry !== industry) return false;
      if (city !== "all" && demo.city !== city) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      switch (sort) {
        case "created_asc":
          return a.demo.createdAt.localeCompare(b.demo.createdAt);
        case "name_asc":
          return a.demo.businessName.localeCompare(b.demo.businessName, "nl");
        case "score_desc":
          return (b.lead?.leadScore ?? 0) - (a.lead?.leadScore ?? 0);
        default:
          return b.demo.createdAt.localeCompare(a.demo.createdAt);
      }
    });
  }, [query, status, template, industry, city, sort]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Demo Websites</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Alle automatisch gegenereerde demo&apos;s, gekoppeld aan leads — mock data, geen echte AI-generatie.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              ["Total", summary.total],
              ["Ready", summary.ready],
              ["Generating", summary.generating],
              ["Failed", summary.failed],
            ] as const
          ).map(([label, value]) => (
            <span
              key={label}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs"
            >
              <span className="text-zinc-500">{label}</span>
              <span className="font-semibold text-zinc-100">{value}</span>
            </span>
          ))}
        </div>
      </div>

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Zoek op bedrijfsnaam, locatie, branche of slug..."
        aria-label="Zoek demo's"
        className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
      />

      <div className="flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter op status" className={selectClass}>
          <option value="all">Status: alle</option>
          <option value="ready">Ready</option>
          <option value="generating">Generating</option>
          <option value="failed">Failed</option>
        </select>
        <select value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="Filter op template" className={selectClass}>
          <option value="all">Template: alle</option>
          {(Object.keys(demoTemplates) as DemoTemplate[]).map((key) => (
            <option key={key} value={key}>{demoTemplates[key].name}</option>
          ))}
        </select>
        <select value={industry} onChange={(e) => setIndustry(e.target.value)} aria-label="Filter op branche" className={selectClass}>
          <option value="all">Branche: alle</option>
          {industries.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <select value={city} onChange={(e) => setCity(e.target.value)} aria-label="Filter op locatie" className={selectClass}>
          <option value="all">Locatie: alle</option>
          {cities.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sorteer demo's"
          className={cn(selectClass, "ml-auto")}
        >
          <option value="created_desc">Nieuwste eerst</option>
          <option value="created_asc">Oudste eerst</option>
          <option value="name_asc">Bedrijfsnaam (A → Z)</option>
          <option value="score_desc">Lead score (hoog → laag)</option>
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-10 text-center">
          <p className="text-sm font-medium text-zinc-200">Geen demo&apos;s gevonden</p>
          <p className="mt-1 text-xs text-zinc-500">Pas je filters of zoekopdracht aan.</p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60 md:block">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-5 py-3 font-medium">Business</th>
                  <th className="px-3 py-3 font-medium">Location</th>
                  <th className="px-3 py-3 font-medium">Template</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Lead Score</th>
                  <th className="px-3 py-3 font-medium">Created</th>
                  <th className="px-3 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ demo, lead }) => (
                  <tr key={demo.id} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                    <td className="px-5 py-3">
                      <Link href={`/demo-websites/${demo.id}`} className="font-medium text-zinc-100 hover:text-indigo-300">
                        {demo.businessName}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-zinc-400">{demo.city}</td>
                    <td className="px-3 py-3 text-zinc-400">{demoTemplates[demo.template].name}</td>
                    <td className="px-3 py-3">
                      <Badge variant={demoStatusMeta[demo.status].variant}>
                        {demoStatusMeta[demo.status].label}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      {lead ? (
                        <Badge variant={scoreVariant(lead.leadScore)}>{lead.leadScore}</Badge>
                      ) : (
                        <span className="text-xs text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-zinc-500">{demo.createdAt.slice(0, 10)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {demo.status === "ready" ? (
                          <Link
                            href={demo.previewUrl}
                            className="text-xs font-medium text-indigo-400 hover:text-indigo-300"
                          >
                            View Demo
                          </Link>
                        ) : null}
                        {lead ? (
                          <Link
                            href={`/leads/${lead.id}`}
                            className="text-xs font-medium text-zinc-400 hover:text-zinc-200"
                          >
                            View Lead
                          </Link>
                        ) : null}
                        <CopyUrlButton slug={demo.slug} className="h-7 text-[11px]" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {rows.map(({ demo, lead }) => (
              <Link
                key={demo.id}
                href={`/demo-websites/${demo.id}`}
                className="block rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 transition-colors hover:border-zinc-700"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">{demo.businessName}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {demoTemplates[demo.template].name} · {demo.city}
                    </p>
                  </div>
                  <Badge variant={demoStatusMeta[demo.status].variant}>
                    {demoStatusMeta[demo.status].label}
                  </Badge>
                </div>
                {lead ? (
                  <p className="mt-2 text-xs text-zinc-500">Lead score: {lead.leadScore}</p>
                ) : null}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
