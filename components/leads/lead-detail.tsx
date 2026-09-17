"use client";

import Link from "next/link";
import { LifecycleControl } from "./lifecycle-control";
import { useState } from "react";
import { OutreachSection } from "@/components/leads/outreach-section";
import { SalesSection } from "@/components/sales/sales-section";
import { ProjectSection } from "@/components/leads/project-section";
import type { Project } from "@/lib/projects/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { scoreLead } from "@/lib/agents/lead-scoring";
import {
  demoStatusMeta,
  leadSourceMeta,
  leadStatusMeta,
  mockLeadActivity,
  outreachStatusMeta,
  websiteStatusMeta,
} from "@/lib/mock-data";
import type { DemoWebsite, Lead } from "@/lib/types";
import { cn, scoreCategory, scoreVariant, slugify } from "@/lib/utils";

const inputClass =
  "h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none";

export function LeadDetail({
  lead,
  demo,
  project,
}: {
  lead: Lead;
  demo: DemoWebsite | null;
  project: Project | null;
}) {
  const [current, setCurrent] = useState<Lead>(lead);
  const [notes, setNotes] = useState<string[]>(lead.notes);
  const [events, setEvents] = useState(() => mockLeadActivity(lead));
  const [noteText, setNoteText] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    businessName: lead.businessName,
    industry: lead.industry,
    city: lead.city,
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    website: lead.website ?? "",
  });

  const { score, reason, factors } = scoreLead(current);

  function addEvent(label: string) {
    setEvents((prev) => [
      ...prev,
      { time: new Date().toISOString().slice(0, 10) + " " + new Date().toTimeString().slice(0, 5), label },
    ]);
  }

  function addNote() {
    const text = noteText.trim();
    if (!text) return;
    setNotes((prev) => [...prev, text]);
    setNoteText("");
    addEvent("Note added");
  }

  function saveEdit() {
    setCurrent((prev) => ({
      ...prev,
      businessName: form.businessName.trim() || prev.businessName,
      industry: form.industry.trim() || prev.industry,
      city: form.city.trim() || prev.city,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      website: form.website.trim() || null,
    }));
    setEditing(false);
    addEvent("Lead information updated");
  }

  const websiteMeta = websiteStatusMeta[current.websiteStatus];

  return (
    <div className="space-y-6">
      <Link href="/leads" className="text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200">
        ← Alle leads
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">{current.businessName}</h2>
            <Badge variant={scoreVariant(score)}>
              {score} · {scoreCategory(score)}
            </Badge>
            <Badge variant={leadStatusMeta[lead.leadStatus].variant}>
              {leadStatusMeta[lead.leadStatus].label}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            {current.industry} · {current.city} · bron: {leadSourceMeta[current.source]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing((prev) => !prev)}
            className="h-9 rounded-lg border border-zinc-800 bg-zinc-900 px-4 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-600"
          >
            {editing ? "Annuleren" : "Bewerken"}
          </button>
          <button
            type="button"
            disabled
            title="Demo-generatie komt in Fase 3"
            className="h-9 cursor-not-allowed rounded-lg border border-zinc-800 bg-zinc-900 px-4 text-xs font-medium text-zinc-500"
          >
            Create demo · Fase 3
          </button>
          {current.demoStatus === "ready" ? (
            <Link
              href={`/demo/${slugify(current.businessName)}`}
              className="inline-flex h-9 items-center rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-indigo-500"
            >
              Bekijk demo →
            </Link>
          ) : null}
        </div>
      </div>

      {editing ? (
        <Card>
          <CardHeader
            title="Lead bewerken"
            subtitle="Mock data — wijzigingen zijn tijdelijk en worden niet opgeslagen"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["Business name", "businessName"],
                ["Industry", "industry"],
                ["City", "city"],
                ["Phone", "phone"],
                ["Email", "email"],
                ["Website", "website"],
              ] as const
            ).map(([label, key]) => (
              <div key={key}>
                <label className="mb-1.5 block text-xs text-zinc-400" htmlFor={`edit-${key}`}>
                  {label}
                </label>
                <input
                  id={`edit-${key}`}
                  value={form[key]}
                  onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
                  className={inputClass}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={saveEdit}
            className="mt-4 h-9 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-indigo-500"
          >
            Opslaan (tijdelijk)
          </button>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="AI Analysis"
              subtitle="Mock AI-analyse — geen echte AI calls in deze fase"
              action={<Badge variant="neutral">Mock</Badge>}
            />
            <dl className="space-y-4">
              {(
                [
                  ["Business Summary", current.aiAnalysis?.businessSummary],
                  ["Opportunity", current.aiAnalysis?.opportunity],
                  ["Potential Problems", current.aiAnalysis?.potentialProblems],
                  ["Recommended Approach", current.aiAnalysis?.recommendedApproach],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-zinc-300">{value ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Lead Score" subtitle="Berekend door de rule-based Lead Scoring Agent" />
            <div className="flex items-center gap-4">
              <p className="text-4xl font-bold tracking-tight text-zinc-50">{score}</p>
              <div>
                <Badge variant={scoreVariant(score)}>{scoreCategory(score)}</Badge>
                <p className="mt-1.5 max-w-md text-xs leading-relaxed text-zinc-400">{reason}</p>
              </div>
            </div>
            <div className="mt-6 space-y-4">
              {factors.map((factor) => (
                <div key={factor.label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-zinc-400">{factor.label}</span>
                    <span className="text-zinc-300">
                      {Math.round(factor.earned)}/{factor.max}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-800">
                    <div
                      className="h-1.5 rounded-full bg-indigo-500"
                      style={{ width: `${Math.max((factor.earned / factor.max) * 100, 2)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Activity" subtitle="Tijdlijn van gebeurtenissen (mock)" />
            <ol className="relative space-y-5 border-l border-zinc-800 pl-5">
              {events.map((event, index) => (
                <li key={index} className="relative">
                  <span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full bg-indigo-400" />
                  <p className="text-xs font-mono text-zinc-500">{event.time}</p>
                  <p className="mt-0.5 text-sm text-zinc-300">{event.label}</p>
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <CardHeader title="Notes" subtitle="Mock — notities worden niet opgeslagen" />
            {notes.length > 0 ? (
              <ul className="mb-4 space-y-2">
                {notes.map((note, index) => (
                  <li key={index} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-sm text-zinc-300">
                    {note}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-xs text-zinc-500">Nog geen notities.</p>
            )}
            <label htmlFor="note-input" className="mb-1.5 block text-xs text-zinc-400">
              Nieuwe notitie
            </label>
            <textarea
              id="note-input"
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              rows={3}
              placeholder="Bijvoorbeeld: gebeld, belt terug na het weekend..."
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={addNote}
              className="mt-3 h-9 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-indigo-500"
            >
              Notitie toevoegen
            </button>
          </Card>

          <OutreachSection
            leadId={current.id}
            leadBusinessName={current.businessName}
            demoUrl={demo?.status === "ready" ? demo.previewUrl : null}
          />

          <SalesSection leadId={current.id} leadBusinessName={current.businessName} />

          <ProjectSection
            leadId={current.id}
            leadBusinessName={current.businessName}
            leadStatus={lead.leadStatus}
            project={project}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Business Information" />
            <dl className="space-y-3">
              {(
                [
                  ["Business name", current.businessName],
                  ["Industry", current.industry],
                  ["Address", current.address ?? "—"],
                  ["Postal code", current.postalCode ?? "—"],
                  ["City", current.city],
                  ["Province", current.province],
                  ["Country", current.country],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 text-sm">
                  <dt className="shrink-0 text-zinc-500">{label}</dt>
                  <dd className="text-right text-zinc-200">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Contact Information" />
            <dl className="space-y-3">
              <div className="flex items-start justify-between gap-4 text-sm">
                <dt className="shrink-0 text-zinc-500">Phone</dt>
                <dd className="text-right text-zinc-200">{current.phone ?? "Niet beschikbaar"}</dd>
              </div>
              <div className="flex items-start justify-between gap-4 text-sm">
                <dt className="shrink-0 text-zinc-500">Email</dt>
                <dd className="text-right text-zinc-200">{current.email ?? "Niet beschikbaar"}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Website Information" />
            <div
              className={cn(
                "rounded-lg border p-4",
                current.websiteStatus === "no_website"
                  ? "border-amber-900/60 bg-amber-950/30"
                  : "border-zinc-800 bg-zinc-900/40"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <Badge variant={websiteMeta.variant}>{websiteMeta.label}</Badge>
                {current.website ? (
                  <span className="text-xs text-zinc-400">{current.website}</span>
                ) : (
                  <span className="text-xs text-zinc-500">Geen URL bekend</span>
                )}
              </div>
              {current.websiteStatus === "no_website" ? (
                <p className="mt-3 text-xs leading-relaxed text-amber-300/80">
                  Dit bedrijf heeft geen website — prima kandidaat voor de huidige leadstrategie.
                </p>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Demo"
              subtitle={demo ? "Gekoppeld via het demo-systeem" : "Geen demo gekoppeld"}
            />
            {demo ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-zinc-300">{demo.businessName}</span>
                  <Badge variant={demoStatusMeta[demo.status].variant}>
                    {demoStatusMeta[demo.status].label}
                  </Badge>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {demo.status === "ready" ? (
                    <Link
                      href={demo.previewUrl}
                      className="inline-flex h-9 items-center rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-zinc-50 transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-indigo-500"
                    >
                      View Demo
                    </Link>
                  ) : null}
                  <Link
                    href={`/demo-websites/${demo.id}`}
                    className="inline-flex h-9 items-center rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-indigo-500"
                  >
                    Demo beheren
                  </Link>
                </div>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-zinc-500">
                Voor deze lead is nog geen demo aangemaakt. Demo-generatie komt in een latere fase.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="Status" subtitle="Opgeslagen in Supabase. Servervalidatie verplicht." />
            <LifecycleControl key={lead.leadStatus} leadId={lead.id} status={lead.leadStatus} projectId={project?.id}/>
            <div className="mt-4 flex flex-wrap gap-2"><Badge variant={outreachStatusMeta[lead.outreachStatus].variant}>{outreachStatusMeta[lead.outreachStatus].label}</Badge><Badge variant={demoStatusMeta[lead.demoStatus].variant}>{demoStatusMeta[lead.demoStatus].label}</Badge></div>
          </Card>
        </div>
      </div>
    </div>
  );
}
