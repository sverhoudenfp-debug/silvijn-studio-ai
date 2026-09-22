import "server-only";

/**
 * G8 — omgevingscontrole. Rapporteert uitsluitend AANWEZIGHEID van
 * configuratie (nooit waarden, nooit lengtes, nooit prefixen) plus
 * waargenomen gedrag uit bestaande, read-only bronnen. Dit is de plek waar
 * Silvijn ziet of productie werkelijk werkt zoals bedoeld, zonder in Vercel
 * te hoeven kijken of secrets te zien.
 */
export type EnvironmentCheckLevel = "ok" | "warning" | "missing" | "info";

export interface EnvironmentCheck {
  /** Stabiele sleutel, bijv. "ai_mode". */
  key: string;
  label: string;
  level: EnvironmentCheckLevel;
  /** Korte uitleg zonder gevoelige inhoud. */
  detail: string;
  /** Waargenomen bewijs uit productiegedrag (optioneel). */
  evidence: string | null;
}

export interface EnvironmentObservations {
  nodeEnv: string | undefined;
  supabaseConfigured: boolean;
  aiConfig: { ok: true; mode: "live" | "mock" } | { ok: false; error: string };
  gmail: { configured: boolean; connected: boolean; lastIngestAt: string | null };
  lastLiveAiRun: { model: string; createdAt: string | null; status: string } | null;
  lastGoogleDiscoveryRun: { createdAt: string | null; status: string; createdLeads: number } | null;
}

/** Alleen aanwezigheid: een niet-lege waarde telt als aanwezig. */
export function envPresence(env: NodeJS.ProcessEnv, name: string): boolean {
  return Boolean(env[name]?.trim());
}

function fmt(iso: string | null): string {
  if (!iso) return "onbekend tijdstip";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "onbekend tijdstip" : date.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" });
}

/** Puur: dezelfde env + observaties geven altijd dezelfde lijst. Bevat nooit env-waarden. */
export function evaluateEnvironment(env: NodeJS.ProcessEnv, obs: EnvironmentObservations): EnvironmentCheck[] {
  const checks: EnvironmentCheck[] = [];
  const isProd = obs.nodeEnv === "production";

  // Supabase
  checks.push({
    key: "supabase",
    label: "Supabase",
    level: obs.supabaseConfigured ? "ok" : "missing",
    detail: obs.supabaseConfigured ? "URL, publishable key en secret key aanwezig." : "Supabase niet geconfigureerd; de app draait op de mock-laag.",
    evidence: null,
  });

  // AI
  if (!obs.aiConfig.ok) {
    checks.push({ key: "ai_mode", label: "AI-modus", level: "missing", detail: obs.aiConfig.error, evidence: null });
  } else {
    const anthropic = envPresence(env, "ANTHROPIC_API_KEY");
    const live = obs.aiConfig.mode === "live";
    checks.push({
      key: "ai_mode",
      label: "AI-modus",
      level: live ? (anthropic ? "ok" : "missing") : isProd ? "warning" : "info",
      detail: live
        ? anthropic
          ? "AI_MODE=live en Anthropic-sleutel aanwezig."
          : "AI_MODE=live maar ANTHROPIC_API_KEY ontbreekt; elke AI-taak faalt."
        : "AI_MODE=mock: geen echte AI-calls. In productie hoort dit live te zijn.",
      evidence: obs.lastLiveAiRun
        ? `Laatste live AI-run: ${obs.lastLiveAiRun.model} (${obs.lastLiveAiRun.status}) op ${fmt(obs.lastLiveAiRun.createdAt)}.`
        : "Nog geen live AI-run waargenomen.",
    });
  }

  // Gmail
  checks.push({
    key: "gmail",
    label: "Gmail",
    level: !obs.gmail.configured ? "missing" : obs.gmail.connected ? "ok" : "warning",
    detail: !obs.gmail.configured
      ? "GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET of GMAIL_TOKEN_ENCRYPTION_KEY ontbreekt of is ongeldig."
      : obs.gmail.connected
        ? "Geconfigureerd en een mailbox is gekoppeld."
        : "Geconfigureerd, maar er is nog geen mailbox gekoppeld (Verbind Gmail hierboven).",
    evidence: obs.gmail.connected ? `Ingest-cursor (nieuwste gescande mail): ${fmt(obs.gmail.lastIngestAt)}.` : null,
  });

  // Google Places
  const google = envPresence(env, "GOOGLE_PLACES_API_KEY");
  checks.push({
    key: "google_places",
    label: "Google Places",
    level: google ? "ok" : "missing",
    detail: google ? "Sleutel aanwezig; Lead Discovery kan Google gebruiken." : "GOOGLE_PLACES_API_KEY ontbreekt; Lead Discovery via Google weigert (CONFIGURATION).",
    evidence: obs.lastGoogleDiscoveryRun
      ? `Laatste Google-run: ${obs.lastGoogleDiscoveryRun.status}, ${obs.lastGoogleDiscoveryRun.createdLeads} lead(s) op ${fmt(obs.lastGoogleDiscoveryRun.createdAt)}.`
      : "Nog geen Google-discovery-run waargenomen.",
  });

  // KVK (nog niet in de owner-flow gebruikt, wel voorbereid)
  const kvk = envPresence(env, "KVK_API_KEY");
  checks.push({
    key: "kvk",
    label: "KVK",
    level: kvk ? "ok" : "info",
    detail: kvk ? "Sleutel aanwezig (KVK-verificatie is nog niet aan de owner-flow gekoppeld)." : "Geen KVK_API_KEY; KVK-verificatie staat bewust nog uit.",
    evidence: null,
  });

  // CRON_SECRET
  const cron = envPresence(env, "CRON_SECRET");
  checks.push({
    key: "cron_secret",
    label: "CRON_SECRET",
    level: cron ? "ok" : "missing",
    detail: cron
      ? "Aanwezig; cron- en ingest-endpoints weigeren zonder dit secret (401)."
      : "Ontbreekt; de Gmail-ingest-tick en de automation-cron weigeren elke aanroep.",
    evidence: null,
  });

  // Discovery-mock guard
  checks.push({
    key: "discovery_mock",
    label: "Discovery mock-bron",
    level: env.DISCOVERY_ALLOW_MOCK === "true" ? (isProd || obs.supabaseConfigured ? "warning" : "info") : "ok",
    detail:
      env.DISCOVERY_ALLOW_MOCK === "true"
        ? "DISCOVERY_ALLOW_MOCK=true staat aan; in productie en met database wordt mock toch hard geweigerd."
        : "Mock-discovery uitgeschakeld (hard geweigerd in productie).",
    evidence: null,
  });

  return checks;
}

export async function loadEnvironmentStatus(): Promise<{ checks: EnvironmentCheck[]; unavailable: string[] }> {
  const unavailable: string[] = [];
  const [{ isSupabaseConfigured }, { getAIConfig }, { gmailIngestStatus }, { getAIRunRepository }, { getDiscoveryRunRepository }] = await Promise.all([
    import("@/lib/supabase/server"),
    import("@/lib/ai/config"),
    import("@/lib/gmail/ingest"),
    import("@/lib/repositories/ai-run-repository"),
    import("@/lib/repositories/discovery-run-repository"),
  ]);

  let aiConfig: EnvironmentObservations["aiConfig"];
  try {
    aiConfig = { ok: true, mode: getAIConfig().mode };
  } catch (error) {
    aiConfig = { ok: false, error: error instanceof Error ? error.message : "AI-configuratiefout" };
  }

  let gmail: EnvironmentObservations["gmail"] = { configured: false, connected: false, lastIngestAt: null };
  try {
    const status = await gmailIngestStatus();
    gmail = { configured: status.configured, connected: status.connected, lastIngestAt: status.lastIngestAt };
  } catch {
    unavailable.push("gmail-status");
  }

  let lastLiveAiRun: EnvironmentObservations["lastLiveAiRun"] = null;
  try {
    const runs = await getAIRunRepository().listRecent(50);
    const live = runs.find((run) => run.mode === "live");
    if (live) lastLiveAiRun = { model: live.model, createdAt: live.createdAt, status: live.status };
  } catch {
    unavailable.push("ai-runs");
  }

  let lastGoogleDiscoveryRun: EnvironmentObservations["lastGoogleDiscoveryRun"] = null;
  try {
    const runs = await getDiscoveryRunRepository().list(25);
    const google = runs.find((run) => run.source === "google");
    if (google) lastGoogleDiscoveryRun = { createdAt: google.startedAt ?? null, status: google.status, createdLeads: google.createdLeads ?? 0 };
  } catch {
    unavailable.push("discovery-runs");
  }

  const checks = evaluateEnvironment(process.env, {
    nodeEnv: process.env.NODE_ENV,
    supabaseConfigured: isSupabaseConfigured(),
    aiConfig,
    gmail,
    lastLiveAiRun,
    lastGoogleDiscoveryRun,
  });
  return { checks, unavailable };
}
