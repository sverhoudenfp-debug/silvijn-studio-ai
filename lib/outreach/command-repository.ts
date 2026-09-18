import "server-only";
import type { OutreachCommandInput, OutreachCommandPatch, OutreachCommandRecord } from "./command-types";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * OutreachCommandRepository (Fase E) — persisteert de expliciete
 * owner-opdracht per outreach-run. Volgt het repository-patroon van
 * discovery_runs (0017): Supabase indien geconfigureerd, anders
 * in-memory mock (development/tests, nooit productie).
 *
 * RLS: outreach_commands heeft RLS met owner-read policy; schrijven
 * verloopt uitsluitend server-side via de service-role client.
 */

export interface OutreachCommandRepository {
  readonly source: "mock" | "supabase";
  create(input: OutreachCommandInput): Promise<OutreachCommandRecord>;
  complete(id: string, patch: OutreachCommandPatch): Promise<OutreachCommandRecord | null>;
  list(limit?: number): Promise<OutreachCommandRecord[]>;
}

function mapRow(row: Record<string, unknown>): OutreachCommandRecord {
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    command: String(row.command),
    mode: (row.mode as OutreachCommandRecord["mode"]) ?? "review",
    requestedLimit: Number(row.requested_limit),
    effectiveLimit: Number(row.effective_limit),
    status: (row.status as OutreachCommandRecord["status"]) ?? "running",
    selectedLeads: row.selected_leads === null || row.selected_leads === undefined ? null : Number(row.selected_leads),
    draftsCreated: row.drafts_created === null || row.drafts_created === undefined ? null : Number(row.drafts_created),
    qualityFailed: row.quality_failed === null || row.quality_failed === undefined ? null : Number(row.quality_failed),
    sent: row.sent === null || row.sent === undefined ? null : Number(row.sent),
    skipped: row.skipped === null || row.skipped === undefined ? null : Number(row.skipped),
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    selectedLeadIds: Array.isArray(row.selected_lead_ids) ? (row.selected_lead_ids as string[]) : [],
    summary: (row.summary as OutreachCommandRecord["summary"]) ?? { leads: [] },
    errors: Array.isArray(row.errors) ? (row.errors as string[]) : [],
    startedAt: String(row.started_at),
    completedAt: (row.completed_at as string | null) ?? null,
  };
}

export class SupabaseOutreachCommandRepository implements OutreachCommandRepository {
  readonly source = "supabase" as const;

  async create(input: OutreachCommandInput): Promise<OutreachCommandRecord> {
    const client = getSupabaseServerClient();
    const { data, error } = await client
      .from("outreach_commands")
      .insert({
        owner_user_id: input.ownerUserId,
        command: input.command,
        mode: input.mode,
        requested_limit: input.requestedLimit,
        effective_limit: input.effectiveLimit,
      })
      .select()
      .single();
    if (error || !data) throw new Error(`Outreach-commando kon niet worden vastgelegd: ${error?.message ?? "onbekende fout"}`);
    return mapRow(data);
  }

  async complete(id: string, patch: OutreachCommandPatch): Promise<OutreachCommandRecord | null> {
    const client = getSupabaseServerClient();
    const { data, error } = await client
      .from("outreach_commands")
      .update({
        status: patch.status,
        selected_leads: patch.selectedLeads,
        drafts_created: patch.draftsCreated,
        quality_failed: patch.qualityFailed,
        sent: patch.sent,
        skipped: patch.skipped,
        duration_ms: patch.durationMs,
        selected_lead_ids: patch.selectedLeadIds,
        summary: patch.summary,
        errors: patch.errors,
        completed_at: patch.completedAt,
      })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Outreach-commando kon niet worden afgesloten: ${error.message}`);
    return data ? mapRow(data) : null;
  }

  async list(limit = 20): Promise<OutreachCommandRecord[]> {
    const client = getSupabaseServerClient();
    const { data, error } = await client
      .from("outreach_commands")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Outreach-commando's ophalen mislukt: ${error.message}`);
    return (data as Record<string, unknown>[]).map(mapRow);
  }
}

export class MemoryOutreachCommandRepository implements OutreachCommandRepository {
  readonly source = "mock" as const;
  private records: OutreachCommandRecord[] = [];

  async create(input: OutreachCommandInput): Promise<OutreachCommandRecord> {
    const now = new Date().toISOString();
    const record: OutreachCommandRecord = {
      id: `outreach-cmd-${(this.records.length + 1).toString().padStart(3, "0")}`,
      ownerUserId: input.ownerUserId,
      command: input.command,
      mode: input.mode,
      requestedLimit: input.requestedLimit,
      effectiveLimit: input.effectiveLimit,
      status: "running",
      selectedLeads: null,
      draftsCreated: null,
      qualityFailed: null,
      sent: null,
      skipped: null,
      durationMs: null,
      selectedLeadIds: [],
      summary: { leads: [] },
      errors: [],
      startedAt: now,
      completedAt: null,
    };
    this.records.unshift(record);
    return record;
  }

  async complete(id: string, patch: OutreachCommandPatch): Promise<OutreachCommandRecord | null> {
    const record = this.records.find((r) => r.id === id);
    if (!record) return null;
    Object.assign(record, patch);
    return record;
  }

  async list(limit = 20): Promise<OutreachCommandRecord[]> {
    return this.records.slice(0, limit);
  }
}

let memoryRepository: MemoryOutreachCommandRepository | null = null;

export function getOutreachCommandRepository(): OutreachCommandRepository {
  if (isSupabaseConfigured()) return new SupabaseOutreachCommandRepository();
  memoryRepository ??= new MemoryOutreachCommandRepository();
  return memoryRepository;
}
