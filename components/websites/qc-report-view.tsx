"use client";

import Link from "next/link";
import { useState } from "react";
import {
  approveWebsiteAction,
  archiveWebsiteAction,
  requestWebsiteRevisionAction,
  runQualityControlAction,
} from "@/app/actions/websites";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { QC_CATEGORY_LABELS } from "@/lib/qc/types";
import type { QualityControl } from "@/lib/qc/types";
import type { GeneratedWebsite } from "@/lib/websites/types";

/**
 * QC-rapport + menselijke approval-flow (Fase 10).
 *
 * De AI analyseert en rapporteert; APPROVE / REQUEST REVISION / ARCHIVE
 * zijn uitsluitend menselijke acties via server actions. Approve vraagt
 * altijd expliciete bevestiging met de belangrijkste context.
 */

const resultMeta: Record<string, { label: string; variant: "success" | "warning" | "danger" | "neutral" }> = {
  pass: { label: "PASS — klaar voor beoordeling", variant: "success" },
  needs_revision: { label: "NEEDS REVISION", variant: "warning" },
  fail: { label: "FAIL", variant: "danger" },
  blocked: { label: "BLOCKED", variant: "neutral" },
};

const severityVariant: Record<string, "info" | "warning" | "danger" | "success"> = {
  info: "info",
  warning: "warning",
  error: "danger",
  critical: "danger",
};

function checkIcon(result: string): string {
  if (result === "passed") return "✓";
  if (result === "warning") return "!";
  if (result === "failed") return "✗";
  return "?";
}

export function QcReportView({ website, qc }: { website: GeneratedWebsite; qc: QualityControl | null }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [revisionReason, setRevisionReason] = useState("");
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);

  const criticalIssues = qc?.issues.filter((i) => i.severity === "critical") ?? [];
  const errorIssues = qc?.issues.filter((i) => i.severity === "error") ?? [];
  const warningIssues = qc?.issues.filter((i) => i.severity === "warning") ?? [];

  const canRunQc = ["ready_for_qc", "needs_revision"].includes(website.status);
  const canApprove = website.status === "ready_for_silvijn" && qc?.overallResult === "pass" && criticalIssues.length === 0;
  const canRequestRevision = ["ready_for_silvijn", "needs_revision"].includes(website.status);
  const canArchive = website.status !== "archived";

  async function withAction(action: () => Promise<unknown>) {
    setError(null);
    setPending(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Actie mislukt");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Quality Control</h2>
          <p className="mt-1 text-sm text-zinc-400">
            {website.businessName} · website v{website.version} · {qc ? `QC ${qc.id}` : "nog geen QC uitgevoerd"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/generated-websites/${website.slug}`}
            className="inline-flex h-9 items-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-indigo-500"
          >
            Open website
          </Link>
          <Link
            href={`/projects/${website.projectId}`}
            className="inline-flex h-9 items-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-indigo-500"
          >
            Naar project
          </Link>
        </div>
      </div>

      {!qc ? (
        <Card>
          <CardHeader
            title="Nog geen kwaliteitscontrole uitgevoerd"
            subtitle="De hybride QC (deterministische checks + adviserende AI-analyse) kan nu starten."
          />
          {canRunQc ? (
            <button
              type="button"
              onClick={() => withAction(() => runQualityControlAction(website.id))}
              disabled={pending}
              className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-zinc-50 transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-indigo-500"
            >
              {pending ? "Kwaliteitscontrole draait..." : "Run quality control"}
            </button>
          ) : (
            <p className="text-sm text-zinc-500">Deze website heeft status &quot;{website.status}&quot; — QC is nu niet mogelijk.</p>
          )}
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="Overall result" subtitle={`Status: ${qc.status} · interne indicator, geen commerciële prijs`} />
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight text-zinc-50">{qc.score}</span>
                <span className="text-xs font-medium text-zinc-500">/ 100</span>
              </div>
              <Badge variant={resultMeta[qc.overallResult]?.variant ?? "neutral"}>
                {resultMeta[qc.overallResult]?.label ?? qc.overallResult}
              </Badge>
              <span className="text-xs text-zinc-500">
                mode: {qc.mode} · model: {qc.model} · {new Date(qc.createdAt).toLocaleString("nl-NL")}
              </span>
            </div>
            {qc.approval && (
              <p className="mt-3 text-xs text-zinc-400">
                Laatste menselijke actie: <span className="font-semibold text-zinc-200">{qc.approval.action}</span> door {qc.approval.by} op{" "}
                {new Date(qc.approval.at).toLocaleString("nl-NL")}
                {qc.approval.reason ? ` — reden: ${qc.approval.reason}` : ""}
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="Checks" subtitle="9 categorieën — deterministische regels hebben prioriteit; de AI is adviserend" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {qc.checks.map((check) => (
                <div key={check.category} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      check.result === "passed"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : check.result === "warning"
                          ? "bg-amber-500/15 text-amber-400"
                          : check.result === "failed"
                            ? "bg-red-500/15 text-red-400"
                            : "bg-zinc-500/15 text-zinc-400"
                    }`}
                  >
                    {checkIcon(check.result)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">{QC_CATEGORY_LABELS[check.category]}</p>
                    <p className="text-xs text-zinc-500">
                      {check.result === "not_checked" ? "not checked" : check.result}
                      {check.issues.length > 0 ? ` · ${check.issues.length} issue(s)` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Issues"
              subtitle={`${criticalIssues.length} critical · ${errorIssues.length} error · ${warningIssues.length} warning`}
            />
            {qc.issues.length === 0 ? (
              <p className="text-sm text-zinc-400">Geen issues gevonden.</p>
            ) : (
              <ul className="space-y-2">
                {qc.issues.map((issue) => (
                  <li key={issue.id} className="flex flex-wrap items-start gap-2 text-sm">
                    <Badge variant={severityVariant[issue.severity] ?? "neutral"}>{issue.severity}</Badge>
                    <span className="min-w-0 flex-1 text-zinc-300">
                      <span className="text-xs text-zinc-500">[{QC_CATEGORY_LABELS[issue.category]} · {issue.rule}]</span>{" "}
                      {issue.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="AI summary" subtitle="Adviserend — de AI keurt nooit goed namens de agency" />
              <p className="text-sm leading-relaxed text-zinc-300">{qc.aiSummary || "Geen AI-samenvatting."}</p>
            </Card>
            <Card>
              <CardHeader title="Recommendations" subtitle={`${qc.recommendations.length} aanbeveling(en)`} />
              {qc.recommendations.length === 0 ? (
                <p className="text-sm text-zinc-400">Geen aanbevelingen.</p>
              ) : (
                <ul className="list-inside list-disc space-y-1.5 text-sm text-zinc-300">
                  {qc.recommendations.map((recommendation) => (
                    <li key={recommendation}>{recommendation}</li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Menselijke acties"
              subtitle="APPROVE / REQUEST REVISION / ARCHIVE — alleen Silvijn kan dit; er is geen automatische goedkeuring of levering"
            />
            <div className="flex flex-wrap gap-2">
              {canRunQc && (
                <button
                  type="button"
                  onClick={() => withAction(() => runQualityControlAction(website.id))}
                  disabled={pending}
                  className="h-9 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 text-xs font-semibold text-indigo-300 transition-colors hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-indigo-500"
                >
                  {pending ? "Kwaliteitscontrole draait..." : "Run quality control (opnieuw)"}
                </button>
              )}
              {canApprove && !confirmingApprove && (
                <button
                  type="button"
                  onClick={() => setConfirmingApprove(true)}
                  disabled={pending}
                  className="h-9 rounded-lg border border-emerald-500/40 bg-emerald-950/60 px-4 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-emerald-500"
                >
                  Approve website
                </button>
              )}
              {canRequestRevision && !showRevisionForm && (
                <button
                  type="button"
                  onClick={() => setShowRevisionForm(true)}
                  disabled={pending}
                  className="h-9 rounded-lg border border-amber-500/40 bg-amber-950/60 px-4 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-900/60 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-amber-500"
                >
                  Request revision
                </button>
              )}
              {canArchive && (
                <button
                  type="button"
                  onClick={() =>
                    withAction(async () => {
                      if (window.confirm(`Website v${website.version} archiveren? De versie blijft bewaard en terugvindbaar.`)) {
                        await archiveWebsiteAction(website.id);
                      }
                    })
                  }
                  disabled={pending}
                  className="h-9 rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-xs font-semibold text-zinc-400 transition-colors hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-indigo-500"
                >
                  Archive
                </button>
              )}
            </div>

            {confirmingApprove && (
              <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4">
                <p className="text-sm font-semibold text-emerald-300">Approve website versie {website.version}?</p>
                <ul className="mt-2 space-y-1 text-xs text-zinc-300">
                  <li>Bedrijf: {website.businessName}</li>
                  <li>Versie: v{website.version} (QC: {qc.id})</li>
                  <li>QC-resultaat: PASS · score {qc.score}/100</li>
                  <li>Critical issues: {criticalIssues.length}</li>
                  <li>Warnings: {warningIssues.length}</li>
                  <li className="text-zinc-500">
                    Goedkeuring betekent: website is door Silvijn goedgekeurd. Geen levering, geen publicatie, geen klantmail —
                    delivery volgt in een latere fase.
                  </li>
                </ul>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingApprove(false);
                      withAction(() => approveWebsiteAction(website.id));
                    }}
                    disabled={pending}
                    className="h-9 rounded-lg border border-emerald-500/40 bg-emerald-950/60 px-4 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-emerald-500"
                  >
                    {pending ? "Goedkeuren..." : "Ja, approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingApprove(false)}
                    className="h-9 rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-xs font-semibold text-zinc-300"
                  >
                    Annuleren
                  </button>
                </div>
              </div>
            )}

            {showRevisionForm && (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
                <p className="text-sm font-semibold text-amber-300">Revisie aanvragen voor v{website.version}</p>
                <p className="mt-1 text-xs text-zinc-400">
                  De bestaande versie blijft bewaard; na een nieuwe generatie ontstaat v{website.version + 1}. Niets wordt overschreven.
                </p>
                <textarea
                  value={revisionReason}
                  onChange={(e) => setRevisionReason(e.target.value)}
                  placeholder="Reden voor de revisie (verplicht, minimaal 5 tekens)"
                  rows={3}
                  className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500"
                />
                {qc.issues.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <p className="text-xs font-medium text-zinc-400">Selecteer issues die de revisie motiveren (optioneel):</p>
                    {qc.issues.slice(0, 8).map((issue) => (
                      <label key={issue.id} className="flex items-start gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={selectedIssues.includes(issue.id)}
                          onChange={(e) =>
                            setSelectedIssues((prev) => (e.target.checked ? [...prev, issue.id] : prev.filter((id) => id !== issue.id)))
                          }
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1">[{issue.severity}] {issue.message}</span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      withAction(async () => {
                        await requestWebsiteRevisionAction(website.id, revisionReason, { selectedIssueIds: selectedIssues });
                        setShowRevisionForm(false);
                        setRevisionReason("");
                        setSelectedIssues([]);
                      })
                    }
                    disabled={pending || revisionReason.trim().length < 5}
                    className="h-9 rounded-lg bg-amber-600 px-4 text-xs font-semibold text-zinc-50 transition-colors hover:bg-amber-500 disabled:opacity-50"
                  >
                    {pending ? "Versturen..." : "Revisie aanvragen"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowRevisionForm(false)}
                    className="h-9 rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-xs font-semibold text-zinc-300"
                  >
                    Annuleren
                  </button>
                </div>
              </div>
            )}
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          </Card>
        </>
      )}
    </div>
  );
}
