"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  approvePriceAction,
  calculatePriceAction,
  listIndicationsAction,
  proposeRequirementsAction,
  rejectPriceAction,
  sendToSilvijnAction,
  updateProjectStatusAction,
  updateRequirementsAction,
} from "@/app/actions/projects";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { Project, ProjectStatus } from "@/lib/projects/types";
import { fromFormState, toFormState, type RequirementsFormState } from "@/lib/projects/requirements-form";
import type { PriceIndication } from "@/lib/pricing/types";
import { WebsiteGenerationSection } from "@/components/projects/website-generation-section";
import { DesignPlanSection } from "@/components/projects/design-plan-section";
import { RequirementsCompletenessSection } from "@/components/projects/requirements-completeness-section";
import type { DesignPlanRecord } from "@/lib/websites/design-plan";
import type { CompletenessEvaluation } from "@/lib/projects/completeness";
import type { GeneratedWebsite } from "@/lib/websites/types";
import type { QualityControl } from "@/lib/qc/types";

/**
 * Project-detail (Fase 8). Requirements en prijsindicaties zijn altijd
 * CONCEPT: de AI berekent nooit de prijs (deterministische PricingEngine),
 * en een indicatie wordt eerst door een mens goedgekeurd. "Send to Silvijn"
 * is intern escaleren — er bestaat géén klantcommunicatie in deze fase.
 */

const projectStatusMeta: Record<ProjectStatus, { label: string; variant: "info" | "success" | "warning" | "neutral" }> = {
  quotation_pending: { label: "Offerte in voorbereiding", variant: "neutral" },
  price_ready: { label: "Prijsindicatie klaar", variant: "info" },
  awaiting_approval: { label: "READY FOR SILVIJN — wacht op goedkeuring", variant: "warning" },
  approved: { label: "Goedgekeurd", variant: "success" },
  in_progress: { label: "In ontwikkeling", variant: "info" },
  ready_for_review: { label: "Klaar voor review", variant: "info" },
  completed: { label: "Afgerond", variant: "success" },
  cancelled: { label: "Geannuleerd", variant: "neutral" },
};

const priceStatusMeta: Record<string, { label: string; variant: "info" | "success" | "warning" | "neutral" }> = {
  not_calculated: { label: "Nog niet berekend", variant: "neutral" },
  calculating: { label: "Berekenen...", variant: "info" },
  ready: { label: "Prijsindicatie klaar", variant: "info" },
  missing_information: { label: "Informatie ontbreekt", variant: "warning" },
  configuration_missing: { label: "PRICING CONFIGURATION MISSING", variant: "warning" },
  requires_human: { label: "Menselijke beoordeling nodig", variant: "warning" },
  approved: { label: "Prijs goedgekeurd (mens)", variant: "success" },
  rejected: { label: "Prijs afgewezen (mens)", variant: "neutral" },
};

const buttonClass = "h-9 rounded-lg px-4 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-indigo-500";
const inputClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none";

function euro(amount: number): string {
  return `€ ${amount.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ProjectDetail({
  project,
  lead,
  latestQualification,
  websites,
  latestQc,
  designPlans,
  completeness,
}: {
  project: Project;
  lead: { id: string; businessName: string; leadScore: number; leadStatus: string; industry: string; city: string } | null;
  latestQualification: { status: string; interestLevel: string; projectType: string | null; timeline: string | null; missingInformation: string[] } | null;
  websites: GeneratedWebsite[];
  latestQc: QualityControl | null;
  designPlans: DesignPlanRecord[];
  completeness: CompletenessEvaluation;
}) {
  const [form, setForm] = useState<RequirementsFormState>(toFormState(project.requirements));
  const [indications, setIndications] = useState<PriceIndication[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aiInfo, setAiInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const refreshIndications = useCallback(async (projectId: string) => {
    setIndications(await listIndicationsAction(projectId));
  }, []);

  useEffect(() => {
    let active = true;
    listIndicationsAction(project.id)
      .then((list) => {
        if (active) setIndications(list);
      })
      .catch(() => {
        if (active) setError("Prijsindicaties konden niet worden geladen");
      });
    return () => {
      active = false;
    };
  }, [project.id]);

  const latest = indications[0] ?? null;

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setPending(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Actie mislukt");
    } finally {
      setPending(false);
    }
  }

  const saveRequirements = () =>
    run(async () => {
      // Merge op de huidige requirements: velden zonder formulier-UI
      // (o.a. responsive, integrations) blijven exact behouden en een
      // save zonder inhoudelijke wijziging wijzigt de JSONB niet.
      const next = fromFormState(form, project.requirements);
      await updateRequirementsAction(project.id, next);
    });

  const proposeRequirements = () =>
    run(async () => {
      const result = await proposeRequirementsAction(project.id);
      setForm(toFormState(result.project.requirements));
      setAiInfo(
        `AI-voorstel toegepast (model: ${result.model}, mode: ${result.mode}, confidence ${Math.round(result.confidence * 100)}%). ` +
          `Ontbrekend volgens de AI: ${result.missingInformation.slice(0, 2).join(" ")} — bestaande waarden zijn behouden; controleer en vul aan.`
      );
    });

  const calculatePrice = () =>
    run(async () => {
      await calculatePriceAction(project.id);
      await refreshIndications(project.id);
    });

  const selectClass = "h-9 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-200";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">{project.name}</h2>
        <p className="mt-1 text-sm text-zinc-400">Project voor lead {lead?.businessName ?? project.leadId}</p>
      </div>
      {/* ===== PROJECT INFORMATION ===== */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={projectStatusMeta[project.status].variant}>{projectStatusMeta[project.status].label}</Badge>
          <Badge variant={priceStatusMeta[project.priceStatus]?.variant ?? "neutral"}>
            {priceStatusMeta[project.priceStatus]?.label ?? project.priceStatus}
          </Badge>
          {project.projectType && <span className="text-xs text-zinc-500">Type: {project.projectType}</span>}
          {project.timeline && <span className="text-xs text-zinc-500">Timeline: {project.timeline}</span>}
        </div>
        <p className="mt-3 text-sm text-zinc-400">{project.description}</p>
        <p className="mt-2 text-xs text-zinc-500">
          Aangemaakt {new Date(project.createdAt).toLocaleDateString("nl-NL")} · Bijgewerkt{" "}
          {new Date(project.updatedAt).toLocaleDateString("nl-NL")}
        </p>
      </Card>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* ===== LEAD + SALES CONTEXT ===== */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="Lead" subtitle="Bron van dit project" />
          {lead ? (
            <div className="space-y-2 text-sm text-zinc-300">
              <p>
                <Link href={`/leads/${lead.id}`} className="font-medium text-zinc-100 hover:text-indigo-400">
                  {lead.businessName}
                </Link>{" "}
                <span className="text-zinc-500">· {lead.industry}, {lead.city}</span>
              </p>
              <p className="text-zinc-400">
                Lead score: {lead.leadScore} · status: {lead.leadStatus}
              </p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Lead niet gevonden.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Sales context" subtitle="Laatste AI-kwalificatie" />
          {latestQualification ? (
            <div className="space-y-2 text-sm text-zinc-300">
              <p>
                Kwalificatie: <span className="text-zinc-100">{latestQualification.status}</span> · interesse:{" "}
                {latestQualification.interestLevel}
                {latestQualification.projectType ? ` · projecttype: ${latestQualification.projectType}` : ""}
              </p>
              {latestQualification.missingInformation.length > 0 && (
                <ul className="list-inside list-disc text-xs text-zinc-500">
                  {latestQualification.missingInformation.slice(0, 3).map((info) => (
                    <li key={info}>{info}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Nog geen sales-kwalificatie voor deze lead.</p>
          )}
        </Card>
      </div>

      {/* ===== REQUIREMENTS ===== */}
      <Card>
        <CardHeader
          title="Requirements"
          subtitle="Alle velden optioneel — onbekend blijft onbekend (nooit gokken)"
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1 text-xs text-zinc-500">
            Type website
            <input value={form.websiteType} onChange={(e) => setForm((f) => ({ ...f, websiteType: e.target.value }))} placeholder="bijv. business_website / webshop" className={inputClass} />
          </label>
          <label className="space-y-1 text-xs text-zinc-500">
            Aantal pagina&apos;s
            <input value={form.numberOfPages} onChange={(e) => setForm((f) => ({ ...f, numberOfPages: e.target.value }))} placeholder="bijv. 5" inputMode="numeric" className={inputClass} />
          </label>
          <label className="space-y-1 text-xs text-zinc-500">
            Designniveau
            <input value={form.designLevel} onChange={(e) => setForm((f) => ({ ...f, designLevel: e.target.value }))} placeholder="basic / standard / premium" className={inputClass} />
          </label>
          <label className="space-y-1 text-xs text-zinc-500">
            Responsive
            <select value={form.responsive} onChange={(e) => setForm((f) => ({ ...f, responsive: e.target.value }))} className={selectClass}>
              <option value="unknown">Onbekend</option>
              <option value="true">Ja</option>
              <option value="false">Nee</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-zinc-500">
            E-commerce
            <select value={form.ecommerce} onChange={(e) => setForm((f) => ({ ...f, ecommerce: e.target.value }))} className={selectClass}>
              <option value="unknown">Onbekend</option>
              <option value="true">Ja</option>
              <option value="false">Nee</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-zinc-500">
            CMS
            <select value={form.cms} onChange={(e) => setForm((f) => ({ ...f, cms: e.target.value }))} className={selectClass}>
              <option value="unknown">Onbekend</option>
              <option value="true">Ja</option>
              <option value="false">Nee</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-zinc-500">
            SEO
            <select value={form.seo} onChange={(e) => setForm((f) => ({ ...f, seo: e.target.value }))} className={selectClass}>
              <option value="unknown">Onbekend</option>
              <option value="true">Ja</option>
              <option value="false">Nee</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-zinc-500">
            Tekstschrijving
            <select value={form.copywriting} onChange={(e) => setForm((f) => ({ ...f, copywriting: e.target.value }))} className={selectClass}>
              <option value="unknown">Onbekend</option>
              <option value="true">Ja</option>
              <option value="false">Nee</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-zinc-500">
            Hosting
            <select value={form.hosting} onChange={(e) => setForm((f) => ({ ...f, hosting: e.target.value }))} className={selectClass}>
              <option value="unknown">Onbekend</option>
              <option value="true">Ja</option>
              <option value="false">Nee</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-zinc-500">
            Onderhoud
            <select value={form.maintenance} onChange={(e) => setForm((f) => ({ ...f, maintenance: e.target.value }))} className={selectClass}>
              <option value="unknown">Onbekend</option>
              <option value="true">Ja</option>
              <option value="false">Nee</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-zinc-500">
            Deadline / timeline
            <input value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} placeholder="bijv. Q4 2026" className={inputClass} />
          </label>
          <label className="space-y-1 text-xs text-zinc-500 sm:col-span-2">
            Custom functionaliteit / integraties
            <input value={form.customFunctionality} onChange={(e) => setForm((f) => ({ ...f, customFunctionality: e.target.value }))} placeholder="bijv. koppeling boekhoudsysteem (optioneel)" className={inputClass} />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={saveRequirements} disabled={pending} className={`${buttonClass} border border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500`}>
            Update Requirements
          </button>
          <button type="button" onClick={proposeRequirements} disabled={pending} className={`${buttonClass} bg-indigo-600 text-zinc-50 hover:bg-indigo-500`}>
            AI: requirements voorstellen
          </button>
        </div>
        {aiInfo && <p className="mt-3 text-xs text-zinc-500">{aiInfo}</p>}
      </Card>

      {/* ===== PRICING ===== */}
      <Card>
        <CardHeader
          title="Pricing"
          subtitle="Deterministische PricingEngine — de AI berekent nooit de prijs; bedragen komen uitsluitend uit de prijsconfiguratie"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={calculatePrice} disabled={pending} className={`${buttonClass} bg-indigo-600 text-zinc-50 hover:bg-indigo-500`}>
            Calculate Price
          </button>
          {project.status === "price_ready" && (
            <button type="button" onClick={() => run(() => sendToSilvijnAction(project.id))} disabled={pending} className={`${buttonClass} border border-amber-500/40 bg-amber-950/60 text-amber-300 hover:bg-amber-900/60`}>
              Send to Silvijn
            </button>
          )}
          {(project.priceStatus === "ready" || project.priceStatus === "requires_human") && (
            <>
              <button type="button" onClick={() => run(() => approvePriceAction(project.id))} disabled={pending} className={`${buttonClass} border border-emerald-500/40 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/60`}>
                Prijsindicatie goedkeuren (mens)
              </button>
              <button type="button" onClick={() => run(() => rejectPriceAction(project.id))} disabled={pending} className={`${buttonClass} border border-red-500/40 bg-red-950/60 text-red-300 hover:bg-red-900/60`}>
                Prijsindicatie afwijzen (mens)
              </button>
            </>
          )}
          {project.status === "approved" && (
            <button type="button" onClick={() => run(() => updateProjectStatusAction(project.id, "in_progress"))} disabled={pending} className={`${buttonClass} bg-indigo-600 text-zinc-50 hover:bg-indigo-500`}>
              Project starten (mens)
            </button>
          )}
          {project.status === "in_progress" && (
            <button type="button" onClick={() => run(() => updateProjectStatusAction(project.id, "ready_for_review"))} disabled={pending} className={`${buttonClass} border border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500`}>
              Klaar voor review (mens)
            </button>
          )}
          {project.status === "ready_for_review" && (
            <button type="button" onClick={() => run(() => updateProjectStatusAction(project.id, "completed"))} disabled={pending} className={`${buttonClass} border border-emerald-500/40 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/60`}>
              Afronden (mens)
            </button>
          )}
          {project.status !== "cancelled" && project.status !== "completed" && (
            <button type="button" onClick={() => run(() => updateProjectStatusAction(project.id, "cancelled"))} disabled={pending} className={`${buttonClass} border border-zinc-700 text-zinc-400 hover:border-zinc-500`}>
              Annuleren (mens)
            </button>
          )}
        </div>

        <div className="mt-5">
          {!latest ? (
            <p className="text-sm text-zinc-500">
              Nog geen prijsindicatie berekend. Vul de requirements in en gebruik &quot;Calculate Price&quot;.
            </p>
          ) : latest.status === "configuration_missing" ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-4">
              <p className="text-sm font-semibold text-amber-300">Pricing configuration is nog niet ingesteld.</p>
              <p className="mt-1 text-xs text-amber-200/80">
                Er is geen bedrag berekend en er wordt géén bedrag verzonnen. Zodra de Master Configuration is
                ingevuld, berekent de PricingEngine automatisch een uitlegbare indicatie.
              </p>
              {latest.escalationReasons.length > 0 && (
                <p className="mt-2 text-xs text-amber-300">READY FOR SILVIJN — {latest.escalationReasons[0]}</p>
              )}
            </div>
          ) : (
            <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Price indication — geen definitieve offerte
                </p>
                <div className="flex items-center gap-2">
                  <Badge variant="warning">AI CALCULATED</Badge>
                  {latest.requiresHuman && <Badge variant="warning">READY FOR SILVIJN</Badge>}
                  <span className="text-xs text-zinc-500">versie: {latest.pricingVersion}</span>
                </div>
              </div>

              {latest.status === "missing_information" ? (
                <p className="text-sm text-zinc-300">
                  Er kan nog geen betrouwbare prijsindicatie worden gemaakt:
                </p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {latest.lineItems.map((item) => (
                      <tr key={item.key} className="border-b border-zinc-800/60 last:border-0">
                        <td className="py-2">
                          <p className="text-zinc-100">{item.label}</p>
                          <p className="text-xs text-zinc-500">{item.explanation}</p>
                        </td>
                        <td className="py-2 text-right text-zinc-100">{euro(item.amount)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-zinc-700">
                      <td className="py-2 text-zinc-400">Subtotaal</td>
                      <td className="py-2 text-right text-zinc-200">{euro(latest.subtotal)}</td>
                    </tr>
                    {latest.tax > 0 && (
                      <tr>
                        <td className="py-2 text-zinc-400">Btw</td>
                        <td className="py-2 text-right text-zinc-200">{euro(latest.tax)}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="py-2 font-semibold text-zinc-50">
                        Totale indicatie{latest.priceRange ? " (indicatief)" : ""}
                      </td>
                      <td className="py-2 text-right font-semibold text-zinc-50">
                        {latest.priceRange
                          ? `${euro(latest.priceRange.min)} – ${euro(latest.priceRange.max)}`
                          : euro(latest.total)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}

              {latest.missingInformation.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-amber-400">Ontbrekende informatie:</p>
                  <ul className="mt-1 list-inside list-disc text-xs text-zinc-400">
                    {latest.missingInformation.map((info) => (
                      <li key={info}>{info}</li>
                    ))}
                  </ul>
                </div>
              )}

              {latest.assumptions.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-400">Aannames:</p>
                  <ul className="mt-1 list-inside list-disc text-xs text-zinc-500">
                    {latest.assumptions.map((assumption) => (
                      <li key={assumption}>{assumption}</li>
                    ))}
                  </ul>
                </div>
              )}

              {latest.escalationReasons.length > 0 && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3">
                  <p className="text-xs font-semibold text-amber-300">READY FOR SILVIJN:</p>
                  <ul className="mt-1 list-inside list-disc text-xs text-amber-200/80">
                    {latest.escalationReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-xs text-zinc-500">
                Berekend op {new Date(latest.calculatedAt).toLocaleString("nl-NL")} · pricing versie {latest.pricingVersion} ·
                een AI-berekende indicatie is pas bindend na menselijke goedkeuring.
              </p>
            </div>
          )}
        </div>

        {indications.length > 1 && (
          <p className="mt-3 text-xs text-zinc-500">
            {indications.length} prijsindicaties in de historie — oudere indicaties blijven bewaard met hun eigen
            pricing-versie en worden nooit stilzwijgend overschreven.
          </p>
        )}
      </Card>

      {/* ===== FASE I.1: REQUIREMENTS-COMPLEETHEID + DESIGN PLAN (intern) ===== */}
      <RequirementsCompletenessSection
        projectId={project.id}
        requirementsComplete={project.requirementsComplete}
        evaluation={completeness}
      />
      <DesignPlanSection
        projectId={project.id}
        projectStatus={project.status}
        plans={designPlans}
      />

      {/* ===== WEBSITE GENERATION ===== */}
      <WebsiteGenerationSection
        projectId={project.id}
        projectStatus={project.status}
        leadStatus={lead?.leadStatus ?? "unknown"}
        websites={websites}
        latestQc={latestQc}
      />
    </div>
  );
}
