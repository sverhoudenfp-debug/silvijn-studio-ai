import Link from "next/link";
import type { QualityControl } from "@/lib/qc/types";
import type { GeneratedWebsite } from "@/lib/websites/types";

/**
 * QC-banner bovenop de websitepreview (Fase 10): toont de QC-status en
 * de route naar het volledige QC-rapport met de menselijke acties.
 */

const statusLabels: Record<string, { label: string; className: string }> = {
  generating: { label: "Genereren bezig", className: "bg-sky-50 text-sky-800 border-sky-200" },
  generated: { label: "Gegenereerd", className: "bg-sky-50 text-sky-800 border-sky-200" },
  building: { label: "Build/validatie bezig", className: "bg-sky-50 text-sky-800 border-sky-200" },
  ready_for_qc: { label: "READY FOR QC", className: "bg-amber-50 text-amber-800 border-amber-200" },
  qc_running: { label: "QC RUNNING", className: "bg-amber-50 text-amber-800 border-amber-200" },
  ready_for_silvijn: { label: "READY FOR SILVIJN", className: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  needs_revision: { label: "NEEDS REVISION", className: "bg-orange-50 text-orange-800 border-orange-200" },
  approved: { label: "APPROVED", className: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  failed: { label: "FAILED", className: "bg-red-50 text-red-800 border-red-200" },
  archived: { label: "Gearchiveerd", className: "bg-zinc-100 text-zinc-700 border-zinc-300" },
};

const resultLabels: Record<string, string> = {
  pass: "QC: PASS",
  needs_revision: "QC: NEEDS REVISION",
  fail: "QC: FAIL",
  blocked: "QC: BLOCKED",
};

export function QcBanner({ website, qc }: { website: GeneratedWebsite; qc: QualityControl | null }) {
  const status = statusLabels[website.status] ?? { label: website.status, className: "bg-zinc-100 text-zinc-700 border-zinc-300" };

  return (
    <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-2">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${status.className}`}>
            {status.label} · v{website.version}
          </span>
          {qc && (
            <span className="text-xs text-zinc-600">
              {resultLabels[qc.overallResult] ?? qc.overallResult} · score {qc.score}/100 ·{" "}
              {qc.status === "completed" ? "controle voltooid" : qc.status}
            </span>
          )}
          <span className="text-xs text-zinc-400">nog niet live — geen klantdelivery in deze fase</span>
        </div>
        <Link
          href={`/generated-websites/${website.slug}/qc`}
          className="text-xs font-semibold text-indigo-600 underline underline-offset-2 hover:text-indigo-500"
        >
          Bekijk QC-rapport
        </Link>
      </div>
    </div>
  );
}
