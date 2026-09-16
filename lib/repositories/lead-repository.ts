import { scoreLead } from "@/lib/agents/lead-scoring";
import { leads } from "@/lib/mock-data";
import type { Lead, LeadSourceType, WebsiteStatus } from "@/lib/types";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * LeadRepository — de UI praat hiermee, nooit direct met mock arrays of Supabase.
 * Wanneer Supabase geconfigureerd is wordt automatisch de database-implementatie
 * gebruikt; anders de mock-implementatie (development). Zo schakelt de app later
 * zonder UI-wijzigingen van mock → database.
 */

export interface LeadCreateInput {
  businessName: string;
  industry: string;
  city: string;
  province: string;
  country: string;
  address?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  websiteStatus: WebsiteStatus;
  source: LeadSourceType;
  notes?: string[];
  externalId?: string | null;
  sourceUrl?: string | null;
  googleRating?: number | null;
  reviewCount?: number | null;
}

export interface LeadRepository {
  readonly source: "mock" | "supabase";
  list(): Promise<Lead[]>;
  get(id: string): Promise<Lead | null>;
  create(input: LeadCreateInput): Promise<Lead>;
}

/**
 * Nieuw ontdekte leads starten ALWAYS met: leadStatus=new,
 * outreachStatus=not_contacted, demoStatus=not_created, leadScore via de
 * bestaande rule-based scoring agent (geen AI, geen kosten).
 */
function prepareNewLead(input: LeadCreateInput, id: string, now: string): Lead {
  const lead: Lead = {
    id,
    businessName: input.businessName,
    industry: input.industry,
    address: input.address ?? null,
    postalCode: input.postalCode ?? null,
    city: input.city,
    province: input.province,
    country: input.country,
    phone: input.phone ?? null,
    email: input.email ?? null,
    website: input.website ?? null,
    websiteStatus: input.websiteStatus,
    googleRating: input.googleRating ?? null,
    reviewCount: input.reviewCount ?? null,
    leadScore: 0,
    leadStatus: "new",
    outreachStatus: "not_contacted",
    demoStatus: "not_created",
    source: input.source,
    notes: input.notes ?? [],
    aiAnalysis: null,
    externalId: input.externalId ?? null,
    sourceUrl: input.sourceUrl ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const { score } = scoreLead(lead);
  lead.leadScore = score;
  return lead;
}

interface LeadRow {
  id: string;
  business_name: string;
  industry: string;
  address: string | null;
  postal_code: string | null;
  city: string;
  province: string;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  website_status: Lead["websiteStatus"];
  google_rating: number | null;
  review_count: number | null;
  lead_score: number;
  lead_status: Lead["leadStatus"];
  outreach_status: Lead["outreachStatus"];
  demo_status: Lead["demoStatus"];
  source: Lead["source"];
  notes: string[];
  ai_summary: Lead["aiAnalysis"] | null;
  external_id: string | null;
  source_url: string | null;
  created_at: string;
  updated_at: string;
}

function rowToLead(row: LeadRow): Lead {
  return {
    id: row.id,
    businessName: row.business_name,
    industry: row.industry,
    address: row.address,
    postalCode: row.postal_code,
    city: row.city,
    province: row.province,
    country: row.country,
    phone: row.phone,
    email: row.email,
    website: row.website,
    websiteStatus: row.website_status,
    googleRating: row.google_rating,
    reviewCount: row.review_count,
    leadScore: row.lead_score,
    leadStatus: row.lead_status,
    outreachStatus: row.outreach_status,
    demoStatus: row.demo_status,
    source: row.source,
    notes: row.notes ?? [],
    aiAnalysis: row.ai_summary,
    externalId: row.external_id ?? null,
    sourceUrl: row.source_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function leadToRow(lead: Lead): Record<string, unknown> {
  return {
    business_name: lead.businessName,
    industry: lead.industry,
    address: lead.address,
    postal_code: lead.postalCode,
    city: lead.city,
    province: lead.province,
    country: lead.country,
    phone: lead.phone,
    email: lead.email,
    website: lead.website,
    website_status: lead.websiteStatus,
    google_rating: lead.googleRating,
    review_count: lead.reviewCount,
    lead_score: lead.leadScore,
    lead_status: lead.leadStatus,
    outreach_status: lead.outreachStatus,
    demo_status: lead.demoStatus,
    source: lead.source,
    notes: lead.notes,
    ai_summary: lead.aiAnalysis,
    external_id: lead.externalId ?? null,
    source_url: lead.sourceUrl ?? null,
    created_at: lead.createdAt,
    updated_at: lead.updatedAt,
  };
}

export class MockLeadRepository implements LeadRepository {
  readonly source = "mock" as const;
  list(): Promise<Lead[]> {
    return Promise.resolve(leads);
  }
  get(id: string): Promise<Lead | null> {
    return Promise.resolve(leads.find((lead) => lead.id === id) ?? null);
  }
  async create(input: LeadCreateInput): Promise<Lead> {
    const maxNum = leads.reduce(
      (max, lead) => Math.max(max, Number.parseInt(lead.id.replace(/\D/g, ""), 10) || 0),
      0
    );
    const id = `ld-${String(maxNum + 1).padStart(3, "0")}`;
    const lead = prepareNewLead(input, id, new Date().toISOString());
    leads.push(lead);
    return lead;
  }
}

export class SupabaseLeadRepository implements LeadRepository {
  readonly source = "supabase" as const;

  async list(): Promise<Lead[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("leads")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(`LeadRepository: leads ophalen mislukt: ${error.message}`);
    return (data ?? []).map(rowToLead);
  }

  async get(id: string): Promise<Lead | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("leads")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`LeadRepository: lead ophalen mislukt: ${error.message}`);
    return data ? rowToLead(data as LeadRow) : null;
  }

  async create(input: LeadCreateInput): Promise<Lead> {
    const id = crypto.randomUUID();
    const lead = prepareNewLead(input, id, new Date().toISOString());
    const { data, error } = await getSupabaseServerClient()
      .from("leads")
      .insert(leadToRow(lead))
      .select("id")
      .single();
    if (error) throw new Error(`LeadRepository: lead aanmaken mislukt: ${error.message}`);
    return { ...lead, id: (data as { id: string }).id };
  }
}

export function getLeadRepository(): LeadRepository {
  return isSupabaseConfigured() ? new SupabaseLeadRepository() : new MockLeadRepository();
}
