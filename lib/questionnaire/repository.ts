import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { QuestionnaireQuestion } from "./validation";

/**
 * QuestionnaireRepository — volgens het bestaande repositorypatroon.
 * Mock: leeg (er zijn geen publieke questionnaires zonder database).
 * Supabase: tabellen uit migratie 0013 (RLS aan, geen publiek beleid;
 * alle toegang verloopt uitsluitend server-side via de secret key).
 */

export type QuestionnaireStatus = "draft" | "active" | "closed";

export interface Questionnaire {
  id: string;
  leadId: string;
  projectId: string | null;
  slug: string;
  title: string;
  intro: string;
  questions: QuestionnaireQuestion[];
  status: QuestionnaireStatus;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionnaireRepository {
  readonly source: "mock" | "supabase";
  findBySlug(slug: string): Promise<Questionnaire | null>;
  createResponse(questionnaireId: string, answers: Record<string, string>): Promise<void>;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class MemoryQuestionnaireRepository implements QuestionnaireRepository {
  readonly source = "mock" as const;
  findBySlug(): Promise<Questionnaire | null> {
    return Promise.resolve(null);
  }
  createResponse(): Promise<void> {
    throw new Error("BLOCKED_EXTERNAL_CONFIGURATION: questionnaire-opslag vereist Supabase");
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

  async createResponse(questionnaireId: string, answers: Record<string, string>): Promise<void> {
    const { error } = await getSupabaseServerClient()
      .from("questionnaire_responses")
      .insert({ questionnaire_id: questionnaireId, answers });
    if (error) throw new Error(`QuestionnaireRepository: antwoord opslaan mislukt: ${error.message}`);
  }
}

let memoryQuestionnaire: MemoryQuestionnaireRepository | null = null;

export function getQuestionnaireRepository(): QuestionnaireRepository {
  if (isSupabaseConfigured()) return new SupabaseQuestionnaireRepository();
  memoryQuestionnaire ??= new MemoryQuestionnaireRepository();
  return memoryQuestionnaire;
}
