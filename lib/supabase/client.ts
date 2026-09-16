import { createBrowserClient } from "@supabase/ssr";

/**
 * CLIENT-SIDE Supabase client (publishable key — publiek veilig).
 * Voor latere fases met authentication; in Fase 4 is er nog geen client-side
 * databranje. De secret key komt hier NOOIT.
 */
export function getSupabaseBrowserClient() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const publishableKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  if (!url || !publishableKey) return null;
  return createBrowserClient(url, publishableKey);
}
