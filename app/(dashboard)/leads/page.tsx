"use client";

import { useMemo, useState } from "react";
import { LeadTable } from "@/components/leads/lead-table";
import { leads } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

type SortKey = "score_desc" | "score_asc" | "name_asc" | "name_desc" | "created_desc" | "created_asc";

const scoreFilters = [
  { label: "Alle", min: 0 },
  { label: "50+", min: 50 },
  { label: "75+", min: 75 },
  { label: "90+", min: 90 },
];

const sortLabels: Record<SortKey, string> = {
  score_desc: "Lead score (hoog → laag)",
  score_asc: "Lead score (laag → hoog)",
  name_asc: "Bedrijfsnaam (A → Z)",
  name_desc: "Bedrijfsnaam (Z → A)",
  created_desc: "Nieuwste eerst",
  created_asc: "Oudste eerst",
};

const selectClass =
  "h-9 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none";

export default function LeadsPage() {
  const [query, setQuery] = useState("");
  const [leadStatus, setLeadStatus] = useState("all");
  const [websiteStatus, setWebsiteStatus] = useState("all");
  const [industry, setIndustry] = useState("all");
  const [city, setCity] = useState("all");
  const [outreach, setOutreach] = useState("all");
  const [demo, setDemo] = useState("all");
  const [minScore, setMinScore] = useState(0);
  const [sort, setSort] = useState<SortKey>("score_desc");

  const industries = useMemo(
    () => Array.from(new Set(leads.map((lead) => lead.industry))).sort(),
    []
  );
  const cities = useMemo(
    () => Array.from(new Set(leads.map((lead) => lead.city))).sort(),
    []
  );

  const summary = useMemo(
    () => ({
      total: leads.length,
      new: leads.filter((lead) => lead.leadStatus === "new").length,
      qualified: leads.filter((lead) => lead.leadStatus === "qualified").length,
      interested: leads.filter((lead) => lead.leadStatus === "interested").length,
      won: leads.filter((lead) => lead.leadStatus === "won").length,
    }),
    []
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result = leads.filter((lead) => {
      if (
        q &&
        !`${lead.businessName} ${lead.city} ${lead.province} ${lead.industry} ${lead.email ?? ""} ${lead.website ?? ""}`
          .toLowerCase()
          .includes(q)
      ) {
        return false;
      }
      if (leadStatus !== "all" && lead.leadStatus !== leadStatus) return false;
      if (websiteStatus !== "all" && lead.websiteStatus !== websiteStatus) return false;
      if (industry !== "all" && lead.industry !== industry) return false;
      if (city !== "all" && lead.city !== city) return false;
      if (outreach !== "all" && lead.outreachStatus !== outreach) return false;
      if (demo !== "all" && lead.demoStatus !== demo) return false;
      if (lead.leadScore < minScore) return false;
      return true;
    });

    return result.sort((a, b) => {
      switch (sort) {
        case "score_asc":
          return a.leadScore - b.leadScore;
        case "name_asc":
          return a.businessName.localeCompare(b.businessName, "nl");
        case "name_desc":
          return b.businessName.localeCompare(a.businessName, "nl");
        case "created_desc":
          return b.createdAt.localeCompare(a.createdAt);
        case "created_asc":
          return a.createdAt.localeCompare(b.createdAt);
        default:
          return b.leadScore - a.leadScore;
      }
    });
  }, [query, leadStatus, websiteStatus, industry, city, outreach, demo, minScore, sort]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Leads</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Alle potentiële klanten in de pipeline — mock data, later aangesloten op echte data.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ["Total", summary.total],
            ["New", summary.new],
            ["Qualified", summary.qualified],
            ["Interested", summary.interested],
            ["Won", summary.won],
          ].map(([label, value]) => (
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
        placeholder="Zoek op bedrijfsnaam, plaats, provincie, branche, e-mail of website..."
        aria-label="Zoek leads"
        className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
      />

      <div className="flex flex-wrap items-center gap-2">
        <select value={leadStatus} onChange={(e) => setLeadStatus(e.target.value)} aria-label="Filter op lead status" className={selectClass}>
          <option value="all">Lead status: alle</option>
          <option value="new">New</option>
          <option value="analyzing">Analyzing</option>
          <option value="qualified">Qualified</option>
          <option value="contacted">Contacted</option>
          <option value="interested">Interested</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </select>
        <select value={websiteStatus} onChange={(e) => setWebsiteStatus(e.target.value)} aria-label="Filter op website status" className={selectClass}>
          <option value="all">Website: alle</option>
          <option value="no_website">No website</option>
          <option value="has_website">Has website</option>
          <option value="website_poor">Poor website</option>
          <option value="unknown">Unknown</option>
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
        <select value={outreach} onChange={(e) => setOutreach(e.target.value)} aria-label="Filter op outreach status" className={selectClass}>
          <option value="all">Outreach: alle</option>
          <option value="not_contacted">Not contacted</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="opened">Opened</option>
          <option value="replied">Replied</option>
          <option value="interested">Interested</option>
          <option value="opted_out">Opted out</option>
        </select>
        <select value={demo} onChange={(e) => setDemo(e.target.value)} aria-label="Filter op demo status" className={selectClass}>
          <option value="all">Demo: alle</option>
          <option value="not_created">Not created</option>
          <option value="generating">Generating</option>
          <option value="ready">Ready</option>
          <option value="failed">Failed</option>
        </select>
        <span className="mx-1 h-5 w-px bg-zinc-800" />
        {scoreFilters.map((filter) => (
          <button
            key={filter.label}
            type="button"
            onClick={() => setMinScore(filter.min)}
            className={cn(
              "h-9 rounded-lg border px-3 text-xs font-medium transition-colors",
              minScore === filter.min
                ? "border-indigo-500/50 bg-indigo-950 text-indigo-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
            )}
          >
            Score {filter.label}
          </button>
        ))}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sorteer leads"
          className={`${selectClass} ml-auto`}
        >
          {(Object.keys(sortLabels) as SortKey[]).map((key) => (
            <option key={key} value={key}>{sortLabels[key]}</option>
          ))}
        </select>
      </div>

      <LeadTable leads={filtered} />
    </div>
  );
}
