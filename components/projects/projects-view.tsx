import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { Project } from "@/lib/projects/types";

/**
 * Projects-overzicht (Fase 8) — echte repository-data, geen nepstatistieken
 * of fictieve bedragen (de oude shell met verzonnen prijzen is vervangen).
 */

const projectStatusMeta: Record<string, { label: string; variant: "info" | "success" | "warning" | "neutral" }> = {
  quotation_pending: { label: "Offerte in voorbereiding", variant: "neutral" },
  price_ready: { label: "Prijsindicatie klaar", variant: "info" },
  awaiting_approval: { label: "Wacht op goedkeuring", variant: "warning" },
  approved: { label: "Goedgekeurd", variant: "success" },
  in_progress: { label: "In ontwikkeling", variant: "info" },
  ready_for_review: { label: "Klaar voor review", variant: "info" },
  completed: { label: "Afgerond", variant: "success" },
  cancelled: { label: "Geannuleerd", variant: "neutral" },
};

const priceStatusMeta: Record<string, string> = {
  not_calculated: "Nog niet berekend",
  calculating: "Berekenen...",
  ready: "Indicatie klaar",
  missing_information: "Informatie ontbreekt",
  configuration_missing: "Configuratie ontbreekt",
  requires_human: "Menselijke beoordeling",
  approved: "Prijs goedgekeurd",
  rejected: "Prijs afgewezen",
};

export function ProjectsView({
  projects,
  leadNames,
}: {
  projects: Project[];
  leadNames: Record<string, string>;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Projects</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Projecten uit gekwalificeerde leads. Prijsindicaties komen uitsluitend uit de centrale prijsconfiguratie —
          de AI bedenkt nooit bedragen.
        </p>
      </div>

      {projects.length === 0 ? (
        <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-400">
          Nog geen projecten. Open een gekwalificeerde lead en gebruik &quot;Create Project&quot;.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/60 text-left text-xs text-zinc-400">
                <th className="px-3 py-2.5 font-medium">Project</th>
                <th className="px-3 py-2.5 font-medium">Lead</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Prijsstatus</th>
                <th className="px-3 py-2.5 font-medium">Timeline</th>
                <th className="px-3 py-2.5 font-medium">Bijgewerkt</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id} className="border-b border-zinc-800/60 last:border-0">
                  <td className="px-3 py-2.5">
                    <Link href={`/projects/${project.id}`} className="font-medium text-zinc-100 hover:text-indigo-400">
                      {project.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-zinc-300">
                    <Link href={`/leads/${project.leadId}`} className="hover:text-indigo-400">
                      {leadNames[project.leadId] ?? project.leadId}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant={projectStatusMeta[project.status]?.variant ?? "neutral"}>
                      {projectStatusMeta[project.status]?.label ?? project.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-zinc-300">{project.projectType ?? "—"}</td>
                  <td className="px-3 py-2.5 text-zinc-300">{priceStatusMeta[project.priceStatus] ?? project.priceStatus}</td>
                  <td className="px-3 py-2.5 text-zinc-300">{project.timeline ?? "—"}</td>
                  <td className="px-3 py-2.5 text-zinc-500">
                    {new Date(project.updatedAt).toLocaleDateString("nl-NL")}
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
