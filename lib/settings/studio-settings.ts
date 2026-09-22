import "server-only";
import { z } from "zod";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getSessionClient } from "@/lib/auth/server";

/**
 * Studio-instellingen (migratie 0028). Eén sleutel voor nu:
 * reply_handling_mode — wat de Gmail-ingest-tick met nieuw gekoppelde
 * prospect-reacties mag doen. Default en fallback zijn altijd "off":
 * zonder database, zonder rij of bij een leesfout draait er nooit AI
 * vanuit de tick. Schrijven kan uitsluitend via de owner-only RPC
 * (is_studio_owner) — service_role wordt door PostgreSQL geweigerd.
 */
export const replyHandlingModeSchema = z.enum(["off", "review", "auto"]);
export type ReplyHandlingMode = z.infer<typeof replyHandlingModeSchema>;

export const REPLY_HANDLING_LABELS: Record<ReplyHandlingMode, { label: string; description: string }> = {
  off: { label: "Uit", description: "Alleen inlezen en koppelen. AI verwerkt reacties pas als jij dat in het dashboard start." },
  review: { label: "Review", description: "AI analyseert elke gekoppelde reactie en zet een antwoordconcept klaar. Jij verstuurt." },
  auto: {
    label: "Autonoom",
    description:
      "AI antwoordt zelf waar toegestaan. Prijsvragen, afmeldingen, twijfel en kwaliteitsfouten gaan altijd naar jou; prijzen, betalingen en levering blijven menselijk.",
  },
};

let memoryMode: ReplyHandlingMode = "off";

export async function getReplyHandlingMode(): Promise<ReplyHandlingMode> {
  if (!isSupabaseConfigured()) return memoryMode;
  try {
    const { data, error } = await getSupabaseServerClient()
      .from("studio_settings")
      .select("value")
      .eq("key", "reply_handling_mode")
      .maybeSingle();
    if (error || !data) return "off";
    const parsed = replyHandlingModeSchema.safeParse(data.value);
    return parsed.success ? parsed.data : "off";
  } catch {
    return "off";
  }
}

/** Alleen via de eigenaarssessie; de RPC controleert is_studio_owner zelf. */
export async function setReplyHandlingMode(mode: ReplyHandlingMode): Promise<ReplyHandlingMode> {
  const value = replyHandlingModeSchema.parse(mode);
  if (!isSupabaseConfigured()) {
    memoryMode = value;
    return value;
  }
  const client = await getSessionClient();
  const { error } = await client.rpc("set_studio_setting", { p_key: "reply_handling_mode", p_value: value });
  if (error) throw new Error(error.message.includes("HUMAN_AUTHORIZATION_REQUIRED") ? "HUMAN_AUTHORIZATION_REQUIRED" : error.message);
  return value;
}
