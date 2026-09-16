import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { QualityControl } from "@/lib/qc/types";
import type { GeneratedWebsite } from "@/lib/websites/types";

/**
 * Statuspagina voor een gegenereerde website die (nog) niet volledig
 * bekijkbaar is (Fase 9/10). FAILED kan twee oorzaken hebben: een
 * build-/generatiefout, óf een FAIL uit de kwaliteitscontrole — beide
 * worden hier eerlijk onderscheiden.
 */

export function WebsiteStatusPage({ website, qc }: { website: GeneratedWebsite; qc?: QualityControl | null }) {
  const isFailed = website.status === "failed";
  const qcFailed = isFailed && website.buildStatus === "passed" && website.generationStatus === "completed";

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <Card>
        <CardHeader
          title={website.businessName}
          subtitle={`Website v${website.version} · template: ${website.template}`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isFailed ? "neutral" : "info"}>
            {isFailed
              ? qcFailed
                ? "Kwaliteitscontrole: FAIL"
                : "Generatie mislukt"
              : website.status === "generated" || website.status === "building"
                ? "Generatie/validatie in behandeling"
                : "Website wordt gegenereerd"}
          </Badge>
          <span className="text-xs text-zinc-500">
            Status: {website.status} · generatiestatus: {website.generationStatus}
          </span>
        </div>

        <p className="mt-4 text-sm text-zinc-300">
          {isFailed
            ? qcFailed
              ? "De kwaliteitscontrole beoordeelde deze website als FAIL. Bekijk het QC-rapport voor de exacte issues en genereer daarna een nieuwe versie — deze versie blijft bewaard."
              : "De websitegeneratie is mislukt. Bekijk de fouten op de projectpagina en genereer opnieuw."
            : "De generatie is nog bezig of wacht op een volgende stap. Ververs zo meteen opnieuw."}
        </p>

        {qcFailed && qc && qc.issues.length > 0 && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-950/30 p-4">
            <p className="text-xs font-semibold text-red-300">Belangrijkste QC-issues:</p>
            <ul className="mt-2 list-inside list-disc text-xs text-red-200/80">
              {qc.issues
                .filter((issue) => issue.severity === "critical" || issue.severity === "error")
                .slice(0, 4)
                .map((issue) => (
                  <li key={issue.id}>{issue.message}</li>
                ))}
            </ul>
          </div>
        )}

        {isFailed && website.buildErrors.length > 0 && !qcFailed && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-950/30 p-4">
            <p className="text-xs font-semibold text-red-300">Build-fouten:</p>
            <ul className="mt-2 list-inside list-disc text-xs text-red-200/80">
              {website.buildErrors.slice(0, 5).map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          {qcFailed && (
            <Link
              href={`/generated-websites/${website.slug}/qc`}
              className="inline-flex h-9 items-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-500"
            >
              Bekijk QC-rapport
            </Link>
          )}
          <Link
            href={`/projects/${website.projectId}`}
            className="inline-flex h-9 items-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-500"
          >
            Naar het project
          </Link>
        </div>
      </Card>
    </div>
  );
}
