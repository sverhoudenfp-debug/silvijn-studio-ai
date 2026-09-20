import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { ContentPlan, ContentPlanStatus } from "./content-plan";

/**
 * ContentPlanRepository (C3b) — repositorypatroon zoals alle eerdere
 * fasen: memory-implementatie (mock/tests) + Supabase-implementatie
 * (migratie 0023, RLS aan zonder publiek beleid). Versies worden nooit
 * verwijderd of overschreven: elke generatie is een nieuw record met een
 * oplopend versienummer PER design-plan-versie (unique
 * (design_plan_id, version)).
 */

export interface ContentPlanCreateInput {
  projectId: string;
  leadId: string;
  designPlanId: string;
  version: number;
  status: ContentPlanStatus;
  mode: "mock" | "live";
  sourceFingerprint: string;
}

export interface ContentPlanUpdateInput {
  status?: ContentPlanStatus;
  plan?: ContentPlan;
  missingInformation?: string[];
  validationErrors?: string[];
  model?: string;
  mode?: "mock" | "live";
  generationNotes?: string;
}

export interface ContentPlanRecord {
  id: string;
  projectId: string;
  leadId: string;
  designPlanId: string;
  version: number;
  status: ContentPlanStatus;
  mode: "mock" | "live";
  model: string;
  sourceFingerprint: string;
  plan: ContentPlan | null;
  missingInformation: string[];
  validationErrors: string[];
  generationNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentPlanRepository {
  readonly source: "mock" | "supabase";
  create(input: ContentPlanCreateInput): Promise<ContentPlanRecord>;
  getById(id: string): Promise<ContentPlanRecord | null>;
  listByDesignPlan(designPlanId: string): Promise<ContentPlanRecord[]>;
  listByProject(projectId: string): Promise<ContentPlanRecord[]>;
  update(id: string, update: ContentPlanUpdateInput): Promise<ContentPlanRecord | null>;
}

function buildRecord(input: ContentPlanCreateInput, id: string, now: string): ContentPlanRecord {
  return {
    id,
    projectId: input.projectId,
    leadId: input.leadId,
    designPlanId: input.designPlanId,
    version: input.version,
    status: input.status,
    mode: input.mode,
    model: "",
    sourceFingerprint: input.sourceFingerprint,
    plan: null,
    missingInformation: [],
    validationErrors: [],
    generationNotes: "",
    createdAt: now,
    updatedAt: now,
  };
}

class MemoryContentPlanRepository implements ContentPlanRepository {
  readonly source = "mock" as const;
  private records: ContentPlanRecord[] = [];

  async create(input: ContentPlanCreateInput): Promise<ContentPlanRecord> {
    const record = buildRecord(input, `content-plan-${this.records.length + 1}`, new Date().toISOString());
    this.records.push(record);
    return record;
  }
  async getById(id: string): Promise<ContentPlanRecord | null> {
    return this.records.find((r) => r.id === id) ?? null;
  }
  async listByDesignPlan(designPlanId: string): Promise<ContentPlanRecord[]> {
    return this.records
      .filter((r) => r.designPlanId === designPlanId)
      .sort((a, b) => b.version - a.version);
  }
  async listByProject(projectId: string): Promise<ContentPlanRecord[]> {
    return this.records
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.version - a.version);
  }
  async update(id: string, update: ContentPlanUpdateInput): Promise<ContentPlanRecord | null> {
    const record = this.records.find((r) => r.id === id);
    if (!record) return null;
    Object.assign(record, update, { updatedAt: new Date().toISOString() });
    return record;
  }
}

interface ContentPlanRow {
  id: string;
  project_id: string;
  lead_id: string;
  design_plan_id: string;
  version: number;
  status: ContentPlanStatus;
  mode: "mock" | "live";
  model: string;
  source_fingerprint: string;
  plan: unknown;
  missing_information: string[];
  validation_errors: string[];
  generation_notes: string;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: ContentPlanRow): ContentPlanRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    leadId: row.lead_id,
    designPlanId: row.design_plan_id,
    version: row.version,
    status: row.status,
    mode: row.mode,
    model: row.model ?? "",
    sourceFingerprint: row.source_fingerprint ?? "",
    plan: (row.plan as ContentPlan) ?? null,
    missingInformation: row.missing_information ?? [],
    validationErrors: row.validation_errors ?? [],
    generationNotes: row.generation_notes ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SupabaseContentPlanRepository implements ContentPlanRepository {
  readonly source = "supabase" as const;

  async create(input: ContentPlanCreateInput): Promise<ContentPlanRecord> {
    const { data, error } = await getSupabaseServerClient()
      .from("content_plans")
      .insert({
        project_id: input.projectId,
        lead_id: input.leadId,
        design_plan_id: input.designPlanId,
        version: input.version,
        status: input.status,
        mode: input.mode,
        source_fingerprint: input.sourceFingerprint,
      })
      .select("*")
      .single();
    if (error) throw new Error(`ContentPlanRepository: aanmaken mislukt: ${error.message}`);
    return rowToRecord(data as ContentPlanRow);
  }
  async getById(id: string): Promise<ContentPlanRecord | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("content_plans")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`ContentPlanRepository: ophalen mislukt: ${error.message}`);
    return data ? rowToRecord(data as ContentPlanRow) : null;
  }
  async listByDesignPlan(designPlanId: string): Promise<ContentPlanRecord[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("content_plans")
      .select("*")
      .eq("design_plan_id", designPlanId)
      .order("version", { ascending: false });
    if (error) throw new Error(`ContentPlanRepository: ophalen mislukt: ${error.message}`);
    return (data as ContentPlanRow[]).map(rowToRecord);
  }
  async listByProject(projectId: string): Promise<ContentPlanRecord[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("content_plans")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`ContentPlanRepository: ophalen mislukt: ${error.message}`);
    return (data as ContentPlanRow[]).map(rowToRecord);
  }
  async update(id: string, update: ContentPlanUpdateInput): Promise<ContentPlanRecord | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("content_plans")
      .update({
        ...(update.status ? { status: update.status } : {}),
        ...(update.plan !== undefined ? { plan: update.plan } : {}),
        ...(update.missingInformation !== undefined ? { missing_information: update.missingInformation } : {}),
        ...(update.validationErrors !== undefined ? { validation_errors: update.validationErrors } : {}),
        ...(update.model !== undefined ? { model: update.model } : {}),
        ...(update.mode !== undefined ? { mode: update.mode } : {}),
        ...(update.generationNotes !== undefined ? { generation_notes: update.generationNotes } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`ContentPlanRepository: bijwerken mislukt: ${error.message}`);
    return data ? rowToRecord(data as ContentPlanRow) : null;
  }
}

let memoryRepo: MemoryContentPlanRepository | null = null;

export function getContentPlanRepository(): ContentPlanRepository {
  if (isSupabaseConfigured()) return new SupabaseContentPlanRepository();
  memoryRepo ??= new MemoryContentPlanRepository();
  return memoryRepo;
}
