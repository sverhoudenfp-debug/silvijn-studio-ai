import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { ObjectionType, SalesIntent } from "@/lib/ai/types";
import type { InboundChannel, InboundMessage, LeadQualification, SalesInteraction, SalesInteractionStatus } from "./types";

/**
 * Sales-repository's — volgens het Fase 4/6-repositorypatroon.
 * Mock: in-memory module-singletons. Supabase: tabellen uit migratie 0004
 * (RLS aan, server-side only). Geen directe databasecalls vanuit de UI.
 */

// ---------- InboundMessage ----------

export interface InboundMessageCreateInput {
  leadId: string;
  channel: InboundChannel;
  sender: string;
  subject: string;
  body: string;
  receivedAt?: string;
  source: string;
}

export interface InboundMessageRepository {
  readonly source: "mock" | "supabase";
  create(input: InboundMessageCreateInput): Promise<InboundMessage>;
  getById(id: string): Promise<InboundMessage | null>;
  listByLead(leadId: string): Promise<InboundMessage[]>;
  list(): Promise<InboundMessage[]>;
}

function buildInbound(input: InboundMessageCreateInput, id: string, now: string): InboundMessage {
  return {
    id,
    leadId: input.leadId,
    channel: input.channel,
    sender: input.sender,
    subject: input.subject,
    body: input.body,
    receivedAt: input.receivedAt ?? now,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  };
}

class MemoryInboundMessageRepository implements InboundMessageRepository {
  readonly source = "mock" as const;
  private messages: InboundMessage[] = [];

  async create(input: InboundMessageCreateInput): Promise<InboundMessage> {
    const message = buildInbound(input, `inb-${(this.messages.length + 1).toString().padStart(3, "0")}`, new Date().toISOString());
    this.messages.push(message);
    return message;
  }
  async getById(id: string): Promise<InboundMessage | null> {
    return this.messages.find((m) => m.id === id) ?? null;
  }
  async listByLead(leadId: string): Promise<InboundMessage[]> {
    return this.messages.filter((m) => m.leadId === leadId).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  }
  async list(): Promise<InboundMessage[]> {
    return [...this.messages];
  }
}

interface InboundRow {
  contact_id: string | null;
  conversation_id: string | null;
  in_reply_to_outreach_id: string | null;
  reply_confirmed: boolean;
  provider_message_id: string | null;
  provider_account_key: string | null;
  id: string;
  lead_id: string;
  channel: InboundChannel;
  sender: string;
  subject: string;
  body: string;
  received_at: string;
  source: string;
  created_at: string;
  updated_at: string;
}

function rowToInbound(row: InboundRow): InboundMessage {
  return {
    contactId: row.contact_id, conversationId:row.conversation_id, inReplyToOutreachId:row.in_reply_to_outreach_id, replyConfirmed:row.reply_confirmed, providerMessageId:row.provider_message_id, providerAccountKey:row.provider_account_key,
    id: row.id,
    leadId: row.lead_id,
    channel: row.channel,
    sender: row.sender,
    subject: row.subject,
    body: row.body,
    receivedAt: row.received_at,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SupabaseInboundMessageRepository implements InboundMessageRepository {
  readonly source = "supabase" as const;

  async create(input: InboundMessageCreateInput): Promise<InboundMessage> {
    const draft = buildInbound(input, crypto.randomUUID(), new Date().toISOString());
    const { data, error } = await getSupabaseServerClient()
      .from("inbound_messages")
      .insert({
        lead_id: draft.leadId,
        channel: draft.channel,
        sender: draft.sender,
        subject: draft.subject,
        body: draft.body,
        received_at: draft.receivedAt,
        source: draft.source,
      })
      .select("*")
      .single();
    if (error) throw new Error(`InboundMessageRepository: bericht aanmaken mislukt: ${error.message}`);
    return rowToInbound(data as InboundRow);
  }
  async getById(id: string): Promise<InboundMessage | null> {
    const { data, error } = await getSupabaseServerClient().from("inbound_messages").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`InboundMessageRepository: bericht ophalen mislukt: ${error.message}`);
    return data ? rowToInbound(data as InboundRow) : null;
  }
  async listByLead(leadId: string): Promise<InboundMessage[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("inbound_messages").select("*").eq("lead_id", leadId).order("received_at", { ascending: true });
    if (error) throw new Error(`InboundMessageRepository: berichten ophalen mislukt: ${error.message}`);
    return (data as InboundRow[]).map(rowToInbound);
  }
  async list(): Promise<InboundMessage[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("inbound_messages").select("*").order("received_at", { ascending: false });
    if (error) throw new Error(`InboundMessageRepository: berichten ophalen mislukt: ${error.message}`);
    return (data as InboundRow[]).map(rowToInbound);
  }
}

// ---------- SalesInteraction ----------

export interface SalesInteractionCreateInput {
  leadId: string;
  inboundMessageId: string;
  intent: SalesIntent;
  objectionType: ObjectionType | "none";
  qualification: LeadQualification;
  responseDraft: string;
  suggestedNextAction: string;
  questions: string[];
  escalationRequired: boolean;
  escalationReason: string | null;
  status: SalesInteractionStatus;
  qualityIssues: string[];
  model: string;
  aiRunId?: string | null;
}

export interface SalesInteractionRepository {
  readonly source: "mock" | "supabase";
  create(input: SalesInteractionCreateInput): Promise<SalesInteraction>;
  getById(id: string): Promise<SalesInteraction | null>;
  listByLead(leadId: string): Promise<SalesInteraction[]>;
  list(): Promise<SalesInteraction[]>;
  updateStatus(id: string, status: SalesInteractionStatus): Promise<SalesInteraction | null>;
}

function buildInteraction(input: SalesInteractionCreateInput, id: string, now: string): SalesInteraction {
  return {
    id,
    leadId: input.leadId,
    inboundMessageId: input.inboundMessageId,
    intent: input.intent,
    objectionType: input.objectionType,
    qualification: input.qualification,
    responseDraft: input.responseDraft,
    suggestedNextAction: input.suggestedNextAction,
    questions: input.questions,
    escalationRequired: input.escalationRequired,
    escalationReason: input.escalationReason,
    status: input.status,
    qualityIssues: input.qualityIssues,
    model: input.model,
    aiRunId: input.aiRunId ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

class MemorySalesInteractionRepository implements SalesInteractionRepository {
  readonly source = "mock" as const;
  private interactions: SalesInteraction[] = [];

  async create(input: SalesInteractionCreateInput): Promise<SalesInteraction> {
    const interaction = buildInteraction(input, `sint-${(this.interactions.length + 1).toString().padStart(3, "0")}`, new Date().toISOString());
    this.interactions.push(interaction);
    return interaction;
  }
  async getById(id: string): Promise<SalesInteraction | null> {
    return this.interactions.find((i) => i.id === id) ?? null;
  }
  async listByLead(leadId: string): Promise<SalesInteraction[]> {
    return this.interactions.filter((i) => i.leadId === leadId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async list(): Promise<SalesInteraction[]> {
    return [...this.interactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async updateStatus(id: string, status: SalesInteractionStatus): Promise<SalesInteraction | null> {
    const interaction = this.interactions.find((i) => i.id === id);
    if (!interaction) return null;
    interaction.status = status;
    interaction.updatedAt = new Date().toISOString();
    return interaction;
  }
}

interface SalesInteractionRow {
  id: string;
  lead_id: string;
  inbound_message_id: string;
  intent: SalesIntent;
  objection_type: ObjectionType | "none";
  qualification: LeadQualification;
  response_draft: string;
  suggested_next_action: string;
  questions: string[] | null;
  escalation_required: boolean;
  escalation_reason: string | null;
  status: SalesInteractionStatus;
  quality_issues: string[] | null;
  model: string;
  ai_run_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToInteraction(row: SalesInteractionRow): SalesInteraction {
  return {
    id: row.id,
    leadId: row.lead_id,
    inboundMessageId: row.inbound_message_id,
    intent: row.intent,
    objectionType: row.objection_type,
    qualification: row.qualification,
    responseDraft: row.response_draft,
    suggestedNextAction: row.suggested_next_action,
    questions: row.questions ?? [],
    escalationRequired: row.escalation_required,
    escalationReason: row.escalation_reason,
    status: row.status,
    qualityIssues: row.quality_issues ?? [],
    model: row.model,
    aiRunId: row.ai_run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SupabaseSalesInteractionRepository implements SalesInteractionRepository {
  readonly source = "supabase" as const;

  async create(input: SalesInteractionCreateInput): Promise<SalesInteraction> {
    const interaction = buildInteraction(input, crypto.randomUUID(), new Date().toISOString());
    const { data, error } = await getSupabaseServerClient()
      .from("sales_interactions")
      .insert({
        lead_id: interaction.leadId,
        inbound_message_id: interaction.inboundMessageId,
        intent: interaction.intent,
        objection_type: interaction.objectionType,
        qualification: interaction.qualification,
        response_draft: interaction.responseDraft,
        suggested_next_action: interaction.suggestedNextAction,
        questions: interaction.questions,
        escalation_required: interaction.escalationRequired,
        escalation_reason: interaction.escalationReason,
        status: interaction.status,
        quality_issues: interaction.qualityIssues,
        model: interaction.model,
        ai_run_id: interaction.aiRunId,
      })
      .select("*")
      .single();
    if (error) throw new Error(`SalesInteractionRepository: analyse opslaan mislukt: ${error.message}`);
    return rowToInteraction(data as SalesInteractionRow);
  }
  async getById(id: string): Promise<SalesInteraction | null> {
    const { data, error } = await getSupabaseServerClient().from("sales_interactions").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`SalesInteractionRepository: analyse ophalen mislukt: ${error.message}`);
    return data ? rowToInteraction(data as SalesInteractionRow) : null;
  }
  async listByLead(leadId: string): Promise<SalesInteraction[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("sales_interactions").select("*").eq("lead_id", leadId).order("created_at", { ascending: false });
    if (error) throw new Error(`SalesInteractionRepository: analyses ophalen mislukt: ${error.message}`);
    return (data as SalesInteractionRow[]).map(rowToInteraction);
  }
  async list(): Promise<SalesInteraction[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("sales_interactions").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(`SalesInteractionRepository: analyses ophalen mislukt: ${error.message}`);
    return (data as SalesInteractionRow[]).map(rowToInteraction);
  }
  async updateStatus(id: string, status: SalesInteractionStatus): Promise<SalesInteraction | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("sales_interactions").update({ status }).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(`SalesInteractionRepository: statusupdate mislukt: ${error.message}`);
    return data ? rowToInteraction(data as SalesInteractionRow) : null;
  }
}

// ---------- Factory's ----------

let memoryInbound: MemoryInboundMessageRepository | null = null;
let memoryInteractions: MemorySalesInteractionRepository | null = null;

export function getInboundMessageRepository(): InboundMessageRepository {
  if (isSupabaseConfigured()) return new SupabaseInboundMessageRepository();
  memoryInbound ??= new MemoryInboundMessageRepository();
  return memoryInbound;
}

export function getSalesInteractionRepository(): SalesInteractionRepository {
  if (isSupabaseConfigured()) return new SupabaseSalesInteractionRepository();
  memoryInteractions ??= new MemorySalesInteractionRepository();
  return memoryInteractions;
}
