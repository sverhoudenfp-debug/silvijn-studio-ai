import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  QUESTIONNAIRE_UPLOAD_BUCKET,
  sanitizeFilename,
  validateUploadFile,
  type StoredUpload,
  type UploadCandidate,
} from "./upload-validation";

/**
 * Server-side opslag van publieke klantuploads: privé bucket (geen publieke
 * toegang); download uitsluitend via tijdelijke signed URLs die het interne
 * dashboard server-side genereert. Pure validatie staat in
 * upload-validation.ts (unit-testbaar).
 */

export * from "./upload-validation";

export async function uploadQuestionnaireFile(
  questionnaireId: string,
  responseId: string,
  candidate: UploadCandidate
): Promise<StoredUpload> {
  validateUploadFile(candidate.file);
  const storedName = `${crypto.randomUUID()}-${sanitizeFilename(candidate.file.name)}`;
  const path = `${questionnaireId}/${responseId}/${candidate.questionId}/${storedName}`;
  const { error } = await getSupabaseServerClient()
    .storage.from(QUESTIONNAIRE_UPLOAD_BUCKET)
    .upload(path, candidate.file.stream(), {
      contentType: candidate.file.type,
      upsert: false,
    });
  if (error) throw new Error(`Upload mislukt: ${error.message}`);
  return {
    questionId: candidate.questionId,
    filename: candidate.file.name.slice(0, 200),
    path,
    size: candidate.file.size,
    mimeType: candidate.file.type,
    uploadedAt: new Date().toISOString(),
  };
}

export async function createUploadSignedUrl(path: string, expiresInSeconds = 300): Promise<string> {
  const { data, error } = await getSupabaseServerClient()
    .storage.from(QUESTIONNAIRE_UPLOAD_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) throw new Error(`Signed URL aanmaken mislukt: ${error?.message ?? "onbekende fout"}`);
  return data.signedUrl;
}
