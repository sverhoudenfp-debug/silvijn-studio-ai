import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { DesignPlan, DesignPlanRecord, DesignPlanStatus } from "./design-plan";

/**
 * DesignPlanRepository (Fase I.1) — repositorypatroon zoals alle eerdere
 * fases: memory-implementatie (mock/tests) + Supabase-implementatie
 * (migratie 0020, RLS aan zonder publiek beleid). Versies worden nooit
 * verwijderd: elke generatie is een nieuw record met eigen versienummer.
 */

export interface DesignPlanCreateInput {
  projectId: string;
  leadId: string;
  version: number;
  status: DesignPlanStatus;
  mode: "mock" | "live";
}

export interface DesignPlanUpdateInput {
  status?: DesignPlanStatus;
  plan?: DesignPlan;
  missingInformation?: string[];
  validationErrors?: string[];
  model?: string;
  mode?: "mock" | "live";
  generationNotes?: string;
}

export interface DesignPlanRepository {
  readonly source: "mock" | "supabase";
  create(input: DesignPlanCreateInput): Promise<DesignPlanRecord>;
  getById(id: string): Promise<DesignPlanRecord | null>;
  listByProject(projectId: string): Promise<DesignPlanRecord[]>;
  update(id: string, update: DesignPlanUpdateInput): Promise<DesignPlanRecord | null>;
}

function buildRecord(input: DesignPlanCreateInput, id: string, now: string): DesignPlanRecord {
  return {
    id,
    projectId: input.projectId,
    leadId: input.leadId,
    version: input.version,
    status: input.status,
    plan: null,
    missingInformation: [],
    validationErrors: [],
    model: "",
    mode: input.mode,
    generationNotes: "",
    createdAt: now,
    updatedAt: now,
  };
}

class MemoryDesignPlanRepository implements DesignPlanRepository {
  readonly source = "mock" as const;
  private records: DesignPlanRecord[] = [];

  async create(input: DesignPlanCreateInput): Promise<DesignPlanRecord> {
    const record = buildRecord(input, `plan-${this.records.length + 1}`, new Date().toISOString());
    this.records.push(record);
    return record;
  }
  async getById(id: string): Promise<DesignPlanRecord | null> {
    return this.records.find((r) => r.id === id) ?? null;
  }
  async listByProject(projectId: string): Promise<DesignPlanRecord[]> {
    return this.records
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => b.version - a.version);
  }
  async update(id: string, update: DesignPlanUpdateInput): Promise<DesignPlanRecord | null> {
    const record = this.records.find((r) => r.id === id);
    if (!record) return null;
    Object.assign(record, update, { updatedAt: new Date().toISOString() });
    return record;
  }
}

interface DesignPlanRow {
  id: string;
  project_id: string;
  lead_id: string;
  version: number;
  status: DesignPlanStatus;
  plan: unknown;
  missing_information: string[];
  validation_errors: string[];
  model: string;
  mode: "mock" | "live";
  generation_notes: string;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: DesignPlanRow): DesignPlanRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    leadId: row.lead_id,
    version: row.version,
    status: row.status,
    plan: (row.plan as DesignPlan) ?? null,
    missingInformation: row.missing_information ?? [],
    validationErrors: row.validation_errors ?? [],
    model: row.model ?? "",
    mode: row.mode,
    generationNotes: row.generation_notes ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SupabaseDesignPlanRepository implements DesignPlanRepository {
  readonly source = "supabase" as const;

  async create(input: DesignPlanCreateInput): Promise<DesignPlanRecord> {
    const { data, error } = await getSupabaseServerClient()
      .from("design_plans")
      .insert({
        project_id: input.projectId,
        lead_id: input.leadId,
        version: input.version,
        status: input.status,
        mode: input.mode,
      })
      .select("*")
      .single();
    if (error) throw new Error(`DesignPlanRepository: aanmaken mislukt: ${error.message}`);
    return rowToRecord(data as DesignPlanRow);
  }
  async getById(id: string): Promise<DesignPlanRecord | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("design_plans")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`DesignPlanRepository: ophalen mislukt: ${error.message}`);
    return data ? rowToRecord(data as DesignPlanRow) : null;
  }
  async listByProject(projectId: string): Promise<DesignPlanRecord[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("design_plans")
      .select("*")
      .eq("project_id", projectId)
      .order("version", { ascending: false });
    if (error) throw new Error(`DesignPlanRepository: ophalen mislukt: ${error.message}`);
    return (data as DesignPlanRow[]).map(rowToRecord);
  }
  async update(id: string, update: DesignPlanUpdateInput): Promise<DesignPlanRecord | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("design_plans")
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
    if (error) throw new Error(`DesignPlanRepository: bijwerken mislukt: ${error.message}`);
    return data ? rowToRecord(data as DesignPlanRow) : null;
  }
}

let memoryRepo: MemoryDesignPlanRepository | null = null;

export function getDesignPlanRepository(): DesignPlanRepository {
  if (isSupabaseConfigured()) return new SupabaseDesignPlanRepository();
  memoryRepo ??= new MemoryDesignPlanRepository();
  return memoryRepo;
}
