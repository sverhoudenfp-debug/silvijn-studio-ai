import { getThemeZipArtifactRepository, type ThemeZipArtifact, type ThemeZipArtifactRepository } from "./repository";

/**
 * Download-selectie voor theme-ZIP-artefacten (intern gebruik).
 *
 * Een artefact is alléén downloadbaar wanneer het de validatie heeft
 * doorstaan (status "certified" — of legacy "passed" uit de tijd vóór de
 * certificeringslaag) én er daadwerkelijk een ZIP in de privé-opslag ligt
 * (storageBucket + storagePath). Preflight-gefaalde builds en artefacten
 * zonder opgeslagen bestand worden nooit aangeboden.
 *
 * Er wordt hier NOOIT een (her)generatie gestart: deze module selecteert
 * uitsluitend bestaande, geldige artefacten. De productie-poort
 * (prijs/betaling/requirements) is onveranderd alleen van toepassing op
 * generatie zelf.
 */

export interface DownloadableArtifactSummary {
  id: string;
  version: number;
  fileName: string;
  sizeBytes: number;
}

/** Nieuwste geldige (passed + opgeslagen) artefact, of null. */
export function selectDownloadableArtifact(artifacts: ThemeZipArtifact[]): ThemeZipArtifact | null {
  const downloadable = artifacts.filter(
    (artifact) =>
      (artifact.status === "certified" || artifact.status === "passed") &&
      !!artifact.storageBucket &&
      !!artifact.storagePath
  );
  if (downloadable.length === 0) return null;
  return downloadable.reduce((best, current) => (current.version > best.version ? current : best));
}

export function toArtifactSummary(artifact: ThemeZipArtifact): DownloadableArtifactSummary {
  return {
    id: artifact.id,
    version: artifact.version,
    fileName: artifact.fileName,
    sizeBytes: artifact.sizeBytes,
  };
}

/** Downloadbaar artefact voor één websiteversie, of null. */
export async function getDownloadableArtifactForWebsite(
  websiteId: string,
  repository: ThemeZipArtifactRepository = getThemeZipArtifactRepository()
): Promise<DownloadableArtifactSummary | null> {
  const artifacts = await repository.listByWebsite(websiteId);
  const artifact = selectDownloadableArtifact(artifacts);
  return artifact ? toArtifactSummary(artifact) : null;
}
