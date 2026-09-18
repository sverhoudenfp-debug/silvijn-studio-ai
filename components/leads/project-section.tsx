"use client";

import Link from "next/link";
import { canCreateProjectForLead } from "@/lib/leads/lifecycle";
import { useState } from "react";
import { createProjectAction } from "@/app/actions/projects";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { Project } from "@/lib/projects/types";

/**
 * Project-sectie op de lead-detailpagina (Fase 8). Een project ontstaat
 * ALLEEN via de expliciete "Create Project"-actie van de gebruiker —
 * de AI start nooit een project.
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

const priceStatusLabels: Record<string, string> = {
  not_calculated: "Nog niet berekend",
  ready: "Prijsindicatie klaar",
  missing_information: "Informatie ontbreekt",
  configuration_missing: "Pricing-configuratie ontbreekt",
  requires_human: "Menselijke beoordeling nodig",
  approved: "Prijs goedgekeurd (mens)",
  rejected: "Prijs afgewezen (mens)",
};

export function ProjectSection({
  leadId,
  leadBusinessName,
  leadStatus,
  project,
}: {
  leadId: string;
  leadBusinessName: string;
  leadStatus: string;
  project: Project | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const canCreate =
    !project && canCreateProjectForLead(leadStatus);

  async function createProject() {
    setError(null);
    setPending(true);
    try {
      await createProjectAction(leadId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Project aanmaken mislukt");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Project" subtitle={project ? `Gekoppeld aan ${leadBusinessName}` : "Projectmanagement (Fase 8)"} />
      {project ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={projectStatusMeta[project.status]?.variant ?? "neutral"}>
              {projectStatusMeta[project.status]?.label ?? project.status}
            </Badge>
            <span className="text-xs text-zinc-500">
              Prijsstatus: {priceStatusLabels[project.priceStatus] ?? project.priceStatus}
            </span>
          </div>
          {project.estimatedPrice != null && (
            <p className="text-sm text-zinc-300">
              Prijsindicatie:{" "}
              <span className="font-semibold text-zinc-50">
                € {project.estimatedPrice.toLocaleString("nl-NL", { minimumFractionDigits: 2 })}
              </span>{" "}
              <span className="text-xs text-zinc-500">(indicatie, pas bindend na menselijke goedkeuring)</span>
            </p>
          )}
          {project.priceStatus === "configuration_missing" && (
            <p className="text-xs text-amber-400">
              Pricing configuration is nog niet ingesteld — er is geen bedrag berekend of verzonnen.
            </p>
          )}
          <Link
            href={`/projects/${project.id}`}
            className="inline-flex h-9 items-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-500"
          >
            Naar project
          </Link>
        </div>
      ) : canCreate ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">
            Deze lead is gekwalificeerd ({leadStatus}) en kan worden omgezet in een project.
          </p>
          <button
            type="button"
            onClick={createProject}
            disabled={pending}
            className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-zinc-50 transition-colors hover:bg-indigo-500 disabled:opacity-60"
          >
            Create Project
          </button>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          Nog geen project. Project aanmaken is mogelijk zodra de lead de status website_interested of qualifying heeft (legacy qualified/interested/contacted blijven ondersteund)
          (huidig: {leadStatus}).
        </p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </Card>
  );
}
