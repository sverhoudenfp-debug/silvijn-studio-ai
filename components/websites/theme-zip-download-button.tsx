"use client";

import { useState } from "react";
import { createThemeZipDownloadUrlAction } from "@/app/actions/websites";
import { buttonClasses } from "@/components/ui/button";
import type { DownloadableArtifactSummary } from "@/lib/websites/theme-zip/download";

/**
 * "Download Shopify Theme ZIP"-knop (intern, owner-only).
 *
 * Start géén generatie: de knop vraagt alleen een tijdelijke signed URL
 * aan voor een bestaand, gevalideerd artefact (status passed) uit de
 * privé-bucket. De server action weigert alles zonder opgeslagen ZIP.
 *
 * Eigen pending-state met gewone async handler — geen
 * startTransition(async ...) (React 19 levert rejections af aan de error
 * boundary i.p.v. de lokale catch; zie commit 1861992/e2d4a80).
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ThemeZipDownloadButton({
  artifact,
  variant = "secondary",
  label = "Download ZIP",
}: {
  artifact: DownloadableArtifactSummary;
  variant?: "primary" | "secondary" | "success";
  label?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setError(null);
    setPending(true);
    try {
      const result = await createThemeZipDownloadUrlAction(artifact.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // De signed URL is aangemaakt met { download: true } en de
      // opslag-serving zet de opgeslagen bestandsnaam als attachment.
      window.location.href = result.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download mislukt");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={download}
        disabled={pending}
        title={`${artifact.fileName} (artefact v${artifact.version}, ${formatBytes(artifact.sizeBytes)})`}
        className={buttonClasses(variant)}
      >
        {pending ? "URL aanmaken..." : `${label} (${formatBytes(artifact.sizeBytes)})`}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
