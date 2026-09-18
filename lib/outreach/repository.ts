import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { OutreachDraft, OutreachDraftStatus } from "./types";

/**
 * OutreachRepository — repository-abstractie voor outreach-concepten.
 * Mock mode: in-memory (module-singleton). Database mode: Supabase-tabel
 * outreach_drafts (RLS aan, server-side only). Volgt het Fase 4-patroon.
 */

export interface OutreachDraftCreateInput {
  contactId?: OutreachDraft["contactId"];
  conversationId?: OutreachDraft["conversationId"];
  projectId?: OutreachDraft["projectId"];
  priceApprovalId?: OutreachDraft["priceApprovalId"];
  purpose?: OutreachDraft["purpose"];
  sentAt?: OutreachDraft["sentAt"];
  providerMessageId?: OutreachDraft["providerMessageId"];
  providerAccountKey?: OutreachDraft["providerAccountKey"];

  leadId: string;
  channel: OutreachDraft["channel"];
  status: OutreachDraftStatus;
  subject: string;
  body: string;
  personalizationReason: string;
  callToAction: string;
  model: string;
  aiRunId?: string | null;
  qualityIssues: string[];
}

export interface OutreachRepository {
  readonly source: "mock" | "supabase";
  create(input: OutreachDraftCreateInput): Promise<OutreachDraft>;
  getById(id: string): Promise<OutreachDraft | null>;
  list(): Promise<OutreachDraft[]>;
  listByLead(leadId: string): Promise<OutreachDraft[]>;
  update(id: string, data: Partial<Pick<OutreachDraft, "status" | "subject" | "body" | "qualityIssues" | "sentAt" | "providerMessageId" | "providerAccountKey">>): Promise<OutreachDraft | null>;
  cancel(id: string): Promise<OutreachDraft | null>;
}

function buildDraft(input: OutreachDraftCreateInput, id: string, now: string): OutreachDraft {
  return {
    contactId: input.contactId,
    conversationId: input.conversationId,
    projectId: input.projectId,
    priceApprovalId: input.priceApprovalId,
    purpose: input.purpose ?? "initial",
    sentAt: input.sentAt,
    providerMessageId: input.providerMessageId,
    providerAccountKey: input.providerAccountKey,
    id,
    leadId: input.leadId,
    channel: input.channel,
    status: input.status,
    subject: input.subject,
    body: input.body,
    personalizationReason: input.personalizationReason,
    callToAction: input.callToAction,
    model: input.model,
    aiRunId: input.aiRunId ?? null,
    qualityIssues: input.qualityIssues,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------- Mock (in-memory, module-singleton) ----------

class MemoryOutreachRepository implements OutreachRepository {
  readonly source = "mock" as const;
  private drafts: OutreachDraft[] = [];

  async create(input: OutreachDraftCreateInput): Promise<OutreachDraft> {
    const draft = buildDraft(input, `draft-${(this.drafts.length + 1).toString().padStart(3, "0")}`, new Date().toISOString());
    this.drafts.push(draft);
    return draft;
  }
  async getById(id: string): Promise<OutreachDraft | null> {
    return this.drafts.find((d) => d.id === id) ?? null;
  }
  async list(): Promise<OutreachDraft[]> {
    return [...this.drafts];
  }
  async listByLead(leadId: string): Promise<OutreachDraft[]> {
    return this.drafts.filter((d) => d.leadId === leadId);
  }
  async update(id: string, data: Partial<Pick<OutreachDraft, "status" | "subject" | "body" | "qualityIssues" | "sentAt" | "providerMessageId" | "providerAccountKey">>): Promise<OutreachDraft | null> {
    const draft = this.drafts.find((d) => d.id === id);
    if (!draft) return null;
    Object.assign(draft, data, { updatedAt: new Date().toISOString() });
    return draft;
  }
  async cancel(id: string): Promise<OutreachDraft | null> {
    return this.update(id, { status: "cancelled" });
  }
}

// ---------- Supabase ----------

interface OutreachRow {
  contact_id: string | null;
  conversation_id: string | null;
  project_id: string | null;
  price_approval_id: string | null;
  purpose: "initial" | "followup" | "demo_offer" | "demo_link" | "price_offer" | "sales_reply";
  sent_at: string | null;
  provider_message_id: string | null;
  provider_account_key: string | null;

  id: string;
  lead_id: string;
  channel: OutreachDraft["channel"];
  status: OutreachDraft["status"];
  subject: string;
  body: string;
  personalization_reason: string;
  call_to_action: string;
  model: string;
  ai_run_id: string | null;
  quality_issues: string[] | null;
  created_at: string;
  updated_at: string;
}

function rowToDraft(row: OutreachRow): OutreachDraft {
  return {
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    projectId: row.project_id,
    priceApprovalId: row.price_approval_id,
    purpose: row.purpose,
    sentAt: row.sent_at,
    providerMessageId: row.provider_message_id,
    providerAccountKey: row.provider_account_key,
    id: row.id,
    leadId: row.lead_id,
    channel: row.channel,
    status: row.status,
    subject: row.subject,
    body: row.body,
    personalizationReason: row.personalization_reason,
    callToAction: row.call_to_action,
    model: row.model,
    aiRunId: row.ai_run_id,
    qualityIssues: row.quality_issues ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SupabaseOutreachRepository implements OutreachRepository {
  readonly source = "supabase" as const;

  async create(input: OutreachDraftCreateInput): Promise<OutreachDraft> {
    const draft = buildDraft(input, crypto.randomUUID(), new Date().toISOString());
    const { data, error } = await getSupabaseServerClient()
      .from("outreach_drafts")
      .insert({
        contact_id: draft.contactId,
        conversation_id: draft.conversationId,
        project_id: draft.projectId,
        price_approval_id: draft.priceApprovalId,
        purpose: draft.purpose,
        sent_at: draft.sentAt,
        provider_message_id: draft.providerMessageId,
        provider_account_key: draft.providerAccountKey,
        lead_id: draft.leadId,
        channel: draft.channel,
        status: draft.status,
        subject: draft.subject,
        body: draft.body,
        personalization_reason: draft.personalizationReason,
        call_to_action: draft.callToAction,
        model: draft.model,
        ai_run_id: draft.aiRunId,
        quality_issues: draft.qualityIssues,
      })
      .select("*")
      .single();
    if (error) throw new Error(`OutreachRepository: concept aanmaken mislukt: ${error.message}`);
    return rowToDraft(data as OutreachRow);
  }
  async getById(id: string): Promise<OutreachDraft | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("outreach_drafts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`OutreachRepository: concept ophalen mislukt: ${error.message}`);
    return data ? rowToDraft(data as OutreachRow) : null;
  }
  async list(): Promise<OutreachDraft[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("outreach_drafts")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`OutreachRepository: concepten ophalen mislukt: ${error.message}`);
    return (data as OutreachRow[]).map(rowToDraft);
  }
  async listByLead(leadId: string): Promise<OutreachDraft[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("outreach_drafts")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`OutreachRepository: concepten per lead ophalen mislukt: ${error.message}`);
    return (data as OutreachRow[]).map(rowToDraft);
  }
  async update(id: string, data: Partial<Pick<OutreachDraft, "status" | "subject" | "body" | "qualityIssues" | "sentAt" | "providerMessageId" | "providerAccountKey">>): Promise<OutreachDraft | null> {
    const { data: updated, error } = await getSupabaseServerClient()
      .from("outreach_drafts")
      .update({
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.subject !== undefined ? { subject: data.subject } : {}),
        ...(data.body !== undefined ? { body: data.body } : {}),
        ...(data.qualityIssues !== undefined ? { quality_issues: data.qualityIssues } : {}),
        ...(data.sentAt !== undefined ? { sent_at: data.sentAt } : {}),
        ...(data.providerMessageId !== undefined ? { provider_message_id: data.providerMessageId } : {}),
        ...(data.providerAccountKey !== undefined ? { provider_account_key: data.providerAccountKey } : {}),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`OutreachRepository: concept bijwerken mislukt: ${error.message}`);
    return updated ? rowToDraft(updated as OutreachRow) : null;
  }
  async cancel(id: string): Promise<OutreachDraft | null> {
    return this.update(id, { status: "cancelled" });
  }
}

// ---------- Factory ----------

let memoryRepository: MemoryOutreachRepository | null = null;

export function getOutreachRepository(): OutreachRepository {
  if (isSupabaseConfigured()) return new SupabaseOutreachRepository();
  memoryRepository ??= new MemoryOutreachRepository();
  return memoryRepository;
}
