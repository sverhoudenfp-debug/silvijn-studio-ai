import { NextResponse, type NextRequest } from "next/server";

/**
 * Cron-endpoint voor de Automation Runtime (Masterconfig productie-runtime).
 *
 * Dit endpoint DRAINS de bestaande queue via de bestaende orchestrator
 * (capability matrix, cost guard, loop protection, human gates onverkort).
 * Het start zelf nooit automations, plaatst zelf nooit items in de queue en
 * nieuw autonoom gedrag — lead discovery blijft owner-getriggerd, outreach-
 * verzending blijft een menselijke actie achter een geconfigureerde
 * Gmail-verbinding.
 *
 * Toegang (in volgorde):
 *   1. Vercel Cron: `Authorization: Bearer <CRON_SECRET>`
 *   2. Alternatieve scheduler: header `x-cron-secret: <CRON_SECRET>`
 *   3. Eigenaarssessie (is_studio_owner) — handmatige drain.
 *
 * FAIL-LOUD: in productie zonder CRON_SECRET-configuratie of zonder
 * Supabase-configuratie geeft dit endpoint 503 BLOCKED_EXTERNAL_
 * CONFIGURATION — nooit stille mock, nooit open drain.
 */

const CONFIGURATION_MISSING = 503;
const UNAUTHORIZED = 401;

function jsonError(status: number, error: string, detail?: string) {
  return NextResponse.json({ ok: false, error, ...(detail ? { detail } : {}) }, { status });
}

async function isAuthorized(request: NextRequest): Promise<{ ok: true } | { ok: false; reason: "config" | "auth" }> {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  const productionRuntime =
    process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";

  // FAIL-LOUD: zonder geconfigureerd secret kan cron niet veilig verifiëren.
  if (productionRuntime && !expected) {
    return { ok: false, reason: "config" };
  }

  if (expected) {
    const authHeader = request.headers.get("authorization") ?? "";
    const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
    const header = request.headers.get("x-cron-secret") ?? "";
    if (bearer === expected || header === expected) return { ok: true };
  }

  // Eigenaarssessie (handmatige drain via dashboard/API).
  try {
    const { isSupabaseConfigured } = await import("@/lib/supabase/server");
    if (!isSupabaseConfigured()) {
      return productionRuntime ? { ok: false, reason: "config" } : { ok: false, reason: "auth" };
    }
    const { getSessionClient } = await import("@/lib/auth/server");
    const client = await getSessionClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (user) {
      const { data: owner } = await client.rpc("is_studio_owner");
      if (owner === true) return { ok: true };
    }
  } catch {
    // Configuratiefout op de sessie-pad → fail-loud in productie.
    if (productionRuntime) return { ok: false, reason: "config" };
  }
  return { ok: false, reason: "auth" };
}

async function handle(request: NextRequest) {
  const auth = await isAuthorized(request);
  if (!auth.ok) {
    return auth.reason === "config"
      ? jsonError(
          CONFIGURATION_MISSING,
          "BLOCKED_EXTERNAL_CONFIGURATION",
          "CRON_SECRET (en/of Supabase-configuratie) ontbreekt in de productie-omgeving — de automation-runtime weigert fail-loud te draaien."
        )
      : jsonError(UNAUTHORIZED, "unauthorized", "Alleen cron met CRON_SECRET of een geldige eigenaarssessie.");
  }

  const { AutomationRuntime, getRuntimeConfig, assertProductionRuntimeConfigured } = await import(
    "@/lib/automation/runtime"
  );
  const { AutomationOrchestrator } = await import("@/lib/automation/orchestrator");
  const { AutomationQueue } = await import("@/lib/automation/queue");

  try {
    assertProductionRuntimeConfigured();
  } catch (error) {
    return jsonError(
      CONFIGURATION_MISSING,
      "BLOCKED_EXTERNAL_CONFIGURATION",
      error instanceof Error ? error.message : String(error)
    );
  }

  const config = getRuntimeConfig();
  if (!config.enabled) {
    return NextResponse.json({
      ok: true,
      disabled: true,
      detail: "AUTOMATION_RUNTIME_ENABLED=false — de runtime staat uit (menselijke configuratie).",
    });
  }

  // De runtime hergebruikt de bestaande orchestrator: alle guards, human
  // gates en de capability matrix blijven volledig geldig.
  const runtime = new AutomationRuntime(new AutomationOrchestrator(), new AutomationQueue());
  try {
    const result = await runtime.drain(config);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    // Infrastructuurfout (database onbereikbaar, …) — expliciet 500:
    return jsonError(500, "runtime_error", error instanceof Error ? error.message : String(error));
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
