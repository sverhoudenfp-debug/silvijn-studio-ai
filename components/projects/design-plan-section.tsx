"use client";

import { useState } from "react";
import { generateDesignPlanAction } from "@/app/actions/design-plans";
import type { DesignPlanRecord } from "@/lib/websites/design-plan";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";

/**
 * Design Plan-sectie op de projectpagina (Fase I.1).
 * INTERN werkdocument: doelen, doelgroep, navigatie, paginastructuur,
 * hiërarchie, branding, typografie, kleur, spacing, componenten, CTA,
 * beeld, responsive, animatie, functionaliteit, accessibility, SEO.
 * Nooit klantzichtbaar; geen lever-/publiceerpad.
 */

const statusMeta: Record<string, { label: string; variant: "info" | "success" | "danger" | "neutral" }> = {
  generating: { label: "Genereren bezig", variant: "info" },
  completed: { label: "Voltooid", variant: "success" },
  failed: { label: "Mislukt", variant: "danger" },
};

export function DesignPlanSection({
  projectId,
  projectStatus,
  plans,
}: {
  projectId: string;
  projectStatus: string;
  plans: DesignPlanRecord[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const latest = plans[0] ?? null;
  const canGenerate = projectStatus !== "cancelled" && projectStatus !== "completed";

  async function generate() {
    setError(null);
    setPending(true);
    try {
      // Verwachte productiefouten (AI-timeout, rate limit, consistentierejectie)
      // komen als { ok: false, error } terug — in productie maskeert React een
      // geserverde throw tot "Minified React error #441" en is de oorzaak weg.
      const result = await generateDesignPlanAction(projectId);
      if (!result.ok) setError(result.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Designplanning mislukt");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Design Plan (intern)"
        subtitle="AI plant het interne ontwerpplan; consistentiechecks (scope/prijsintegriteit, fabricatie-scan) zijn deterministisch — het plan is nooit klantzichtbaar"
      />
      {latest ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusMeta[latest.status]?.variant ?? "neutral"}>
              {statusMeta[latest.status]?.label ?? latest.status}
            </Badge>
            <span className="text-xs text-zinc-500">
              v{latest.version} · model: {latest.model || "onbekend"} · mode: {latest.mode}
            </span>
          </div>

          {latest.status === "completed" && latest.plan && (
            <div className="space-y-2.5 text-xs text-zinc-300">
              <p className="text-zinc-500">{latest.generationNotes}</p>
              {latest.plan.goals.primaryGoal && (
                <p>
                  <span className="font-semibold text-zinc-100">Primaire doel:</span> {latest.plan.goals.primaryGoal}
                </p>
              )}
              <div>
                <span className="font-semibold text-zinc-100">Paginastructuur</span>
                <ul className="mt-1 list-inside list-disc text-zinc-400">
                  {latest.plan.pageStructure.map((page) => (
                    <li key={page.key}>
                      <span className="text-zinc-200">{page.title ?? page.key}</span> — {page.purpose ?? "geen doel beschreven"}{" "}
                      ({page.sections.length} secties)
                    </li>
                  ))}
                </ul>
              </div>
              <p>
                <span className="font-semibold text-zinc-100">Navigatie:</span>{" "}
                {latest.plan.navigation.items.map((item) => item.label).join(" · ")}
              </p>
              {(latest.plan.colors.primary || latest.plan.colors.accent) && (
                <p>
                  <span className="font-semibold text-zinc-100">Kleuren:</span> primair {latest.plan.colors.primary ?? "—"},{" "}
                  accent {latest.plan.colors.accent ?? "—"}
                </p>
              )}
              {latest.plan.typography.pairing && (
                <p>
                  <span className="font-semibold text-zinc-100">Typografie:</span> {latest.plan.typography.pairing}
                </p>
              )}
              {latest.plan.ctaStrategy.primary && (
                <p>
                  <span className="font-semibold text-zinc-100">Primaire CTA:</span> {latest.plan.ctaStrategy.primary}
                </p>
              )}
              <p>
                <span className="font-semibold text-zinc-100">Componenten:</span> {latest.plan.components.length} gepland ·{" "}
                <span className="font-semibold text-zinc-100">Functionaliteit:</span>{" "}
                {latest.plan.functionality.features.length === 0
                  ? "geen extra functionaliteit gepland"
                  : latest.plan.functionality.features.map((f) => f.key).join(", ")}
              </p>
            </div>
          )}

          {latest.status === "failed" && latest.validationErrors.length > 0 && (
            <ul className="list-inside list-disc rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-xs text-red-200/80">
              {latest.validationErrors.slice(0, 5).map((validationError) => (
                <li key={validationError}>{validationError}</li>
              ))}
            </ul>
          )}

          {latest.missingInformation.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 p-3">
              <p className="text-xs font-semibold text-amber-200">Ontbrekende informatie ({latest.missingInformation.length}):</p>
              <ul className="mt-1 list-inside list-disc text-xs text-amber-200/80">
                {latest.missingInformation.slice(0, 8).map((missing) => (
                  <li key={missing}>{missing}</li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-amber-200/60">
                Expliciet doorgegeven aan de requirements-compleetheid — er wordt nooit gegokt.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={pending || !canGenerate}
              className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-zinc-50 transition-colors hover:bg-indigo-500 disabled:opacity-60"
            >
              {pending ? "Plannen..." : `Genereer Design Plan v${latest.version + 1}`}
            </button>
          </div>
          {plans.length > 1 && (
            <p className="text-xs text-zinc-500">
              {plans.length} versies bewaard — eerdere plannen blijven beschikbaar en worden nooit overschreven.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">
            Nog geen Design Plan. Generatie plant het interne ontwerp (doelen, doelgroep, structuur, branding, typografie,
            kleuren, componenten, CTA, responsive, animatie, accessibility, SEO) uit de bekende project- en
            questionnaire-informatie. Ontbrekende informatie wordt expliciet gemarkeerd.
          </p>
          <button
            type="button"
            onClick={generate}
            disabled={pending || !canGenerate}
            className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-zinc-50 transition-colors hover:bg-indigo-500 disabled:opacity-60"
          >
            {pending ? "Plannen..." : "Genereer Design Plan v1"}
          </button>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </Card>
  );
}
