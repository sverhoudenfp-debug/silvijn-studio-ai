import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Project, ProjectRequirements, ProjectStatus } from "./types";

/**
 * ProjectRepository — volgens het bestaande repositorypatroon (Fase 4/6/7).
 * Memory: module-singleton (mock). Supabase: tabel projects (migratie 0005,
 * RLS aan, server-side only). Geen directe databasecalls vanuit de UI.
 */

export interface ProjectCreateInput {
  leadId: string;
  name: string;
  projectType: string | null;
  description: string;
  requirements: ProjectRequirements;
  currency: string;
  timeline: string | null;
  notes: string;
}

export interface ProjectUpdateInput {
  name?: string;
  description?: string;
  projectType?: string | null;
  timeline?: string | null;
  notes?: string;
  status?: ProjectStatus;
  estimatedPrice?: number | null;
  priceStatus?: Project["priceStatus"];
  requirements?: ProjectRequirements;
}

export interface ProjectRepository {
  readonly source: "mock" | "supabase";
  create(input: ProjectCreateInput): Promise<Project>;
  getById(id: string): Promise<Project | null>;
  getByLeadId(leadId: string): Promise<Project | null>;
  list(): Promise<Project[]>;
  update(id: string, update: ProjectUpdateInput): Promise<Project | null>;
  updateRequirements(id: string, requirements: ProjectRequirements): Promise<Project | null>;
}

function buildProject(input: ProjectCreateInput, id: string, now: string): Project {
  return {
    id,
    leadId: input.leadId,
    name: input.name,
    status: "quotation_pending",
    projectType: input.projectType,
    description: input.description,
    requirements: input.requirements,
    estimatedPrice: null,
    priceStatus: "not_calculated",
    currency: input.currency,
    timeline: input.timeline,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };
}

class MemoryProjectRepository implements ProjectRepository {
  readonly source = "mock" as const;
  private projects: Project[] = [];

  async create(input: ProjectCreateInput): Promise<Project> {
    const project = buildProject(
      input,
      `proj-${(this.projects.length + 1).toString().padStart(3, "0")}`,
      new Date().toISOString()
    );
    this.projects.push(project);
    return project;
  }
  async getById(id: string): Promise<Project | null> {
    return this.projects.find((p) => p.id === id) ?? null;
  }
  async getByLeadId(leadId: string): Promise<Project | null> {
    return this.projects.find((p) => p.leadId === leadId) ?? null;
  }
  async list(): Promise<Project[]> {
    return [...this.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async update(id: string, update: ProjectUpdateInput): Promise<Project | null> {
    const project = this.projects.find((p) => p.id === id);
    if (!project) return null;
    Object.assign(project, update, { updatedAt: new Date().toISOString() });
    return project;
  }
  async updateRequirements(id: string, requirements: ProjectRequirements): Promise<Project | null> {
    const project = this.projects.find((p) => p.id === id);
    if (!project) return null;
    project.requirements = requirements;
    project.updatedAt = new Date().toISOString();
    return project;
  }
}

interface ProjectRow {
  id: string;
  lead_id: string;
  name: string;
  status: ProjectStatus;
  project_type: string | null;
  description: string;
  requirements: ProjectRequirements;
  estimated_price: number | null;
  price_status: Project["priceStatus"];
  currency: string;
  timeline: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    leadId: row.lead_id,
    name: row.name,
    status: row.status,
    projectType: row.project_type,
    description: row.description,
    requirements: row.requirements ?? {},
    estimatedPrice: row.estimated_price,
    priceStatus: row.price_status,
    currency: row.currency,
    timeline: row.timeline,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SupabaseProjectRepository implements ProjectRepository {
  readonly source = "supabase" as const;

  async create(input: ProjectCreateInput): Promise<Project> {
    const draft = buildProject(input, crypto.randomUUID(), new Date().toISOString());
    const { data, error } = await getSupabaseServerClient()
      .from("projects")
      .insert({
        lead_id: draft.leadId,
        name: draft.name,
        project_type: draft.projectType,
        description: draft.description,
        requirements: draft.requirements,
        currency: draft.currency,
        timeline: draft.timeline,
        notes: draft.notes,
      })
      .select("*")
      .single();
    if (error) throw new Error(`ProjectRepository: project aanmaken mislukt: ${error.message}`);
    return rowToProject(data as ProjectRow);
  }
  async getById(id: string): Promise<Project | null> {
    const { data, error } = await getSupabaseServerClient().from("projects").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`ProjectRepository: project ophalen mislukt: ${error.message}`);
    return data ? rowToProject(data as ProjectRow) : null;
  }
  async getByLeadId(leadId: string): Promise<Project | null> {
    const { data, error } = await getSupabaseServerClient().from("projects").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`ProjectRepository: project ophalen mislukt: ${error.message}`);
    return data ? rowToProject(data as ProjectRow) : null;
  }
  async list(): Promise<Project[]> {
    const { data, error } = await getSupabaseServerClient().from("projects").select("*").order("updated_at", { ascending: false });
    if (error) throw new Error(`ProjectRepository: projecten ophalen mislukt: ${error.message}`);
    return (data as ProjectRow[]).map(rowToProject);
  }
  async update(id: string, update: ProjectUpdateInput): Promise<Project | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("projects")
      .update({
        ...(update.name != null ? { name: update.name } : {}),
        ...(update.description != null ? { description: update.description } : {}),
        ...(update.projectType !== undefined ? { project_type: update.projectType } : {}),
        ...(update.timeline !== undefined ? { timeline: update.timeline } : {}),
        ...(update.notes != null ? { notes: update.notes } : {}),
        ...(update.status ? { status: update.status } : {}),
        ...(update.estimatedPrice !== undefined ? { estimated_price: update.estimatedPrice } : {}),
        ...(update.priceStatus ? { price_status: update.priceStatus } : {}),
        ...(update.requirements ? { requirements: update.requirements } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`ProjectRepository: project bijwerken mislukt: ${error.message}`);
    return data ? rowToProject(data as ProjectRow) : null;
  }
  async updateRequirements(id: string, requirements: ProjectRequirements): Promise<Project | null> {
    return this.update(id, { requirements });
  }
}

let memoryRepo: MemoryProjectRepository | null = null;

export function getProjectRepository(): ProjectRepository {
  if (isSupabaseConfigured()) return new SupabaseProjectRepository();
  memoryRepo ??= new MemoryProjectRepository();
  return memoryRepo;
}
