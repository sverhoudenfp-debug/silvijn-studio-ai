"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { generateWebsiteAction, runQualityControlAction } from "@/app/actions/websites";
import type { QualityControl } from "@/lib/qc/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { GeneratedWebsite } from "@/lib/websites/types";

/**
 * Website Generation-sectie op de projectpagina (Fase 9).
 * Generatie is een expliciete interne actie; de output eindigt bij
 * READY_FOR_QC — geen klantdelivery.
 */

const statusMeta: Record<string, { label: string; variant: "info" | "success" | "warning" | "danger" | "neutral" }> = {
  generating: { label: "Genereren bezig", variant: "info" },
  generated: { label: "Gegenereerd", variant: "info" },
  building: { label: "Build/validatie bezig", variant: "info" },
  ready_for_qc: { label: "READY FOR QC", variant: "warning" },
  failed: { label: "Mislukt", variant: "danger" },
  archived: { label: "Gearchiveerd", variant: "neutral" },
};

const buildMeta: Record<string, string> = {
  not_built: "niet gebuild",
  building: "build bezig",
  passed: "build geslaagd",
  failed: "build mislukt",
};

export function WebsiteGenerationSection({
  projectId,
  projectStatus,
  leadStatus,
  websites,
  latestQc,
}: {
  projectId: string;
  projectStatus: string;
  leadStatus: string;
  websites: GeneratedWebsite[];
  latestQc: QualityControl | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const latest = websites.find((w) => w.status !== "archived") ?? null;
  const canGenerate = projectStatus !== "cancelled" && projectStatus !== "completed";
  const canRunQc = latest ? ["ready_for_qc", "needs_revision"].includes(latest.status) : false;

  function runQc() {
    setError(null);
    startTransition(async () => {
      try {
        if (latest) await runQualityControlAction(latest.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Kwaliteitscontrole mislukt");
      }
    });
  }

  function generate() {
    setError(null);
    startTransition(async () => {
      try {
        await generateWebsiteAction(projectId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Generatie mislukt");
      }
    });
  }

  return (
    <Card>
      <CardHeader
        title="Website Generation"
        subtitle="AI plant, de deterministische generator bouwt via gecontroleerde componenten — output eindigt bij READY FOR QC"
      />
      {latest ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusMeta[latest.status]?.variant ?? "neutral"}>
              {statusMeta[latest.status]?.label ?? latest.status}
            </Badge>
            <span className="text-xs text-zinc-500">
              v{latest.version} · template: {latest.template} · build: {buildMeta[latest.buildStatus] ?? latest.buildStatus}
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            Gegenereerd op {new Date(latest.createdAt).toLocaleString("nl-NL")} · generatiestatus: {latest.generationStatus}
          </p>
          {latest.generationNotes && <p className="text-xs text-zinc-400">{latest.generationNotes}</p>}
          {latest.buildErrors.length > 0 && (
            <ul className="list-inside list-disc rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-xs text-red-200/80">
              {latest.buildErrors.slice(0, 4).map((buildError) => (
                <li key={buildError}>{buildError}</li>
              ))}
            </ul>
          )}
          {latestQc && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 text-xs text-zinc-300">
              <span className="font-semibold text-zinc-100">Quality Control:</span>{" "}
              {latestQc.status === "completed" ? latestQc.overallResult.toUpperCase() : latestQc.status} · score{" "}
              {latestQc.score}/100 · {latestQc.issues.filter((i) => i.severity === "critical").length} critical ·{" "}
              {latestQc.issues.filter((i) => i.severity === "warning").length} warning
              {latestQc.approval ? ` · laatste actie: ${latestQc.approval.action} (${latestQc.approval.by})` : ""}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/generated-websites/${latest.slug}`}
              className="inline-flex h-9 items-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-500"
            >
              Bekijk preview
            </Link>
            {latest && (
              <Link
                href={`/generated-websites/${latest.slug}/qc`}
                className="inline-flex h-9 items-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-500"
              >
                QC-rapport
              </Link>
            )}
            {canRunQc && (
              <button
                type="button"
                onClick={runQc}
                disabled={pending}
                className="h-9 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 text-xs font-semibold text-indigo-300 transition-colors hover:bg-indigo-500/20 disabled:opacity-60"
              >
                {pending ? "QC draait..." : "Run quality control"}
              </button>
            )}
            <button
              type="button"
              onClick={generate}
              disabled={pending || !canGenerate}
              className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-zinc-50 transition-colors hover:bg-indigo-500 disabled:opacity-60"
            >
              {pending ? "Genereren..." : "Genereer nieuwe versie"}
            </button>
          </div>
          {websites.length > 1 && (
            <p className="text-xs text-zinc-500">
              {websites.length} versies bewaard — oudere versies zijn gearchiveerd en terugvindbaar (niets verwijderd).
            </p>
          )}
        </div>
      ) : canGenerate ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">
            Nog geen website gegenereerd. Generatie is mogelijk bij een geschikte lead-status (huidig: {leadStatus}).
            Na generatie start de hybride kwaliteitscontrole via het QC-rapport; APPROVED kan alléén menselijk.
          </p>
          <button
            type="button"
            onClick={generate}
            disabled={pending}
            className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-zinc-50 transition-colors hover:bg-indigo-500 disabled:opacity-60"
          >
            {pending ? "Genereren..." : "Generate website"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          Websitegeneratie is niet mogelijk voor een {projectStatus === "cancelled" ? "geannuleerd" : "afgerond"} project.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </Card>
  );
}
