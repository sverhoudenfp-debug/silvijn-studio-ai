"use server";

import { revalidatePath } from "next/cache";
import { requireStudioOwner } from "@/lib/auth/server";
import { replyHandlingModeSchema, setReplyHandlingMode, type ReplyHandlingMode } from "@/lib/settings/studio-settings";

/** Owner-only: bepaalt wat de Gmail-ingest-tick met nieuwe reacties mag doen. */
export async function setReplyHandlingModeAction(mode: string): Promise<{ ok: true; mode: ReplyHandlingMode } | { ok: false; error: string }> {
  await requireStudioOwner();
  const parsed = replyHandlingModeSchema.safeParse(mode);
  if (!parsed.success) return { ok: false, error: "Ongeldige modus" };
  try {
    const saved = await setReplyHandlingMode(parsed.data);
    revalidatePath("/settings");
    return { ok: true, mode: saved };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Instelling kon niet worden opgeslagen" };
  }
}
