/**
 * Puure upload-validatie (geen server-only) — unit-testbaar en gedeeld
 * tussen de public action en de server-side service. Zelfde regels als de
 * privé bucket uit migratie 0014: allowlist, 10 MB per bestand.
 */

export const QUESTIONNAIRE_UPLOAD_BUCKET = "questionnaire-uploads";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOADS_PER_QUESTION = 5;
export const MAX_TOTAL_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ALLOWED_UPLOAD_MIMES: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const FILENAME_PATTERN = /[^a-zA-Z0-9._-]+/g;

export class QuestionnaireUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionnaireUploadError";
  }
}

export function sanitizeFilename(filename: string): string {
  const cleaned = filename
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(FILENAME_PATTERN, "-")
    .replace(/^-+|[-.]+$/g, "")
    .slice(0, 120);
  return cleaned || "bestand";
}

export function validateUploadFile(file: File): void {
  if (file.size === 0) throw new QuestionnaireUploadError("Leeg bestand.");
  if (file.size > MAX_UPLOAD_BYTES) throw new QuestionnaireUploadError(`Bestand "\${file.name}" is te groot (max 10 MB).`);
  const type = (file.type || "").toLowerCase().split(";")[0].trim();
  if (!ALLOWED_UPLOAD_MIMES.has(type)) {
    throw new QuestionnaireUploadError(
      `Bestandstype van "\${file.name}" is niet toegestaan. Toegestaan: pdf, png, jpg, webp, txt, doc, docx.`
    );
  }
}

export interface UploadCandidate {
  questionId: string;
  file: File;
}

export interface StoredUpload {
  questionId: string;
  filename: string;
  path: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}
