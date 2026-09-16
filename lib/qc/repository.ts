import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { QualityControl } from "./types";

/**
 * QualityControlRepository (Fase 10) — repositorypatroon als Fase 4-9:
 * memory-implementatie (mock) + Supabase (migratie 0007, RLS aan,
 * server-side only). QC-history per websiteversie wordt NOOIT
 * overschreven: elke run is een nieuw record.
 */

export interface QualityControlCreateInput {
  generatedWebsiteId: string;
  projectId: string;
  leadId: string;
  websiteVersion: number;
  status: QualityControl["status"];
  mode: "mock" | "live";
  model: string;
}

export interface QualityControlUpdateInput {
  status?: QualityControl["status"];
  mode?: QualityControl["mode"];
  model?: QualityControl["model"];
  overallResult?: QualityControl["overallResult"];
  checks?: QualityControl["checks"];
  issues?: QualityControl["issues"];
  warnings?: string[];
  passedChecks?: QualityControl["passedChecks"];
  failedChecks?: QualityControl["failedChecks"];
  recommendations?: string[];
  aiSummary?: string;
  score?: number;
  aiRunId?: string | null;
  approval?: QualityControl["approval"];
}

export interface QualityControlRepository {
  readonly source: "mock" | "supabase";
  create(input: QualityControlCreateInput): Promise<QualityControl>;
  getById(id: string): Promise<QualityControl | null>;
  /** Nieuwste QC-record voor een websiteversie (QC #1, #2, ...). */
  getLatestByWebsiteId(websiteId: string): Promise<QualityControl | null>;
  /** Volledige QC-history (oudste eerst) — nooit overschreven. */
  listByWebsiteId(websiteId: string): Promise<QualityControl[]>;
  listByProjectId(projectId: string): Promise<QualityControl[]>;
  list(): Promise<QualityControl[]>;
  update(id: string, update: QualityControlUpdateInput): Promise<QualityControl | null>;
}

function buildRecord(input: QualityControlCreateInput, id: string, now: string): QualityControl {
  return {
    id,
    generatedWebsiteId: input.generatedWebsiteId,
    projectId: input.projectId,
    leadId: input.leadId,
    websiteVersion: input.websiteVersion,
    status: input.status,
    overallResult: "blocked",
    checks: [],
    issues: [],
    warnings: [],
    passedChecks: [],
    failedChecks: [],
    recommendations: [],
    aiSummary: "",
    score: 0,
    aiRunId: null,
    mode: input.mode,
    model: input.model,
    approval: null,
    createdAt: now,
    updatedAt: now,
  };
}

class MemoryQualityControlRepository implements QualityControlRepository {
  readonly source = "mock" as const;
  private records: QualityControl[] = [];

  async create(input: QualityControlCreateInput): Promise<QualityControl> {
    const record = buildRecord(input, `qc-${(this.records.length + 1).toString().padStart(3, "0")}`, new Date().toISOString());
    this.records.push(record);
    return record;
  }
  async getById(id: string): Promise<QualityControl | null> {
    return this.records.find((r) => r.id === id) ?? null;
  }
  async getLatestByWebsiteId(websiteId: string): Promise<QualityControl | null> {
    const matches = this.records.filter((r) => r.generatedWebsiteId === websiteId);
    return matches.length > 0 ? matches[matches.length - 1] : null;
  }
  async listByWebsiteId(websiteId: string): Promise<QualityControl[]> {
    return this.records.filter((r) => r.generatedWebsiteId === websiteId);
  }
  async listByProjectId(projectId: string): Promise<QualityControl[]> {
    return this.records.filter((r) => r.projectId === projectId);
  }
  async list(): Promise<QualityControl[]> {
    return [...this.records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async update(id: string, update: QualityControlUpdateInput): Promise<QualityControl | null> {
    const record = this.records.find((r) => r.id === id);
    if (!record) return null;
    Object.assign(record, update, { updatedAt: new Date().toISOString() });
    return record;
  }
}

interface QCRow {
  id: string;
  generated_website_id: string;
  project_id: string;
  lead_id: string;
  website_version: number;
  status: QualityControl["status"];
  overall_result: QualityControl["overallResult"];
  checks: QualityControl["checks"];
  issues: QualityControl["issues"];
  warnings: string[];
  passed_checks: QualityControl["passedChecks"];
  failed_checks: QualityControl["failedChecks"];
  recommendations: string[];
  ai_summary: string;
  score: number;
  ai_run_id: string | null;
  mode: "mock" | "live";
  model: string;
  approval: QualityControl["approval"];
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: QCRow): QualityControl {
  return {
    id: row.id,
    generatedWebsiteId: row.generated_website_id,
    projectId: row.project_id,
    leadId: row.lead_id,
    websiteVersion: row.website_version,
    status: row.status,
    overallResult: row.overall_result,
    checks: row.checks ?? [],
    issues: row.issues ?? [],
    warnings: row.warnings ?? [],
    passedChecks: row.passed_checks ?? [],
    failedChecks: row.failed_checks ?? [],
    recommendations: row.recommendations ?? [],
    aiSummary: row.ai_summary ?? "",
    score: row.score ?? 0,
    aiRunId: row.ai_run_id,
    mode: row.mode,
    model: row.model,
    approval: row.approval ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SupabaseQualityControlRepository implements QualityControlRepository {
  readonly source = "supabase" as const;

  async create(input: QualityControlCreateInput): Promise<QualityControl> {
    const draft = buildRecord(input, crypto.randomUUID(), new Date().toISOString());
    const { data, error } = await getSupabaseServerClient()
      .from("quality_controls")
      .insert({
        generated_website_id: draft.generatedWebsiteId,
        project_id: draft.projectId,
        lead_id: draft.leadId,
        website_version: draft.websiteVersion,
        status: draft.status,
        mode: draft.mode,
        model: draft.model,
      })
      .select("*")
      .single();
    if (error) throw new Error(`QualityControlRepository: QC aanmaken mislukt: ${error.message}`);
    return rowToRecord(data as QCRow);
  }
  async getById(id: string): Promise<QualityControl | null> {
    const { data, error } = await getSupabaseServerClient().from("quality_controls").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`QualityControlRepository: QC ophalen mislukt: ${error.message}`);
    return data ? rowToRecord(data as QCRow) : null;
  }
  async getLatestByWebsiteId(websiteId: string): Promise<QualityControl | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("quality_controls")
      .select("*")
      .eq("generated_website_id", websiteId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`QualityControlRepository: QC ophalen mislukt: ${error.message}`);
    return data ? rowToRecord(data as QCRow) : null;
  }
  async listByWebsiteId(websiteId: string): Promise<QualityControl[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("quality_controls")
      .select("*")
      .eq("generated_website_id", websiteId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`QualityControlRepository: QC-history ophalen mislukt: ${error.message}`);
    return (data as QCRow[]).map(rowToRecord);
  }
  async listByProjectId(projectId: string): Promise<QualityControl[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("quality_controls")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`QualityControlRepository: QC ophalen mislukt: ${error.message}`);
    return (data as QCRow[]).map(rowToRecord);
  }
  async list(): Promise<QualityControl[]> {
    const { data, error } = await getSupabaseServerClient().from("quality_controls").select("*").order("updated_at", { ascending: false });
    if (error) throw new Error(`QualityControlRepository: QC ophalen mislukt: ${error.message}`);
    return (data as QCRow[]).map(rowToRecord);
  }
  async update(id: string, update: QualityControlUpdateInput): Promise<QualityControl | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("quality_controls")
      .update({
        ...(update.status ? { status: update.status } : {}),
        ...(update.mode ? { mode: update.mode } : {}),
        ...(update.model ? { model: update.model } : {}),
        ...(update.overallResult ? { overall_result: update.overallResult } : {}),
        ...(update.checks !== undefined ? { checks: update.checks } : {}),
        ...(update.issues !== undefined ? { issues: update.issues } : {}),
        ...(update.warnings !== undefined ? { warnings: update.warnings } : {}),
        ...(update.passedChecks !== undefined ? { passed_checks: update.passedChecks } : {}),
        ...(update.failedChecks !== undefined ? { failed_checks: update.failedChecks } : {}),
        ...(update.recommendations !== undefined ? { recommendations: update.recommendations } : {}),
        ...(update.aiSummary != null ? { ai_summary: update.aiSummary } : {}),
        ...(update.score !== undefined ? { score: update.score } : {}),
        ...(update.aiRunId !== undefined ? { ai_run_id: update.aiRunId } : {}),
        ...(update.approval !== undefined ? { approval: update.approval } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`QualityControlRepository: QC bijwerken mislukt: ${error.message}`);
    return data ? rowToRecord(data as QCRow) : null;
  }
}

let memoryRepo: MemoryQualityControlRepository | null = null;

export function getQualityControlRepository(): QualityControlRepository {
  if (isSupabaseConfigured()) return new SupabaseQualityControlRepository();
  memoryRepo ??= new MemoryQualityControlRepository();
  return memoryRepo;
}
