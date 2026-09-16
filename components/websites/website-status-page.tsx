import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { GeneratedWebsite } from "@/lib/websites/types";

/**
 * Statuspagina voor een gegenereerde website die (nog) niet volledig
 * bekijkbaar is: GENERATING / GENERATED / BUILDING / FAILED (Fase 9).
 * READY_FOR_QC rendert de echte website (GeneratedWebsiteRenderer).
 */

export function WebsiteStatusPage({ website }: { website: GeneratedWebsite }) {
  const isFailed = website.status === "failed";

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
              ? "Generatie mislukt"
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
            ? "De websitegeneratie is mislukt. Bekijk de fouten op de projectpagina en genereer opnieuw."
            : "De generatie is nog bezig of wacht op een volgende stap. Ververs zo meteen opnieuw."}
        </p>

        {isFailed && website.buildErrors.length > 0 && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-950/30 p-4">
            <p className="text-xs font-semibold text-red-300">Build-fouten:</p>
            <ul className="mt-2 list-inside list-disc text-xs text-red-200/80">
              {website.buildErrors.slice(0, 5).map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <Link
          href={`/projects/${website.projectId}`}
          className="mt-6 inline-flex h-9 items-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-500"
        >
          Naar het project
        </Link>
      </Card>
    </div>
  );
}
