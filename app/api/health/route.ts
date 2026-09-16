import { NextResponse } from "next/server";
import { getAIConfig } from "@/lib/ai/config";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAutonomyLevel } from "@/lib/automation/limits";

/**
 * Fase 12 §U — productie-diagnostiek.
 * Read-only, lekt NOOIT secrets: geen keys, geen headers, geen payloads.
 * Biedt de human-checkbare runtime-status (AI-mode, Supabase, autonomy).
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const checkStarted = Date.now();

  // AI-config: productie fail-loud vangbaar en zichtbaar maken (geen crash hier).
  let ai: Record<string, unknown>;
  try {
    const config = getAIConfig();
    ai = {
      mode: config.mode,
      providerReady: config.mode === "live" ? Boolean(config.apiKey) : "mock (geen provider nodig)",
      models: config.models,
      maxRequestsPerRun: config.maxRequestsPerRun,
    };
  } catch (error) {
    ai = { error: error instanceof Error ? error.message : "AI-configuratie mislukt" };
  }

  // Supabase: geconfigureerd + daadwerkelijk bereikbaar (lichte count-query).
  let supabase: Record<string, unknown>;
  if (isSupabaseConfigured()) {
    try {
      const { error } = await getSupabaseServerClient().from("automations").select("id", { count: "exact", head: true });
      supabase = { configured: true, reachable: !error, error: error ? error.message : null };
    } catch (e) {
      supabase = { configured: true, reachable: false, error: e instanceof Error ? e.message : "connectiefout" };
    }
  } else {
    supabase = { configured: false, reachable: false, error: "Supabase-omgevingsvariabelen ontbreken — repositories draaien op mock." };
  }

  return NextResponse.json(
    {
      status: "ok",
      service: "silvijn-studio-ai",
      environment: process.env.NODE_ENV ?? "unknown",
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - checkStarted,
      ai,
      supabase,
      automation: {
        autonomyLevel: getAutonomyLevel(),
        scheduler: "disabled", // Fase 12: scheduler is NIET actief; activering vereist expliciete toestemming.
        forbiddenActions: ["send", "publish", "approve", "deliver", "charge"],
      },
    },
    { headers: { "cache-control": "no-store" } }
  );
}
