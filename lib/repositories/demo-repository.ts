import { demos } from "@/lib/mock-demos";
import { demoStatusForLead } from "@/lib/mock-demos";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { DemoWebsite, Lead } from "@/lib/types";

export interface DemoRepository {
  readonly source: "mock" | "supabase";
  list(): Promise<DemoWebsite[]>;
  get(id: string): Promise<DemoWebsite | null>;
  findBySlug(slug: string): Promise<DemoWebsite | null>;
  findByLeadId(leadId: string): Promise<DemoWebsite | null>;
}

interface DemoRow {
  id: string;
  lead_id: string;
  slug: string;
  business_name: string;
  industry: string;
  city: string;
  template: DemoWebsite["template"];
  status: DemoWebsite["status"];
  generation_status: DemoWebsite["generationStatus"];
  headline: string;
  description: string;
  services: string[];
  cta_text: string;
  notes: string;
  preview_url: string;
  created_at: string;
  updated_at: string;
}

function rowToDemo(row: DemoRow): DemoWebsite {
  return {
    id: row.id,
    leadId: row.lead_id,
    slug: row.slug,
    businessName: row.business_name,
    industry: row.industry,
    city: row.city,
    template: row.template,
    status: row.status,
    generationStatus: row.generation_status,
    headline: row.headline,
    description: row.description,
    services: row.services ?? [],
    ctaText: row.cta_text,
    notes: row.notes ?? "",
    previewUrl: row.preview_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MockDemoRepository implements DemoRepository {
  readonly source = "mock" as const;
  list(): Promise<DemoWebsite[]> {
    return Promise.resolve(demos);
  }
  get(id: string): Promise<DemoWebsite | null> {
    return Promise.resolve(demos.find((demo) => demo.id === id) ?? null);
  }
  findBySlug(slug: string): Promise<DemoWebsite | null> {
    return Promise.resolve(demos.find((demo) => demo.slug === slug) ?? null);
  }
  findByLeadId(leadId: string): Promise<DemoWebsite | null> {
    return Promise.resolve(demos.find((demo) => demo.leadId === leadId) ?? null);
  }
}

export class SupabaseDemoRepository implements DemoRepository {
  readonly source = "supabase" as const;

  async list(): Promise<DemoWebsite[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("demo_websites")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(`DemoRepository: demo's ophalen mislukt: ${error.message}`);
    return (data ?? []).map((row) => rowToDemo(row as DemoRow));
  }

  async get(id: string): Promise<DemoWebsite | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("demo_websites")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`DemoRepository: demo ophalen mislukt: ${error.message}`);
    return data ? rowToDemo(data as DemoRow) : null;
  }

  async findBySlug(slug: string): Promise<DemoWebsite | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("demo_websites")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw new Error(`DemoRepository: demo op slug ophalen mislukt: ${error.message}`);
    return data ? rowToDemo(data as DemoRow) : null;
  }

  async findByLeadId(leadId: string): Promise<DemoWebsite | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("demo_websites")
      .select("*")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (error) throw new Error(`DemoRepository: demo op leadId ophalen mislukt: ${error.message}`);
    return data ? rowToDemo(data as DemoRow) : null;
  }
}

export function getDemoRepository(): DemoRepository {
  return isSupabaseConfigured() ? new SupabaseDemoRepository() : new MockDemoRepository();
}

/** Demo-status voor een lead via de repository (één bron van waarheid). */
export function mockDemoStatusForLead(leadId: string): Lead["demoStatus"] {
  return demoStatusForLead(leadId);
}
