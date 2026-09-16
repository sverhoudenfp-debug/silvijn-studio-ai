import { leads } from "@/lib/mock-data";
import type { Lead } from "@/lib/types";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * LeadRepository — de UI praat hiermee, nooit direct met mock arrays of Supabase.
 * Wanneer Supabase geconfigureerd is wordt automatisch de database-implementatie
 * gebruikt; anders de mock-implementatie (development). Zo schakelt de app later
 * zonder UI-wijzigingen van mock → database.
 */

export interface LeadRepository {
  readonly source: "mock" | "supabase";
  list(): Promise<Lead[]>;
  get(id: string): Promise<Lead | null>;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
}

export function getLeadRepository(): LeadRepository {
  return isSupabaseConfigured() ? new SupabaseLeadRepository() : new MockLeadRepository();
}
