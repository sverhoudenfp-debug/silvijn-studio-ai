import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * ThemeZipArtifactRepository (Fase I.2) — repositorypatroon zoals alle eerdere
 * fases: memory-implementatie (mock/tests) + Supabase-implementatie
 * (migratie 0021, RLS aan zonder publiek beleid).
 *
 * VERSIONING: elk gegenereerd ZIP is een NIEUW artefact-record met eigen
 * versienummer per website; niets wordt ooit verwijderd of overschreven.
 * Oudere versies blijven volledig terugvindbaar (incl. opslagpad + checksum).
 */

/**
 * THEME CERTIFICATION (2026-09-21): nieuwe artefacten zijn "certified"
 * (volledige preflight doorstaan, incl. extern Theme Check) of
 * "preflight_failed" (critical preflight-fout, nooit leverbaar).
 * "passed"/"failed" zijn de legacy-statussen vóór de certificeringslaag
 * (bewust geldig gelaten: historische artefacten blijven ongewijzigd
 * leesbaar; download-selectie accepteert beide).
 */
export type ThemeZipArtifactStatus = "validating" | "passed" | "failed" | "certified" | "preflight_failed";

export interface ThemeZipArtifact {
  id: string;
  websiteId: string;
  projectId: string;
  leadId: string;
  version: number;
  status: ThemeZipArtifactStatus;
  storageBucket: string | null;
  storagePath: string | null;
  fileName: string;
  sizeBytes: number;
  fileCount: number;
  checksumSha256: string;
  validationErrors: string[];
  /** Theme Certification: volledig preflight-rapport (checks/warnings/extern). */
  preflight: ThemeZipArtifactPreflight | null;
  createdAt: string;
  updatedAt: string;
}

/** Persisteerbaar preflight-rapport (migratie 0025). */
export interface ThemeZipArtifactPreflight {
  status: "THEME_CERTIFIED" | "THEME_PREFLIGHT_FAILED";
  criticalErrors: string[];
  warnings: string[];
  checks: { id: string; title: string; result: string; errors: string[]; warnings: string[]; note?: string }[];
  externalRan: boolean;
  externalNote?: string;
  repairs: string[];
}

export interface ThemeZipArtifactCreateInput {
  websiteId: string;
  projectId: string;
  leadId: string;
  version: number;
  status: ThemeZipArtifactStatus;
  fileName: string;
  sizeBytes: number;
  fileCount: number;
  checksumSha256: string;
  storageBucket?: string | null;
  storagePath?: string | null;
  validationErrors?: string[];
  preflight?: ThemeZipArtifactPreflight | null;
}

export interface ThemeZipArtifactRepository {
  readonly source: "mock" | "supabase";
  create(input: ThemeZipArtifactCreateInput): Promise<ThemeZipArtifact>;
  getById(id: string): Promise<ThemeZipArtifact | null>;
  listByWebsite(websiteId: string): Promise<ThemeZipArtifact[]>;
}

function buildArtifact(input: ThemeZipArtifactCreateInput, id: string, now: string): ThemeZipArtifact {
  return {
    id,
    websiteId: input.websiteId,
    projectId: input.projectId,
    leadId: input.leadId,
    version: input.version,
    status: input.status,
    storageBucket: input.storageBucket ?? null,
    storagePath: input.storagePath ?? null,
    fileName: input.fileName,
    sizeBytes: input.sizeBytes,
    fileCount: input.fileCount,
    checksumSha256: input.checksumSha256,
    validationErrors: input.validationErrors ?? [],
    preflight: input.preflight ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

class MemoryThemeZipArtifactRepository implements ThemeZipArtifactRepository {
  readonly source = "mock" as const;
  private artifacts: ThemeZipArtifact[] = [];

  async create(input: ThemeZipArtifactCreateInput): Promise<ThemeZipArtifact> {
    const artifact = buildArtifact(input, `zip-${this.artifacts.length + 1}`, new Date().toISOString());
    this.artifacts.push(artifact);
    return artifact;
  }
  async getById(id: string): Promise<ThemeZipArtifact | null> {
    return this.artifacts.find((a) => a.id === id) ?? null;
  }
  async listByWebsite(websiteId: string): Promise<ThemeZipArtifact[]> {
    return this.artifacts
      .filter((a) => a.websiteId === websiteId)
      .sort((a, b) => b.version - a.version);
  }
}

interface ArtifactRow {
  id: string;
  website_id: string;
  project_id: string;
  lead_id: string;
  version: number;
  status: ThemeZipArtifactStatus;
  storage_bucket: string | null;
  storage_path: string | null;
  file_name: string;
  size_bytes: number | null;
  file_count: number;
  checksum_sha256: string;
  validation_errors: string[] | null;
  preflight: ThemeZipArtifactPreflight | null;
  created_at: string;
  updated_at: string;
}

function rowToArtifact(row: ArtifactRow): ThemeZipArtifact {
  return {
    id: row.id,
    websiteId: row.website_id,
    projectId: row.project_id,
    leadId: row.lead_id,
    version: row.version,
    status: row.status,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    fileName: row.file_name,
    sizeBytes: Number(row.size_bytes ?? 0),
    fileCount: Number(row.file_count ?? 0),
    checksumSha256: row.checksum_sha256,
    validationErrors: row.validation_errors ?? [],
    preflight: row.preflight ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SupabaseThemeZipArtifactRepository implements ThemeZipArtifactRepository {
  readonly source = "supabase" as const;

  async create(input: ThemeZipArtifactCreateInput): Promise<ThemeZipArtifact> {
    const { data, error } = await getSupabaseServerClient()
      .from("theme_zip_artifacts")
      .insert({
        website_id: input.websiteId,
        project_id: input.projectId,
        lead_id: input.leadId,
        version: input.version,
        status: input.status,
        storage_bucket: input.storageBucket ?? null,
        storage_path: input.storagePath ?? null,
        file_name: input.fileName,
        size_bytes: input.sizeBytes,
        file_count: input.fileCount,
        checksum_sha256: input.checksumSha256,
        validation_errors: input.validationErrors ?? [],
        preflight: input.preflight ?? null,
      })
      .select()
      .single();
    if (error || !data) throw new Error(`Theme-artefact opslaan mislukt: ${error?.message ?? "onbekend"}`);
    return rowToArtifact(data as ArtifactRow);
  }

  async getById(id: string): Promise<ThemeZipArtifact | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("theme_zip_artifacts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Theme-artefact ophalen mislukt: ${error.message}`);
    return data ? rowToArtifact(data as ArtifactRow) : null;
  }

  async listByWebsite(websiteId: string): Promise<ThemeZipArtifact[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("theme_zip_artifacts")
      .select("*")
      .eq("website_id", websiteId)
      .order("version", { ascending: false });
    if (error) throw new Error(`Theme-artefacten ophalen mislukt: ${error.message}`);
    return (data as ArtifactRow[]).map(rowToArtifact);
  }
}

export function getThemeZipArtifactRepository(): ThemeZipArtifactRepository {
  if (isSupabaseConfigured()) return new SupabaseThemeZipArtifactRepository();
  return new MemoryThemeZipArtifactRepository();
}
