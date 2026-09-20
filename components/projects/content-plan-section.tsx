"use client";

import { useMemo, useState } from "react";
import { generateContentPlanAction } from "@/app/actions/content-plans";
import type { ContentPlanRecord } from "@/lib/websites/content/content-plan-repository";
import type { DesignPlanRecord } from "@/lib/websites/design-plan";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";

/**
 * ContentPlan-sectie op de projectpagina (C3b) — INTERN werkdocument.
 * Per ContentPlan zichtbaar: status, pagina, sectie, content-unit met
 * status (generated/customer/merchant/fixed), evidence/bron en ontbrekende
 * klantinformatie. Nooit klantzichtbaar; géén lever-, Shopify- of
 * renderingpad — de consumptie volgt pas in C3d.
 */

const planStatusMeta: Record<string, { label: string; variant: "info" | "success" | "danger" | "neutral" }> = {
  draft: { label: "Bezig", variant: "info" },
  completed: { label: "Voltooid", variant: "success" },
  failed: { label: "Mislukt", variant: "danger" },
};

const unitStatusMeta: Record<string, { label: string; variant: "info" | "warning" | "neutral" | "success" }> = {
  generated: { label: "generated", variant: "info" },
  customer_slot: { label: "klant levert aan", variant: "warning" },
  merchant_slot: { label: "merchant-slot", variant: "neutral" },
  fixed: { label: "fixed (verbatim)", variant: "success" },
};

/** Groepeert units per pagina + sectiepad, met sectietype-lookup uit het plan. */
function UnitTable({ record }: { record: ContentPlanRecord }) {
  const plan = record.plan;
  if (!plan) return null;

  return (
    <div className="space-y-3">
      {plan.pages.map((page) => (
        <div key={page.key} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <p className="text-xs font-semibold text-zinc-100">
            Pagina <span className="font-mono text-zinc-400">{page.key}</span>
            {page.seo?.title != null && <span className="ml-2 font-normal text-zinc-500">SEO: {page.seo.title}</span>}
          </p>
          {(() => {
            const byPath = new Map<string, typeof page.units>();
            for (const unit of page.units) {
              const list = byPath.get(unit.path) ?? [];
              list.push(unit);
              byPath.set(unit.path, list);
            }
            return [...byPath.entries()].map(([path, units]) => (
              <div key={path} className="mt-2 rounded-md border border-zinc-800/70 p-2.5">
                <p className="text-[11px] font-medium text-zinc-400">
                  Sectie <span className="font-mono">{path}</span> · {units.length} unit(s)
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {units.map((unit, index) => {
                    const meta = unitStatusMeta[unit.status] ?? { label: unit.status, variant: "neutral" as const };
                    return (
                      <li key={`${unit.path}-${unit.kind}-${index}`} className="text-xs leading-relaxed">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                          <span className="font-mono text-[11px] text-zinc-400">{unit.kind}</span>
                          {unit.sourceOrigin && (
                            <span className="text-[11px] text-zinc-500">bron: {unit.sourceOrigin}</span>
                          )}
                        </div>
                        {unit.text && <p className="mt-1 whitespace-pre-wrap text-zinc-200">{unit.text}</p>}
                        {unit.status === "customer_slot" && unit.instruction && (
                          <p className="mt-1 text-amber-200/90">Klant levert aan: {unit.instruction}</p>
                        )}
                        {unit.evidence.length > 0 && (
                          <p className="mt-1 border-l-2 border-zinc-700 pl-2 text-[11px] text-zinc-500">
                            evidence: {unit.evidence.join(" | ").slice(0, 240)}
                            {unit.evidence.join(" | ").length > 240 ? "..." : ""}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ));
          })()}
        </div>
      ))}
    </div>
  );
}

export function ContentPlanSection({
  projectId,
  projectStatus,
  designPlans,
  contentPlans,
}: {
  projectId: string;
  projectStatus: string;
  designPlans: DesignPlanRecord[];
  contentPlans: ContentPlanRecord[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [upToDate, setUpToDate] = useState(false);
  const [pending, setPending] = useState(false);
  const [selectedDesignPlanId, setSelectedDesignPlanId] = useState<string | null>(null);

  const eligiblePlans = useMemo(
    () => designPlans.filter((p) => p.status === "completed" && p.plan?.blueprint),
    [designPlans]
  );

  const selectedDesignPlan = useMemo(
    () =>
      eligiblePlans.find((p) => p.id === selectedDesignPlanId) ??
      (selectedDesignPlanId === null ? eligiblePlans[0] ?? null : null),
    [eligiblePlans, selectedDesignPlanId]
  );

  const plansForSelected = useMemo(
    () =>
      selectedDesignPlan
        ? contentPlans.filter((c) => c.designPlanId === selectedDesignPlan.id)
        : [],
    [contentPlans, selectedDesignPlan]
  );

  const latest = plansForSelected[0] ?? null;
  const canGenerate = projectStatus !== "cancelled" && projectStatus !== "completed" && selectedDesignPlan != null;

  async function generate() {
    if (!selectedDesignPlan) return;
    setError(null);
    setUpToDate(false);
    setPending(true);
    try {
      // Verwachte productiefouten (AI-timeout, finalizer-rejectie, stale
      // fingerprint) komen als { ok: false, error } terug — geen React-mask.
      const result = await generateContentPlanAction(selectedDesignPlan.id);
      if (!result.ok) {
        setError(result.error);
        setUpToDate(result.upToDate === true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Contentpass mislukt");
    } finally {
      setPending(false);
    }
  }

  if (eligiblePlans.length === 0) {
    return (
      <Card>
        <CardHeader
          title="ContentPlan (intern)"
          subtitle="Nog geen completed Design Plan met blueprint — genereer eerst een Design Plan v2+ (blueprint); content vult uitsluitend de vaststaande sectie-architectuur in"
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={`ContentPlan (intern) — project ${projectId.slice(0, 8)}`}
        subtitle="Eén AI-contentpass per Design Plan-versie: commerciële copy uitsluitend evidence-gedragen, fact-locked bedrijfsfeiten verbatim uit bronnen, ontbrekende klantinformatie expliciet als klantinvoer — nooit klantzichtbaar, geen Shopify/rendering"
      />
      <div className="space-y-3">
        {eligiblePlans.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            Design Plan:
            <select
              value={selectedDesignPlan?.id ?? ""}
              onChange={(event) => {
                setSelectedDesignPlanId(event.target.value);
                setError(null);
                setUpToDate(false);
              }}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
            >
              {eligiblePlans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  v{plan.version} ({new Date(plan.createdAt).toLocaleDateString("nl-NL")})
                </option>
              ))}
            </select>
          </label>
        )}

        {latest ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={planStatusMeta[latest.status]?.variant ?? "neutral"}>
                {planStatusMeta[latest.status]?.label ?? latest.status}
              </Badge>
              <span className="text-xs text-zinc-500">
                v{latest.version} · model: {latest.model || "onbekend"} · mode: {latest.mode} · fingerprint:{" "}
                <span className="font-mono">{latest.sourceFingerprint.slice(0, 12)}</span>
              </span>
            </div>
            <p className="text-xs text-zinc-500">{latest.generationNotes}</p>

            {latest.status === "completed" && <UnitTable record={latest} />}

            {latest.status === "failed" && latest.validationErrors.length > 0 && (
              <ul className="list-inside list-disc rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-xs text-red-200/80">
                {latest.validationErrors.slice(0, 5).map((validationError) => (
                  <li key={validationError}>{validationError}</li>
                ))}
              </ul>
            )}

            {latest.missingInformation.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 p-3">
                <p className="text-xs font-semibold text-amber-200">
                  Ontbrekende klantinformatie ({latest.missingInformation.length}):
                </p>
                <ul className="mt-1 list-inside list-disc text-xs text-amber-200/80">
                  {latest.missingInformation.slice(0, 10).map((missing) => (
                    <li key={missing}>{missing}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={generate}
                disabled={pending || !canGenerate}
                className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-zinc-50 transition-colors hover:bg-indigo-500 disabled:opacity-60"
              >
                {pending ? "Content genereren..." : `Genereer ContentPlan v${latest.version + 1}`}
              </button>
            </div>
            {plansForSelected.length > 1 && (
              <p className="text-xs text-zinc-500">
                {plansForSelected.length} versies bewaard — her-generatie bij gewijzigde bronnen
                (nieuwe source-fingerprint); oude versies blijven ongewijzigd beschikbaar.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">
              Nog geen ContentPlan voor Design Plan
              {selectedDesignPlan ? ` v${selectedDesignPlan.version}` : ""}. De contentpass vult per
              sectie de commerciële copy in: evidence-gedragen, fact-locked verbatim, klantinvoer
              expliciet. Ontbrekende informatie wordt nooit gefabriceerd.
            </p>
            <button
              type="button"
              onClick={generate}
              disabled={pending || !canGenerate}
              className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-zinc-50 transition-colors hover:bg-indigo-500 disabled:opacity-60"
            >
              {pending ? "Content genereren..." : "Genereer ContentPlan v1"}
            </button>
          </div>
        )}
        {upToDate && error && <p className="text-xs text-emerald-300">{error}</p>}
        {!upToDate && error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </Card>
  );
}
