import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { GeneratedWebsite } from "./types";

/**
 * GeneratedWebsiteRepository (Fase 9) — repositorypatroon zoals Fase 4-8:
 * memory-implementatie (mock) + Supabase-implementatie (migratie 0006, RLS
 * aan, server-side only). Versies worden NOOIT verwijderd: elke generatie
 * is een nieuw record; oudere versies krijgen status archived en blijven
 * via slug + versie terugvindbaar.
 */

export interface GeneratedWebsiteCreateInput {
  projectId: string;
  leadId: string;
  slug: string;
  businessName: string;
  websiteType: GeneratedWebsite["websiteType"];
  framework: GeneratedWebsite["framework"];
  template: GeneratedWebsite["template"];
  specification: GeneratedWebsite["specification"];
  previewUrl: string;
  version: number;
}

export interface GeneratedWebsiteUpdateInput {
  status?: GeneratedWebsite["status"];
  specification?: GeneratedWebsite["specification"];
  generationStatus?: GeneratedWebsite["generationStatus"];
  generatedContent?: GeneratedWebsite["generatedContent"];
  buildStatus?: GeneratedWebsite["buildStatus"];
  buildErrors?: string[];
  generationNotes?: string;
}

export interface GeneratedWebsiteRepository {
  readonly source: "mock" | "supabase";
  create(input: GeneratedWebsiteCreateInput): Promise<GeneratedWebsite>;
  getById(id: string): Promise<GeneratedWebsite | null>;
  getBySlug(slug: string): Promise<GeneratedWebsite | null>;
  listByProject(projectId: string): Promise<GeneratedWebsite[]>;
  list(): Promise<GeneratedWebsite[]>;
  update(id: string, update: GeneratedWebsiteUpdateInput): Promise<GeneratedWebsite | null>;
}

function buildWebsite(input: GeneratedWebsiteCreateInput, id: string, now: string): GeneratedWebsite {
  return {
    id,
    projectId: input.projectId,
    leadId: input.leadId,
    slug: input.slug,
    businessName: input.businessName,
    status: "generating",
    generationStatus: "pending",
    websiteType: input.websiteType,
    framework: input.framework,
    template: input.template,
    specification: input.specification,
    generatedContent: null,
    previewUrl: input.previewUrl,
    buildStatus: "not_built",
    buildErrors: [],
    generationNotes: "",
    version: input.version,
    createdAt: now,
    updatedAt: now,
  };
}

class MemoryGeneratedWebsiteRepository implements GeneratedWebsiteRepository {
  readonly source = "mock" as const;
  private websites: GeneratedWebsite[] = [];

  async create(input: GeneratedWebsiteCreateInput): Promise<GeneratedWebsite> {
    const website = buildWebsite(input, `site-${(this.websites.length + 1).toString().padStart(3, "0")}`, new Date().toISOString());
    this.websites.push(website);
    return website;
  }
  async getById(id: string): Promise<GeneratedWebsite | null> {
    return this.websites.find((w) => w.id === id) ?? null;
  }
  async getBySlug(slug: string): Promise<GeneratedWebsite | null> {
    return this.websites.find((w) => w.slug === slug) ?? null;
  }
  async listByProject(projectId: string): Promise<GeneratedWebsite[]> {
    return this.websites
      .filter((w) => w.projectId === projectId)
      .sort((a, b) => b.version - a.version);
  }
  async list(): Promise<GeneratedWebsite[]> {
    return [...this.websites].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async update(id: string, update: GeneratedWebsiteUpdateInput): Promise<GeneratedWebsite | null> {
    const website = this.websites.find((w) => w.id === id);
    if (!website) return null;
    Object.assign(website, update, { updatedAt: new Date().toISOString() });
    return website;
  }
}

interface WebsiteRow {
  id: string;
  project_id: string;
  lead_id: string;
  slug: string;
  business_name: string;
  status: GeneratedWebsite["status"];
  generation_status: GeneratedWebsite["generationStatus"];
  website_type: GeneratedWebsite["websiteType"];
  framework: GeneratedWebsite["framework"];
  template: GeneratedWebsite["template"];
  specification: GeneratedWebsite["specification"];
  generated_content: GeneratedWebsite["generatedContent"];
  preview_url: string;
  build_status: GeneratedWebsite["buildStatus"];
  build_errors: string[];
  generation_notes: string;
  version: number;
  created_at: string;
  updated_at: string;
}

function rowToWebsite(row: WebsiteRow): GeneratedWebsite {
  return {
    id: row.id,
    projectId: row.project_id,
    leadId: row.lead_id,
    slug: row.slug,
    businessName: row.business_name,
    status: row.status,
    generationStatus: row.generation_status,
    websiteType: row.website_type,
    framework: row.framework,
    template: row.template,
    specification: row.specification,
    generatedContent: row.generated_content,
    previewUrl: row.preview_url,
    buildStatus: row.build_status,
    buildErrors: row.build_errors ?? [],
    generationNotes: row.generation_notes ?? "",
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SupabaseGeneratedWebsiteRepository implements GeneratedWebsiteRepository {
  readonly source = "supabase" as const;

  async create(input: GeneratedWebsiteCreateInput): Promise<GeneratedWebsite> {
    const draft = buildWebsite(input, crypto.randomUUID(), new Date().toISOString());
    const { data, error } = await getSupabaseServerClient()
      .from("generated_websites")
      .insert({
        project_id: draft.projectId,
        lead_id: draft.leadId,
        slug: draft.slug,
        business_name: draft.businessName,
        website_type: draft.websiteType,
        framework: draft.framework,
        template: draft.template,
        specification: draft.specification,
        preview_url: draft.previewUrl,
        version: draft.version,
      })
      .select("*")
      .single();
    if (error) throw new Error(`GeneratedWebsiteRepository: website aanmaken mislukt: ${error.message}`);
    return rowToWebsite(data as WebsiteRow);
  }
  async getById(id: string): Promise<GeneratedWebsite | null> {
    const { data, error } = await getSupabaseServerClient().from("generated_websites").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`GeneratedWebsiteRepository: website ophalen mislukt: ${error.message}`);
    return data ? rowToWebsite(data as WebsiteRow) : null;
  }
  async getBySlug(slug: string): Promise<GeneratedWebsite | null> {
    const { data, error } = await getSupabaseServerClient().from("generated_websites").select("*").eq("slug", slug).order("version", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`GeneratedWebsiteRepository: website ophalen mislukt: ${error.message}`);
    return data ? rowToWebsite(data as WebsiteRow) : null;
  }
  async listByProject(projectId: string): Promise<GeneratedWebsite[]> {
    const { data, error } = await getSupabaseServerClient().from("generated_websites").select("*").eq("project_id", projectId).order("version", { ascending: false });
    if (error) throw new Error(`GeneratedWebsiteRepository: websites ophalen mislukt: ${error.message}`);
    return (data as WebsiteRow[]).map(rowToWebsite);
  }
  async list(): Promise<GeneratedWebsite[]> {
    const { data, error } = await getSupabaseServerClient().from("generated_websites").select("*").order("updated_at", { ascending: false });
    if (error) throw new Error(`GeneratedWebsiteRepository: websites ophalen mislukt: ${error.message}`);
    return (data as WebsiteRow[]).map(rowToWebsite);
  }
  async update(id: string, update: GeneratedWebsiteUpdateInput): Promise<GeneratedWebsite | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("generated_websites")
      .update({
        ...(update.status ? { status: update.status } : {}),
        ...(update.specification ? { specification: update.specification } : {}),
        ...(update.generationStatus ? { generation_status: update.generationStatus } : {}),
        ...(update.generatedContent !== undefined ? { generated_content: update.generatedContent } : {}),
        ...(update.buildStatus ? { build_status: update.buildStatus } : {}),
        ...(update.buildErrors !== undefined ? { build_errors: update.buildErrors } : {}),
        ...(update.generationNotes != null ? { generation_notes: update.generationNotes } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`GeneratedWebsiteRepository: website bijwerken mislukt: ${error.message}`);
    return data ? rowToWebsite(data as WebsiteRow) : null;
  }
}

let memoryRepo: MemoryGeneratedWebsiteRepository | null = null;

export function getGeneratedWebsiteRepository(): GeneratedWebsiteRepository {
  if (isSupabaseConfigured()) return new SupabaseGeneratedWebsiteRepository();
  memoryRepo ??= new MemoryGeneratedWebsiteRepository();
  return memoryRepo;
}
