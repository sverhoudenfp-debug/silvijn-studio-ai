import { createClient } from "@supabase/supabase-js";
import { AIConfigurationError } from "@/lib/ai/errors";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * SERVER-SIDE Supabase client met de secret key (bypasses RLS).
 * Alleen gebruiken in Server Components, Route Handlers en backend-logica —
 * nooit in client components: SUPABASE_SECRET_KEY mag het serverproces niet verlaten.
 *
 * RLS-beleid: alle tabellen hebben RLS enabled zonder public policies; data-toegang
 * verloopt in Fase 4 uitsluitend server-side via deze client. Authenticatie en
 * publieke policies volgen in de productie/security-fase.
 */

let cachedClient: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim() &&
    (process.env.SUPABASE_SECRET_KEY ?? "").trim()
  );
}

export function getSupabaseServerClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const secretKey = (process.env.SUPABASE_SECRET_KEY ?? "").trim();

  if (!url || !secretKey) {
    throw new AIConfigurationError(
      "Supabase is niet geconfigureerd — NEXT_PUBLIC_SUPABASE_URL en/of SUPABASE_SECRET_KEY ontbreken."
    );
  }

  cachedClient = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}
