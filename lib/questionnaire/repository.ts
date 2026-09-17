import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { QuestionnaireCompletionStatus, QuestionnaireQuestion } from "./validation";

/**
 * QuestionnaireRepository — volgens het bestaande repositorypatroon.
 * Mock: leeg (questionnaire-management vereist de database; de publieke
 * flow gooi't bewust BLOCKED_EXTERNAL_CONFIGURATION in mock-mode).
 * Supabase: 0013 + 0014 (RLS aan, geen publiek beleid; alle toegang
 * verloopt uitsluitend server-side via de secret key).
 */

export type QuestionnaireStatus = "draft" | "active" | "closed";

export interface QuestionnaireUpload {
  questionId: string;
  filename: string;
  path: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

export interface Questionnaire {
  id: string;
  leadId: string;
  projectId: string | null;
  slug: string;
  title: string;
  intro: string;
  questions: QuestionnaireQuestion[];
  status: QuestionnaireStatus;
  publishedAt: string | null;
  closedAt: string | null;
  completionStatus: QuestionnaireCompletionStatus | null;
  completionAnalysis: Record<string, unknown> | null;
  followUpQuestions: QuestionnaireQuestion[];
  aiContext: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionnaireResponse {
  id: string;
  questionnaireId: string;
  answers: Record<string, string>;
  uploads: QuestionnaireUpload[];
  round: number;
  createdAt: string;
}

export interface QuestionnaireCreateInput {
  leadId: string;
  projectId: string | null;
  slug: string;
  title: string;
  intro: string;
  questions: QuestionnaireQuestion[];
  aiContext: Record<string, unknown>;
}

export interface QuestionnaireRepository {
  readonly source: "mock" | "supabase";
  findBySlug(slug: string): Promise<Questionnaire | null>;
  get(id: string): Promise<Questionnaire | null>;
  list(): Promise<Questionnaire[]>;
  findByLeadId(leadId: string): Promise<Questionnaire[]>;
  slugExists(slug: string): Promise<boolean>;
  create(input: QuestionnaireCreateInput): Promise<Questionnaire>;
  updateStatus(id: string, status: QuestionnaireStatus): Promise<Questionnaire | null>;
  linkProject(id: string, projectId: string | null): Promise<Questionnaire | null>;
  saveCompletion(
    id: string,
    input: { status: QuestionnaireCompletionStatus; analysis: Record<string, unknown>; followUpQuestions: QuestionnaireQuestion[] }
  ): Promise<Questionnaire | null>;
  createResponse(
    questionnaireId: string,
    input: { answers: Record<string, string>; uploads: QuestionnaireUpload[]; round: 1 | 2 }
  ): Promise<QuestionnaireResponse>;
  listResponses(questionnaireId: string): Promise<QuestionnaireResponse[]>;
}

interface QuestionnaireRow {
  id: string;
  lead_id: string;
  project_id: string | null;
  slug: string;
  title: string;
  intro: string;
  questions: QuestionnaireQuestion[] | null;
  status: QuestionnaireStatus;
  published_at: string | null;
  closed_at: string | null;
  completion_status: QuestionnaireCompletionStatus | null;
  completion_analysis: Record<string, unknown> | null;
  follow_up_questions: QuestionnaireQuestion[] | null;
  ai_context: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function rowToQuestionnaire(row: QuestionnaireRow): Questionnaire {
  return {
    id: row.id,
    leadId: row.lead_id,
    projectId: row.project_id,
    slug: row.slug,
    title: row.title,
    intro: row.intro,
    questions: Array.isArray(row.questions) ? (row.questions as QuestionnaireQuestion[]) : [],
    status: row.status,
    publishedAt: row.published_at,
    closedAt: row.closed_at,
    completionStatus: row.completion_status,
    completionAnalysis: row.completion_analysis,
    followUpQuestions: Array.isArray(row.follow_up_questions) ? (row.follow_up_questions as QuestionnaireQuestion[]) : [],
    aiContext: row.ai_context ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ResponseRow {
  id: string;
  questionnaire_id: string;
  answers: Record<string, string> | null;
  uploads: QuestionnaireUpload[] | null;
  round: number;
  created_at: string;
}

function rowToResponse(row: ResponseRow): QuestionnaireResponse {
  return {
    id: row.id,
    questionnaireId: row.questionnaire_id,
    answers: row.answers ?? {},
    uploads: Array.isArray(row.uploads) ? row.uploads : [],
    round: row.round,
    createdAt: row.created_at,
  };
}

class MemoryQuestionnaireRepository implements QuestionnaireRepository {
  readonly source = "mock" as const;
  findBySlug(): Promise<Questionnaire | null> {
    return Promise.resolve(null);
  }
  get(): Promise<Questionnaire | null> {
    return Promise.resolve(null);
  }
  list(): Promise<Questionnaire[]> {
    return Promise.resolve([]);
  }
  findByLeadId(): Promise<Questionnaire[]> {
    return Promise.resolve([]);
  }
  slugExists(): Promise<boolean> {
    return Promise.resolve(false);
  }
  create(): Promise<Questionnaire> {
    throw new Error("BLOCKED_EXTERNAL_CONFIGURATION: questionnaire-beheer vereist Supabase");
  }
  updateStatus(): Promise<Questionnaire | null> {
    throw new Error("BLOCKED_EXTERNAL_CONFIGURATION: questionnaire-beheer vereist Supabase");
  }
  linkProject(): Promise<Questionnaire | null> {
    throw new Error("BLOCKED_EXTERNAL_CONFIGURATION: questionnaire-beheer vereist Supabase");
  }
  saveCompletion(): Promise<Questionnaire | null> {
    throw new Error("BLOCKED_EXTERNAL_CONFIGURATION: questionnaire-beheer vereist Supabase");
  }
  createResponse(): Promise<QuestionnaireResponse> {
    throw new Error("BLOCKED_EXTERNAL_CONFIGURATION: questionnaire-opslag vereist Supabase");
  }
  listResponses(): Promise<QuestionnaireResponse[]> {
    return Promise.resolve([]);
  }
}

class SupabaseQuestionnaireRepository implements QuestionnaireRepository {
  readonly source = "supabase" as const;

  async findBySlug(slug: string): Promise<Questionnaire | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("questionnaires")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw new Error(`QuestionnaireRepository: questionnaire ophalen mislukt: ${error.message}`);
    return data ? rowToQuestionnaire(data as QuestionnaireRow) : null;
  }

  async get(id: string): Promise<Questionnaire | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("questionnaires")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`QuestionnaireRepository: questionnaire ophalen mislukt: ${error.message}`);
    return data ? rowToQuestionnaire(data as QuestionnaireRow) : null;
  }

  async list(): Promise<Questionnaire[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("questionnaires")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`QuestionnaireRepository: questionnaires ophalen mislukt: ${error.message}`);
    return (data ?? []).map((row) => rowToQuestionnaire(row as QuestionnaireRow));
  }

  async findByLeadId(leadId: string): Promise<Questionnaire[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("questionnaires")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`QuestionnaireRepository: questionnaires ophalen mislukt: ${error.message}`);
    return (data ?? []).map((row) => rowToQuestionnaire(row as QuestionnaireRow));
  }

  async slugExists(slug: string): Promise<boolean> {
    const { data, error } = await getSupabaseServerClient()
      .from("questionnaires")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw new Error(`QuestionnaireRepository: slug-controle mislukt: ${error.message}`);
    return Boolean(data);
  }

  async create(input: QuestionnaireCreateInput): Promise<Questionnaire> {
    const { data, error } = await getSupabaseServerClient()
      .from("questionnaires")
      .insert({
        lead_id: input.leadId,
        project_id: input.projectId,
        slug: input.slug,
        title: input.title,
        intro: input.intro,
        questions: input.questions,
        status: "draft",
        ai_context: input.aiContext,
      })
      .select("*")
      .single();
    if (error) throw new Error(`QuestionnaireRepository: questionnaire aanmaken mislukt: ${error.message}`);
    return rowToQuestionnaire(data as QuestionnaireRow);
  }

  async updateStatus(id: string, status: QuestionnaireStatus): Promise<Questionnaire | null> {
    const patch: Record<string, unknown> = { status };
    if (status === "active") {
      patch.published_at = new Date().toISOString();
      patch.closed_at = null;
    } else if (status === "closed") {
      patch.closed_at = new Date().toISOString();
    }
    const { data, error } = await getSupabaseServerClient()
      .from("questionnaires")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`QuestionnaireRepository: status bijwerken mislukt: ${error.message}`);
    return data ? rowToQuestionnaire(data as QuestionnaireRow) : null;
  }

  async linkProject(id: string, projectId: string | null): Promise<Questionnaire | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("questionnaires")
      .update({ project_id: projectId })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`QuestionnaireRepository: projectkoppeling mislukt: ${error.message}`);
    return data ? rowToQuestionnaire(data as QuestionnaireRow) : null;
  }

  async saveCompletion(
    id: string,
    input: { status: QuestionnaireCompletionStatus; analysis: Record<string, unknown>; followUpQuestions: QuestionnaireQuestion[] }
  ): Promise<Questionnaire | null> {
    const { data, error } = await getSupabaseServerClient()
      .from("questionnaires")
      .update({
        completion_status: input.status,
        completion_analysis: input.analysis,
        follow_up_questions: input.followUpQuestions,
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`QuestionnaireRepository: completion opslaan mislukt: ${error.message}`);
    return data ? rowToQuestionnaire(data as QuestionnaireRow) : null;
  }

  async createResponse(
    questionnaireId: string,
    input: { answers: Record<string, string>; uploads: QuestionnaireUpload[]; round: 1 | 2 }
  ): Promise<QuestionnaireResponse> {
    const { data, error } = await getSupabaseServerClient()
      .from("questionnaire_responses")
      .insert({
        questionnaire_id: questionnaireId,
        answers: input.answers,
        uploads: input.uploads,
        round: input.round,
      })
      .select("*")
      .single();
    if (error) throw new Error(`QuestionnaireRepository: antwoord opslaan mislukt: ${error.message}`);
    return rowToResponse(data as ResponseRow);
  }

  async listResponses(questionnaireId: string): Promise<QuestionnaireResponse[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("questionnaire_responses")
      .select("*")
      .eq("questionnaire_id", questionnaireId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`QuestionnaireRepository: antwoorden ophalen mislukt: ${error.message}`);
    return (data ?? []).map((row) => rowToResponse(row as ResponseRow));
  }
}

let memoryQuestionnaire: MemoryQuestionnaireRepository | null = null;
let supabaseQuestionnaire: SupabaseQuestionnaireRepository | null = null;

export function getQuestionnaireRepository(): QuestionnaireRepository {
  if (isSupabaseConfigured()) {
    if (!supabaseQuestionnaire) supabaseQuestionnaire = new SupabaseQuestionnaireRepository();
    return supabaseQuestionnaire;
  }
  if (!memoryQuestionnaire) memoryQuestionnaire = new MemoryQuestionnaireRepository();
  return memoryQuestionnaire;
}
