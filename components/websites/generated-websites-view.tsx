import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { GeneratedWebsite } from "@/lib/websites/types";

/**
 * Generated websites-overzicht (Fase 9/10) — echte repository-data, geen
 * fake cijfers; lege state zodra er nog niets gegenereerd is.
 */

const statusMeta: Record<string, { label: string; variant: "info" | "success" | "warning" | "neutral" }> = {
  generating: { label: "Genereren bezig", variant: "info" },
  generated: { label: "Gegenereerd", variant: "info" },
  building: { label: "Build/validatie bezig", variant: "info" },
  ready_for_qc: { label: "READY FOR QC", variant: "info" },
  qc_running: { label: "QC RUNNING", variant: "info" },
  ready_for_silvijn: { label: "READY FOR SILVIJN", variant: "warning" },
  needs_revision: { label: "NEEDS REVISION", variant: "warning" },
  approved: { label: "APPROVED", variant: "success" },
  failed: { label: "Mislukt", variant: "neutral" },
  archived: { label: "Gearchiveerd (oudere versie)", variant: "neutral" },
};

const buildMeta: Record<string, string> = {
  not_built: "Niet gebuild",
  building: "Build bezig",
  passed: "Build geslaagd",
  failed: "Build mislukt",
};

function StatTile({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="text-xs font-medium text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-50">{count}</p>
    </div>
  );
}

export function GeneratedWebsitesView({
  websites,
  projectNames,
}: {
  websites: GeneratedWebsite[];
  projectNames: Record<string, string>;
}) {
  const active = websites.filter((w) => w.status !== "archived");
  const generating = active.filter((w) => ["generating", "generated", "building"].includes(w.status));
  const readyForQc = active.filter((w) => w.status === "ready_for_qc");
  const qcRunning = active.filter((w) => w.status === "qc_running");
  const needsRevision = active.filter((w) => w.status === "needs_revision");
  const readyForSilvijn = active.filter((w) => w.status === "ready_for_silvijn");
  const approved = active.filter((w) => w.status === "approved");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Websites</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Gegenereerde klantwebsites met hybride kwaliteitscontrole — APPROVED is uitsluitend een menselijke beslissing;
          delivery volgt in een latere fase.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <StatTile label="Totaal (actief)" count={active.length} />
        <StatTile label="Genereren" count={generating.length} />
        <StatTile label="Ready voor QC" count={readyForQc.length} />
        <StatTile label="QC running" count={qcRunning.length} />
        <StatTile label="Needs revision" count={needsRevision.length} />
        <StatTile label="Approved" count={approved.length} />
      </div>
      {readyForSilvijn.length > 0 && (
        <p className="text-xs text-emerald-400">
          {readyForSilvijn.length} website(s) wachten op menselijke beoordeling (READY FOR SILVIJN) — goedkeuring via het QC-rapport.
        </p>
      )}

      {websites.length === 0 ? (
        <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-400">
          Nog geen websites gegenereerd. Open een project (van een gekwalificeerde lead) en gebruik
          &quot;Generate website&quot;.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/60 text-left text-xs text-zinc-400">
                <th className="px-3 py-2.5 font-medium">Bedrijf</th>
                <th className="px-3 py-2.5 font-medium">Project</th>
                <th className="px-3 py-2.5 font-medium">Template</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Build</th>
                <th className="px-3 py-2.5 font-medium">Versie</th>
                <th className="px-3 py-2.5 font-medium">Preview</th>
                <th className="px-3 py-2.5 font-medium">QC-rapport</th>
                <th className="px-3 py-2.5 font-medium">Gegenereerd</th>
              </tr>
            </thead>
            <tbody>
              {websites.map((website) => (
                <tr key={website.id} className="border-b border-zinc-800/60 last:border-0">
                  <td className="px-3 py-2.5 font-medium text-zinc-100">{website.businessName}</td>
                  <td className="px-3 py-2.5">
                    <Link href={`/projects/${website.projectId}`} className="text-zinc-300 hover:text-indigo-400">
                      {projectNames[website.projectId] ?? website.projectId}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-zinc-300">{website.template}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant={statusMeta[website.status]?.variant ?? "neutral"}>
                      {statusMeta[website.status]?.label ?? website.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-zinc-300">{buildMeta[website.buildStatus] ?? website.buildStatus}</td>
                  <td className="px-3 py-2.5 text-zinc-300">v{website.version}</td>
                  <td className="px-3 py-2.5">
                    <Link href={`/generated-websites/${website.slug}`} className="text-indigo-400 hover:text-indigo-300">
                      Preview
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/generated-websites/${website.slug}/qc`} className="text-indigo-400 hover:text-indigo-300">
                      QC
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-zinc-500">
                    {new Date(website.createdAt).toLocaleDateString("nl-NL")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
