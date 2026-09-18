"use client";

import { useState } from "react";
import {
  evaluateRequirementsCompletenessAction,
  markRequirementsIncompleteAction,
} from "@/app/actions/projects";
import type { CompletenessEvaluation } from "@/lib/projects/completeness";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";

/**
 * Requirements-completeness-sectie op de projectpagina (Fase I.1).
 * DETERMINISTISCH: dezelfde zes blokkerende checks als de SQL-functie
 * evaluate_project_requirements_complete. requirements_complete kan
 * uitsluitend via de owner-RPC set_project_requirements_complete; de
 * productie-gate (prijs, betaling, scope) blijft volledig onaangeroerd.
 */

export function RequirementsCompletenessSection({
  projectId,
  requirementsComplete,
  evaluation,
}: {
  projectId: string;
  requirementsComplete: boolean;
  evaluation: CompletenessEvaluation;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState(false);
  const [result, setResult] = useState<{ evaluation: CompletenessEvaluation; requirementsComplete: boolean } | null>(null);

  const current = result ?? { evaluation, requirementsComplete };

  async function evaluate() {
    setError(null);
    setPending(true);
    try {
      setResult(await evaluateRequirementsCompletenessAction(projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Beoordeling mislukt");
    } finally {
      setPending(false);
    }
  }

  async function revoke() {
    setError(null);
    setPendingRevoke(true);
    try {
      await markRequirementsIncompleteAction(projectId, "Compleetheid door de eigenaar ingetrokken");
      setResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Intrekken mislukt");
    } finally {
      setPendingRevoke(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Requirements-compleetheid"
        subtitle="Deterministische beoordeling: requirements_complete kan alléén via een geslaagde, geauditeerde owner-actie — de productie-gate blijft onverkort dicht zonder goedgekeurde prijs én bevestigde betaling"
      />
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={current.requirementsComplete ? "success" : current.evaluation.complete ? "warning" : "danger"}>
            {current.requirementsComplete ? "Compleet (geverifieerd)" : current.evaluation.complete ? "Informatie voldoende — nog niet gemarkeerd" : "Informatie onvoldoende"}
          </Badge>
          {current.evaluation.blockingMissing.length > 0 && (
            <span className="text-xs text-zinc-500">
              {current.evaluation.blockingMissing.length} blokkerende punt(en)
            </span>
          )}
        </div>

        <ul className="space-y-1.5">
          {current.evaluation.checks.map((check) => (
            <li key={check.key} className="flex items-start gap-2 text-xs">
              <span className={check.passed ? "text-emerald-400" : "text-red-400"}>{check.passed ? "✓" : "✗"}</span>
              <span className="text-zinc-300">
                <span className="font-semibold text-zinc-100">{check.label}:</span> {check.detail}
              </span>
            </li>
          ))}
        </ul>

        {current.evaluation.attention.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 p-3">
            <p className="text-xs font-semibold text-amber-200">Aandachtspunten (niet blokkerend):</p>
            <ul className="mt-1 list-inside list-disc text-xs text-amber-200/80">
              {current.evaluation.attention.map((attention) => (
                <li key={attention}>{attention}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={evaluate}
            disabled={pending}
            className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-zinc-50 transition-colors hover:bg-indigo-500 disabled:opacity-60"
          >
            {pending ? "Beoordelen..." : "Compleetheid beoordelen"}
          </button>
          {current.requirementsComplete && (
            <button
              type="button"
              onClick={revoke}
              disabled={pendingRevoke}
              className="h-9 rounded-lg border border-red-500/40 bg-red-500/10 px-4 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-60"
            >
              {pendingRevoke ? "Intrekken..." : "Compleetheid intrekken"}
            </button>
          )}
        </div>
      </div>
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </Card>
  );
}
