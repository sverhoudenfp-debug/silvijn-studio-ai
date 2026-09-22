import { demos } from "@/lib/mock-demos";
import { demoStatusForLead } from "@/lib/mock-demos";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { DemoWebsite, Lead } from "@/lib/types";

export interface ThemeDemoUpsertInput {
  leadId: string;
  slug: string;
  businessName: string;
  industry: string;
  city: string;
  headline: string;
  description: string;
  ctaText: string;
  notes: string;
  renderedHtml: string;
  themeSha256: string;
  generationNotes: string[];
}

export interface DemoRepository {
  readonly source: "mock" | "supabase";
  list(): Promise<DemoWebsite[]>;
  get(id: string): Promise<DemoWebsite | null>;
  findBySlug(slug: string): Promise<DemoWebsite | null>;
  findByLeadId(leadId: string): Promise<DemoWebsite | null>;
  /** G4: het opgeslagen HTML-document van een theme_page-demo (null voor legacy/onbekend). */
  getRenderedHtmlBySlug(slug: string): Promise<string | null>;
  /**
   * G4: maakt of vervangt de theme_page-demo van een lead (één demo per lead).
   * Status wordt "ready"/"completed" omdat het HTML-document al gerenderd en
   * gevalideerd is vóór opslag. Legacy-demo's van andere leads blijven onaangeraakt.
   */
  upsertThemeDemo(input: ThemeDemoUpsertInput): Promise<DemoWebsite>;
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
  source?: DemoWebsite["source"] | null;
  theme_sha256?: string | null;
  generated_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** Kolommen zonder het (grote) HTML-document; gebruikt voor lijsten/detail. */
const DEMO_COLUMNS = "id,lead_id,slug,business_name,industry,city,template,status,generation_status,headline,description,services,cta_text,notes,preview_url,source,theme_sha256,generated_at,created_at,updated_at";

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
    source: row.source ?? "legacy_template",
    themeSha256: row.theme_sha256 ?? null,
    generatedAt: row.generated_at ?? null,
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
    return Promise.resolve(this.themeDemos.find((d) => d.leadId === leadId) ?? demos.find((demo) => demo.leadId === leadId) ?? null);
  }
  private readonly themeDemos: DemoWebsite[] = [];
  private readonly html = new Map<string, string>();
  getRenderedHtmlBySlug(slug: string): Promise<string | null> {
    return Promise.resolve(this.html.get(slug) ?? null);
  }
  upsertThemeDemo(input: ThemeDemoUpsertInput): Promise<DemoWebsite> {
    const now = new Date().toISOString();
    const existing = this.themeDemos.find((d) => d.leadId === input.leadId);
    const demo: DemoWebsite = {
      id: existing?.id ?? `theme-demo-${input.leadId}`,
      leadId: input.leadId,
      slug: input.slug,
      businessName: input.businessName,
      industry: input.industry,
      city: input.city,
      template: "theme_page",
      status: "ready",
      generationStatus: "completed",
      headline: input.headline,
      description: input.description,
      services: [],
      ctaText: input.ctaText,
      notes: input.notes,
      previewUrl: `/demo/${input.slug}`,
      source: "theme_page",
      themeSha256: input.themeSha256,
      generatedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing) this.themeDemos.splice(this.themeDemos.indexOf(existing), 1, demo);
    else this.themeDemos.push(demo);
    this.html.set(input.slug, input.renderedHtml);
    return Promise.resolve(demo);
  }
}

export class SupabaseDemoRepository implements DemoRepository {
  readonly source = "supabase" as const;

  async list(): Promise<DemoWebsite[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("demo_websites")
      .select(DEMO_COLUMNS)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`DemoRepository: demo's ophalen mislukt: ${error.message}`);
    return (data ?? []).map((row) => rowToDemo(row as DemoRow));
  }

  async get(id: string): Promise<DemoWebsite | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("demo_websites")
      .select(DEMO_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`DemoRepository: demo ophalen mislukt: ${error.message}`);
    return data ? rowToDemo(data as DemoRow) : null;
  }

  async findBySlug(slug: string): Promise<DemoWebsite | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("demo_websites")
      .select(DEMO_COLUMNS)
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw new Error(`DemoRepository: demo op slug ophalen mislukt: ${error.message}`);
    return data ? rowToDemo(data as DemoRow) : null;
  }

  async findByLeadId(leadId: string): Promise<DemoWebsite | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("demo_websites")
      .select(DEMO_COLUMNS)
      .eq("lead_id", leadId)
      .maybeSingle();
    if (error) throw new Error(`DemoRepository: demo op leadId ophalen mislukt: ${error.message}`);
    return data ? rowToDemo(data as DemoRow) : null;
  }

  async getRenderedHtmlBySlug(slug: string): Promise<string | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("demo_websites")
      .select("rendered_html,source,status")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw new Error(`DemoRepository: demo-HTML ophalen mislukt: ${error.message}`);
    const row = data as { rendered_html: string | null; source: string | null; status: string } | null;
    if (!row || row.source !== "theme_page" || row.status !== "ready") return null;
    return row.rendered_html ?? null;
  }

  async upsertThemeDemo(input: ThemeDemoUpsertInput): Promise<DemoWebsite> {
    const client = getSupabaseServerClient();
    const now = new Date().toISOString();
    const row = {
      lead_id: input.leadId,
      slug: input.slug,
      business_name: input.businessName,
      industry: input.industry,
      city: input.city,
      template: "theme_page",
      status: "ready",
      generation_status: "completed",
      headline: input.headline,
      description: input.description,
      services: [],
      cta_text: input.ctaText,
      notes: input.notes,
      preview_url: `/demo/${input.slug}`,
      source: "theme_page",
      rendered_html: input.renderedHtml,
      theme_sha256: input.themeSha256,
      generated_at: now,
      generation_notes: input.generationNotes,
      updated_at: now,
    };
    const existing = await this.findByLeadId(input.leadId);
    const query = existing
      ? client.from("demo_websites").update(row).eq("id", existing.id).select(DEMO_COLUMNS).single()
      : client.from("demo_websites").insert(row).select(DEMO_COLUMNS).single();
    const { data, error } = await query;
    if (error) throw new Error(`DemoRepository: theme-demo opslaan mislukt: ${error.message}`);
    return rowToDemo(data as DemoRow);
  }
}

export function getDemoRepository(): DemoRepository {
  return isSupabaseConfigured() ? new SupabaseDemoRepository() : new MockDemoRepository();
}

/** Demo-status voor een lead via de repository (één bron van waarheid). */
export function mockDemoStatusForLead(leadId: string): Lead["demoStatus"] {
  return demoStatusForLead(leadId);
}
