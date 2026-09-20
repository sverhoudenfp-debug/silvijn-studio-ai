import "server-only";
import { AIService } from "@/lib/ai/service";
import { getLeadRepository, type LeadRepository } from "@/lib/repositories/lead-repository";
import { getProjectRepository, type ProjectRepository } from "@/lib/projects/repository";
import { buildQuestionnaireContext, QuestionnaireContextError } from "./context";
import { decideCompletion } from "./completion";
import { ensureDesignCoreQuestions } from "./design-core";
import { getQuestionnaireRepository, type Questionnaire, type QuestionnaireResponse, type QuestionnaireUpload } from "./repository";
import {
  generatedQuestionsSchema,
  questionnaireQuestionsSchema,
  questionnaireSlugSchema,
  validateQuestionnaireAnswers,
  type QuestionnaireCompletionStatus,
  type QuestionnaireQuestion,
} from "./validation";
import {
  MAX_TOTAL_UPLOAD_BYTES,
  MAX_UPLOADS_PER_QUESTION,
  uploadQuestionnaireFile,
  type UploadCandidate,
} from "./uploads";

/**
 * QuestionnaireService — de volledige flow:
 *  - owner-kant: aanmaken (AI gegenereerd vanuit alle bekende context),
 *    publiceren/sluiten/heropenen, projectkoppeling, dashboarddata;
 *  - publieke kant: actieve questionnaire via slug lezen, antwoorden met
 *    uploads insturen, automatische AI-completionbeoordeling met max één
 *    follow-upronde (max 3 vragen); daarna aandachtspunt voor Silvijn.
 * Lead-/project-/dashboardgegevens worden nooit naar de publieke kant gestuurd.
 */

export class QuestionnaireNotFoundError extends Error {
  constructor() {
    super("Questionnaire niet gevonden");
    this.name = "QuestionnaireNotFoundError";
  }
}

export class QuestionnaireValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionnaireValidationError";
  }
}

function parseQuestionsOrThrow(questionnaire: Questionnaire): Questionnaire["questions"] {
  const parsed = questionnaireQuestionsSchema.safeParse(questionnaire.questions);
  if (!parsed.success) throw new Error("BLOCKED_EXTERNAL_CONFIGURATION: questionnaire-definitie is ongeldig");
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Publieke kant
// ---------------------------------------------------------------------------

/** Alleen draft → 404; active → invulbaar; closed → nette gesloten-pagina. */
export async function getPublicQuestionnaireBySlug(slug: string): Promise<Questionnaire> {
  const cleanSlug = questionnaireSlugSchema.parse(slug);
  const questionnaire = await getQuestionnaireRepository().findBySlug(cleanSlug);
  if (!questionnaire || questionnaire.status === "draft") throw new QuestionnaireNotFoundError();
  parseQuestionsOrThrow(questionnaire);
  return questionnaire;
}

export interface PublicSubmitResult {
  /** Volgende pagina voor de klant: bedankt of follow-upvragen (ronde 2). */
  next: "submitted" | "follow_up";
}

/**
 * Publieke verzending: valideert antwoorden tegen de vragen van dát
 * questionnaire (ronde 1 of 2), slaat uploads veilig privé op en draait
 * daarna de AI-completionbeoordeling. Een fout in de beoordeling mag de
 * ontvangst van de antwoorden NOOIT ongedaan maken of blokkeren: in dat
 * geval blijft completion_status open en ziet Silvijn de fout terug in
 * het dashboard.
 */
export async function submitQuestionnaireResponse(
  slug: string,
  raw: Record<string, string>,
  files: UploadCandidate[] = []
): Promise<PublicSubmitResult> {
  const repository = getQuestionnaireRepository();
  const questionnaire = await getPublicQuestionnaireBySlug(slug);
  if (questionnaire.status !== "active") throw new QuestionnaireValidationError("Deze vragenlijst is gesloten en kan niet meer worden ingevuld.");

  const round: 1 | 2 =
    questionnaire.completionStatus === "QUESTIONNAIRE_FOLLOW_UP" && questionnaire.followUpQuestions.length > 0 ? 2 : 1;
  const questions = round === 1 ? questionnaire.questions : questionnaire.followUpQuestions;

  const { answers } = validateQuestionnaireAnswers(questions, raw);

  if (round === 2) {
    // Ronde 2 is eenmalig: een tweede versturing is niet nodig en niet toegestaan.
    const existing = await repository.listResponses(questionnaire.id);
    if (existing.some((response) => response.round === 2)) {
      throw new QuestionnaireValidationError("Je antwoorden op de vervolgvragen zijn al ontvangen.");
    }
  }

  // Uploads: strikt gevalideerd, tegen totaallimiet, privé opgeslagen.
  if (files.length > 0 && round === 2) {
    throw new QuestionnaireValidationError("Bestanden zijn alleen toegestaan bij de eerste ronde.");
  }
  const allowedQuestionIds = new Set(questions.filter((q) => q.type === "upload").map((q) => q.id));
  const perQuestion = new Map<string, number>();
  for (const candidate of files) {
    if (!allowedQuestionIds.has(candidate.questionId)) {
      throw new QuestionnaireValidationError("Bestand bij een onbekende of niet-uploadbare vraag.");
    }
    const count = perQuestion.get(candidate.questionId) ?? 0;
    if (count >= MAX_UPLOADS_PER_QUESTION) {
      throw new QuestionnaireValidationError("Maximaal 5 bestanden per vraag.");
    }
    perQuestion.set(candidate.questionId, count + 1);
  }
  const totalBytes = files.reduce((sum, c) => sum + c.file.size, 0);
  if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
    throw new QuestionnaireValidationError("De totale uploadgrootte is te groot (max 25 MB).");
  }

  const response = await repository.createResponse(questionnaire.id, { answers, uploads: [], round });

  const uploads: QuestionnaireUpload[] = [];
  for (const candidate of files) {
    uploads.push(await uploadQuestionnaireFile(questionnaire.id, response.id, candidate));
  }
  if (uploads.length > 0) {
    // Uploads worden aan de responsrij gekoppeld na de daadwerkelijke opslag.
    await attachUploadsToResponse(response.id, uploads);
  }

  // AI-completionbeoordeling — fout hierin mag de ontvangst niet breken.
  try {
    await runCompletionAssessment(questionnaire, round);
  } catch (error) {
    console.error("[questionnaire] completion-beoordeling mislukt:", error instanceof Error ? error.message : error);
    await repository
      .saveCompletion(questionnaire.id, {
        status: "QUESTIONNAIRE_ATTENTION",
        analysis: {
          assessmentError: error instanceof Error ? error.message : "onbekende fout",
          assessedAt: new Date().toISOString(),
          round,
        },
        followUpQuestions: [],
      })
      .catch(() => undefined);
  }

  const updated = await repository.get(questionnaire.id);
  if (round === 2 || updated?.completionStatus === "QUESTIONNAIRE_COMPLETE" || updated?.completionStatus === "QUESTIONNAIRE_ATTENTION") {
    return { next: "submitted" };
  }
  return { next: "follow_up" };
}

async function attachUploadsToResponse(responseId: string, uploads: QuestionnaireUpload[]): Promise<void> {
  // Directe update via de server-client (klein en expliciet): uploads horen
  // bij één respons en worden nooit gedeeld tussen questionnaires.
  const { getSupabaseServerClient } = await import("@/lib/supabase/server");
  const { error } = await getSupabaseServerClient()
    .from("questionnaire_responses")
    .update({ uploads })
    .eq("id", responseId);
  if (error) throw new Error(`Uploads koppelen mislukt: ${error.message}`);
}

async function runCompletionAssessment(questionnaire: Questionnaire, round: 1 | 2): Promise<void> {
  const repository = getQuestionnaireRepository();
  const lead = await getLeadRepository().get(questionnaire.leadId);
  const context = await buildQuestionnaireContext(questionnaire.leadId, questionnaire.projectId);
  const responses = await repository.listResponses(questionnaire.id);

  const questionsForRound = round === 1 ? questionnaire.questions : questionnaire.followUpQuestions;
  const answersSummary = questionsForRound
    .map((question) => {
      const latest = [...responses].reverse().find((r) => r.round === round && question.id in r.answers);
      const uploadNote = latest?.uploads.filter((u) => u.questionId === question.id) ?? [];
      const value = latest?.answers[question.id] ?? "(niet ingevuld)";
      const uploadText = uploadNote.length > 0 ? ` [${uploadNote.length} bestand(en) geüpload]` : "";
      return `- ${question.label}: ${value}${uploadText}`;
    })
    .join("\n");

  const result = await new AIService().analyzeQuestionnaireCompletion(
    {
      businessName: lead?.businessName ?? context.businessName,
      round,
      contextSummary: context.summary,
      questionsSummary: questionsForRound.map((q, i) => `${i + 1}. ${q.label}`).join("\n"),
      answersSummary,
    },
    questionnaire.leadId
  );

  const decision = decideCompletion(
    {
      sufficient: result.data.sufficient,
      missingInformation: result.data.missingInformation,
      followUpQuestions: result.data.followUpQuestions,
      contentDimensions: result.data.contentDimensions,
    },
    round
  );

  await repository.saveCompletion(questionnaire.id, {
    status: decision.status,
    analysis: {
      summary: result.data.summary,
      resolvedInformation: result.data.resolvedInformation,
      // Verrijkt met de C1-content-dimensies (ook als de AI ze miste).
      missingInformation: decision.missingInformation,
      contentDimensions: result.data.contentDimensions,
      sufficient: result.data.sufficient,
      assessedAt: new Date().toISOString(),
      model: result.model,
      mode: result.mode,
      round,
    },
    followUpQuestions: decision.followUpQuestions as QuestionnaireQuestion[],
  });
}

// ---------------------------------------------------------------------------
// Owner-kant (dashboard)
// ---------------------------------------------------------------------------

function slugifyBusinessName(businessName: string): string {
  return businessName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function generateUniqueSlug(businessName: string): Promise<string> {
  const repository = getQuestionnaireRepository();
  const base = slugifyBusinessName(businessName) || "vragenlijst";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = crypto.randomUUID().slice(0, 4);
    const candidate = `${base}-${suffix}`;
    if (questionnaireSlugSchema.safeParse(candidate).success && !(await repository.slugExists(candidate))) {
      return candidate;
    }
  }
  throw new Error("Kon geen unieke questionnaire-slug genereren");
}

/**
 * Maakt een draft-questionnaire met AI-gegenereerde vragen. De AI krijgt
 * alle bekende context en herhaalt geen bekende informatie.
 */
export async function createQuestionnaireForLead(
  leadId: string,
  projectId?: string | null
): Promise<Questionnaire> {
  const repository = getQuestionnaireRepository();
  const lead = await getLeadRepository().get(leadId);
  if (!lead) throw new QuestionnaireNotFoundError();

  const resolvedProjectId = projectId ?? null;
  if (resolvedProjectId) {
    const project = await getProjectRepository().getById(resolvedProjectId);
    if (!project || project.leadId !== leadId) throw new QuestionnaireValidationError("Project hoort niet bij deze lead");
  }

  const context = await buildQuestionnaireContext(leadId, resolvedProjectId);
  const generation = await new AIService().generateQuestionnaireDraft(
    { businessName: lead.businessName, contextSummary: context.summary },
    leadId
  );

  const parsed = generatedQuestionsSchema.safeParse(generation.data.questions);
  if (!parsed.success) {
    throw new QuestionnaireValidationError("AI-gegenereerde vragen voldoen niet aan de businessregels");
  }

  // C2: deterministische design-kern " + chr(8212) + " ontbrekende kernonderwerpen worden
  // aangevuld (korte vaste vragen, geen bedrijfsfeiten); bekende onderwerpen
  // worden NIET opnieuw gevraagd; de limiet van 15 blijft gehandhaafd.
  const core = ensureDesignCoreQuestions(parsed.data, context.summary);
  const coreQuestions = core.addedTopics.length > 0 ? generatedQuestionsSchema.parse(core.questions) : parsed.data;

  const slug = await generateUniqueSlug(lead.businessName);
  return repository.create({
    leadId,
    projectId: resolvedProjectId,
    slug,
    title: generation.data.title.slice(0, 120),
    intro: generation.data.intro.slice(0, 1000),
    questions: coreQuestions,
    aiContext: {
      ...context.aiContext,
      designCore: {
        addedTopics: core.addedTopics,
        knownTopics: core.knownTopics,
        enforcedAt: new Date().toISOString(),
      },
    },
  });
}

export async function publishQuestionnaire(id: string): Promise<Questionnaire> {
  const questionnaire = await getQuestionnaireOrThrow(id);
  if (questionnaire.status === "active") return questionnaire;
  if (questionnaire.status !== "draft") throw new QuestionnaireValidationError("Alleen een draft kan worden gepubliceerd");
  return (await getQuestionnaireRepository().updateStatus(id, "active"))!;
}

export async function closeQuestionnaire(id: string): Promise<Questionnaire> {
  const questionnaire = await getQuestionnaireOrThrow(id);
  if (questionnaire.status !== "active") throw new QuestionnaireValidationError("Alleen een actieve questionnaire kan worden gesloten");
  return (await getQuestionnaireRepository().updateStatus(id, "closed"))!;
}

export async function reopenQuestionnaire(id: string): Promise<Questionnaire> {
  const questionnaire = await getQuestionnaireOrThrow(id);
  if (questionnaire.status !== "closed") throw new QuestionnaireValidationError("Alleen een gesloten questionnaire kan opnieuw worden geopend");
  return (await getQuestionnaireRepository().updateStatus(id, "active"))!;
}

export async function linkQuestionnaireProject(id: string, projectId: string | null): Promise<Questionnaire> {
  const questionnaire = await getQuestionnaireOrThrow(id);
  if (projectId) {
    const project = await getProjectRepository().getById(projectId);
    if (!project || project.leadId !== questionnaire.leadId) {
      throw new QuestionnaireValidationError("Project hoort niet bij de lead van deze questionnaire");
    }
  }
  return (await getQuestionnaireRepository().linkProject(id, projectId))!;
}

export async function getQuestionnaireOrThrow(id: string): Promise<Questionnaire> {
  const questionnaire = await getQuestionnaireRepository().get(id);
  if (!questionnaire) throw new QuestionnaireNotFoundError();
  return questionnaire;
}

export interface QuestionnaireDashboardData {
  questionnaire: Questionnaire;
  responses: QuestionnaireResponse[];
  lead: NonNullable<Awaited<ReturnType<LeadRepository["get"]>>>;
  project: Awaited<ReturnType<ProjectRepository["getById"]>>;
}

export async function getQuestionnaireDashboardData(id: string): Promise<QuestionnaireDashboardData> {
  const questionnaire = await getQuestionnaireOrThrow(id);
  const [responses, lead, project] = await Promise.all([
    getQuestionnaireRepository().listResponses(questionnaire.id),
    getLeadRepository().get(questionnaire.leadId),
    questionnaire.projectId ? getProjectRepository().getById(questionnaire.projectId) : Promise.resolve(null),
  ]);
  if (!lead) throw new QuestionnaireContextError("Lead bij questionnaire niet gevonden");
  return { questionnaire, responses, lead, project };
}

export async function listQuestionnaires(): Promise<Questionnaire[]> {
  return getQuestionnaireRepository().list();
}

export async function findQuestionnairesByLead(leadId: string): Promise<Questionnaire[]> {
  return getQuestionnaireRepository().findByLeadId(leadId);
}

export function publicQuestionnaireUrl(slug: string): string {
  return `https://questionnaire.silvijnstudio.com/${slug}`;
}

export type { QuestionnaireCompletionStatus };
