import "server-only";
import type { DiscoveryRunInput, DiscoveryRunPatch, DiscoveryRunRecord } from "@/lib/discovery/run-types";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * DiscoveryRunRepository — persisteert de expliciete owner-opdracht per
 * discovery-run (Fase D). Volgt het bestaande repository-patroon: Supabase
 * indien geconfigureerd, anders in-memory mock (development, nooit productie).
 *
 * RLS: discovery_runs heeft RLS met owner-read policy; schrijven verloopt
 * uitsluitend server-side via de service-role client (zoals alle studio-tabellen).
 */

export interface DiscoveryRunRepository {
  readonly source: "mock" | "supabase";
  create(input: DiscoveryRunInput): Promise<DiscoveryRunRecord>;
  complete(id: string, patch: DiscoveryRunPatch): Promise<DiscoveryRunRecord | null>;
  list(limit?: number): Promise<DiscoveryRunRecord[]>;
}

function mapRow(row: Record<string, unknown>): DiscoveryRunRecord {
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    command: String(row.command),
    country: String(row.country),
    province: (row.province as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    industry: (row.industry as string | null) ?? null,
    query: (row.query as string | null) ?? null,
    source: String(row.source),
    requestedLimit: Number(row.requested_limit),
    effectiveLimit: Number(row.effective_limit),
    status: String(row.status) as DiscoveryRunRecord["status"],
    totalFound: row.total_found === null ? null : Number(row.total_found),
    createdLeads: row.created_leads === null ? null : Number(row.created_leads),
    duplicatesSkipped: row.duplicates_skipped === null ? null : Number(row.duplicates_skipped),
    invalidSkipped: row.invalid_skipped === null ? null : Number(row.invalid_skipped),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    createdLeadIds: Array.isArray(row.created_lead_ids) ? (row.created_lead_ids as string[]) : [],
    summary: (row.summary as DiscoveryRunRecord["summary"]) ?? {},
    errors: Array.isArray(row.errors) ? (row.errors as string[]) : [],
    startedAt: String(row.started_at),
    completedAt: (row.completed_at as string | null) ?? null,
  };
}

export class SupabaseDiscoveryRunRepository implements DiscoveryRunRepository {
  readonly source = "supabase" as const;

  async create(input: DiscoveryRunInput): Promise<DiscoveryRunRecord> {
    const client = getSupabaseServerClient();
    const { data, error } = await client
      .from("discovery_runs")
      .insert({
        owner_user_id: input.ownerUserId,
        command: input.command,
        country: input.country,
        province: input.province,
        city: input.city,
        industry: input.industry,
        query: input.query,
        source: input.source,
        requested_limit: input.requestedLimit,
        effective_limit: input.effectiveLimit,
      })
      .select()
      .single();
    if (error || !data) throw new Error("Discovery-run kon niet worden vastgelegd");
    return mapRow(data);
  }

  async complete(id: string, patch: DiscoveryRunPatch): Promise<DiscoveryRunRecord | null> {
    const client = getSupabaseServerClient();
    const { data, error } = await client
      .from("discovery_runs")
      .update({
        status: patch.status,
        total_found: patch.totalFound,
        created_leads: patch.createdLeads,
        duplicates_skipped: patch.duplicatesSkipped,
        invalid_skipped: patch.invalidSkipped,
        duration_ms: patch.durationMs,
        created_lead_ids: patch.createdLeadIds,
        summary: patch.summary,
        errors: patch.errors,
        completed_at: patch.completedAt,
      })
      .eq("id", id)
      .select()
      .single();
    if (error || !data) throw new Error("Discovery-run kon niet worden afgerond");
    return mapRow(data);
  }

  async list(limit = 10): Promise<DiscoveryRunRecord[]> {
    const client = getSupabaseServerClient();
    const { data, error } = await client
      .from("discovery_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(Math.max(1, Math.min(limit, 50)));
    if (error) throw new Error("Discovery-geschiedenis kon niet worden geladen");
    return (data ?? []).map(mapRow);
  }
}

/** Development-mock: in-memory, nooit in productie (isSupabaseConfigured failt daar hard). */
export class MockDiscoveryRunRepository implements DiscoveryRunRepository {
  readonly source = "mock" as const;
  private runs: DiscoveryRunRecord[] = [];

  async create(input: DiscoveryRunInput): Promise<DiscoveryRunRecord> {
    const now = new Date().toISOString();
    const record: DiscoveryRunRecord = {
      id: `run-${this.runs.length + 1}`,
      ownerUserId: input.ownerUserId,
      command: input.command,
      country: input.country,
      province: input.province,
      city: input.city,
      industry: input.industry,
      query: input.query,
      source: input.source,
      requestedLimit: input.requestedLimit,
      effectiveLimit: input.effectiveLimit,
      status: "running",
      totalFound: null,
      createdLeads: null,
      duplicatesSkipped: null,
      invalidSkipped: null,
      durationMs: null,
      createdLeadIds: [],
      summary: { created: [], duplicateReasons: {} },
      errors: [],
      startedAt: now,
      completedAt: null,
    };
    this.runs.unshift(record);
    return record;
  }

  async complete(id: string, patch: DiscoveryRunPatch): Promise<DiscoveryRunRecord | null> {
    const record = this.runs.find((run) => run.id === id);
    if (!record) return null;
    Object.assign(record, patch);
    return record;
  }

  async list(limit = 10): Promise<DiscoveryRunRecord[]> {
    return this.runs.slice(0, Math.max(1, Math.min(limit, 50)));
  }
}

export function getDiscoveryRunRepository(): DiscoveryRunRepository {
  return isSupabaseConfigured()
    ? new SupabaseDiscoveryRunRepository()
    : new MockDiscoveryRunRepository();
}
