"use client";

import Link from "next/link";
import { useState } from "react";
import { CopyUrlButton } from "@/components/demo/copy-url-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { demoTemplates } from "@/lib/demo-templates";
import { generationStatusMeta } from "@/lib/mock-demos";
import { demoStatusMeta, leadStatusMeta } from "@/lib/mock-data";
import type { DemoTemplate, DemoWebsite, Lead } from "@/lib/types";
import { scoreVariant } from "@/lib/utils";

const inputClass =
  "h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none";

const selectClass =
  "h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none";

export function DemoDetail({ demo, lead }: { demo: DemoWebsite; lead?: Lead }) {
  const template = demoTemplates[demo.template] ?? demoTemplates.business_standard;
  const [current, setCurrent] = useState(demo);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    headline: demo.headline,
    description: demo.description,
    ctaText: demo.ctaText,
    template: demo.template,
    services: demo.services.join(", "),
  });

  const activity = [
    { time: current.createdAt.slice(0, 10), label: "Demo created" },
    { time: current.createdAt.slice(0, 10), label: `Generation started — template ${template.name}` },
    current.status === "ready"
      ? { time: current.updatedAt.slice(0, 10), label: "Generation completed" }
      : current.status === "failed"
        ? { time: current.updatedAt.slice(0, 10), label: "Generation failed" }
        : { time: current.updatedAt.slice(0, 10), label: "Generation running (mock)" },
  ];

  function saveEdit() {
    setCurrent((prev) => ({
      ...prev,
      headline: form.headline.trim() || prev.headline,
      description: form.description.trim() || prev.description,
      ctaText: form.ctaText.trim() || prev.ctaText,
      template: form.template,
      services: form.services
        .split(",")
        .map((service) => service.trim())
        .filter(Boolean),
    }));
    setEditing(false);
  }

  return (
    <div className="space-y-6">
      <Link href="/demo-websites" className="text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200">
        ← Alle demo&apos;s
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">{current.businessName}</h2>
            <Badge variant={demoStatusMeta[current.status].variant}>
              {demoStatusMeta[current.status].label}
            </Badge>
            <Badge variant={generationStatusMeta[current.generationStatus].variant}>
              {generationStatusMeta[current.generationStatus].label}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            {template.name} · /demo/{current.slug}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {current.status === "ready" ? (
            <Link
              href={current.previewUrl}
              className="inline-flex h-9 items-center rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-indigo-500"
            >
              View Demo →
            </Link>
          ) : null}
          {lead ? (
            <Link
              href={`/leads/${lead.id}`}
              className="inline-flex h-9 items-center rounded-lg border border-zinc-800 bg-zinc-900 px-4 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-600"
            >
              View Lead
            </Link>
          ) : null}
          <CopyUrlButton slug={current.slug} className="h-9" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Demo Information"
              subtitle="Mock data — wijzigingen hieronder zijn tijdelijk"
            />
            <dl className="space-y-3">
              {(
                [
                  ["Business name", current.businessName],
                  ["Slug", current.slug],
                  ["Template", demoTemplates[current.template].name],
                  ["Industry", current.industry],
                  ["Location", current.city],
                  ["Created", current.createdAt.slice(0, 10)],
                  ["Updated", current.updatedAt.slice(0, 10)],
                  ["Notes", current.notes || "—"],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 text-sm">
                  <dt className="shrink-0 text-zinc-500">{label}</dt>
                  <dd className="text-right text-zinc-200">{value}</dd>
                </div>
              ))}
            </dl>
            <button
              type="button"
              onClick={() => setEditing((prev) => !prev)}
              className="mt-4 h-9 rounded-lg border border-zinc-800 bg-zinc-900 px-4 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-600"
            >
              {editing ? "Annuleren" : "Demo bewerken"}
            </button>
          </Card>

          {editing ? (
            <Card>
              <CardHeader title="Edit Demo" subtitle="Client-side — niets wordt permanent opgeslagen" />
              <div className="space-y-4">
                <div>
                  <label htmlFor="edit-headline" className="mb-1.5 block text-xs text-zinc-400">Headline</label>
                  <input id="edit-headline" value={form.headline} onChange={(e) => setForm((p) => ({ ...p, headline: e.target.value }))} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="edit-description" className="mb-1.5 block text-xs text-zinc-400">Description</label>
                  <textarea id="edit-description" rows={3} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none" />
                </div>
                <div>
                  <label htmlFor="edit-cta" className="mb-1.5 block text-xs text-zinc-400">CTA-tekst</label>
                  <input id="edit-cta" value={form.ctaText} onChange={(e) => setForm((p) => ({ ...p, ctaText: e.target.value }))} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="edit-services" className="mb-1.5 block text-xs text-zinc-400">
                    Services (gescheiden door komma&apos;s)
                  </label>
                  <input id="edit-services" value={form.services} onChange={(e) => setForm((p) => ({ ...p, services: e.target.value }))} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="edit-template" className="mb-1.5 block text-xs text-zinc-400">Template</label>
                  <select
                    id="edit-template"
                    value={form.template}
                    onChange={(e) => setForm((p) => ({ ...p, template: e.target.value as DemoTemplate }))}
                    className={selectClass}
                  >
                    {(Object.keys(demoTemplates) as DemoTemplate[]).map((key) => (
                      <option key={key} value={key}>{demoTemplates[key].name}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={saveEdit}
                  className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-indigo-500"
                >
                  Opslaan (tijdelijk)
                </button>
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Activity" subtitle="Tijdlijn van demo-gebeurtenissen (mock)" />
            <ol className="relative space-y-5 border-l border-zinc-800 pl-5">
              {activity.map((event, index) => (
                <li key={index} className="relative">
                  <span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full bg-indigo-400" />
                  <p className="text-xs font-mono text-zinc-500">{event.time}</p>
                  <p className="mt-0.5 text-sm text-zinc-300">{event.label}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Lead Information" subtitle={lead ? undefined : "Geen lead gekoppeld"} />
            {lead ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/leads/${lead.id}`} className="text-sm font-medium text-zinc-100 hover:text-indigo-300">
                    {lead.businessName}
                  </Link>
                  <Badge variant={scoreVariant(lead.leadScore)}>{lead.leadScore}</Badge>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-zinc-500">Lead status</span>
                  <Badge variant={leadStatusMeta[lead.leadStatus].variant}>
                    {leadStatusMeta[lead.leadStatus].label}
                  </Badge>
                </div>
                <Link
                  href={`/leads/${lead.id}`}
                  className="mt-4 inline-block text-xs font-medium text-indigo-400 hover:text-indigo-300"
                >
                  View Lead →
                </Link>
              </>
            ) : (
              <p className="text-xs text-zinc-500">Deze demo heeft geen gekoppelde lead.</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Generation Information" subtitle="Mock — echte AI-generatie komt in een latere fase" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-300">Generation status</span>
              <Badge variant={generationStatusMeta[current.generationStatus].variant}>
                {generationStatusMeta[current.generationStatus].label}
              </Badge>
            </div>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                disabled
                title="AI-generatie komt in een latere fase"
                className="h-9 w-full cursor-not-allowed rounded-lg border border-zinc-800 bg-zinc-900 text-xs font-medium text-zinc-500"
              >
                Generate · komt in latere fase
              </button>
              <button
                type="button"
                disabled
                title="AI-generatie komt in een latere fase"
                className="h-9 w-full cursor-not-allowed rounded-lg border border-zinc-800 bg-zinc-900 text-xs font-medium text-zinc-500"
              >
                Regenerate · komt in latere fase
              </button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Preview" subtitle="Publieke demo-URL" />
            <code className="block truncate rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-indigo-300">
              /demo/{current.slug}
            </code>
            <div className="mt-3 flex items-center gap-2">
              {current.status === "ready" ? (
                <Link
                  href={current.previewUrl}
                  className="inline-flex h-9 items-center rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-indigo-500"
                >
                  Open preview
                </Link>
              ) : (
                <p className="text-xs text-zinc-500">Preview beschikbaar zodra de demo Ready is.</p>
              )}
              <CopyUrlButton slug={current.slug} className="h-9" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
