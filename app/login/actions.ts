"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { getSessionClient } from "@/lib/auth/server";

// Studio mailbox from Masterconfig, not a user-controlled ownership claim.
const OWNER_EMAIL = "silvijn@silvijnstudio.com";

/**
 * Inloggen met e-mailadres + wachtwoord (2026-10-01, op verzoek van de
 * eigenaar ter vervanging van de magic-link-flow).
 *
 * Beveiliging blijft identiek aan voorheen:
 *  - het e-mailadres moet exact het geautoriseerde studio-account zijn
 *    (server-side gecontroleerd vóór enige Supabase-aanroep);
 *  - na succes wordt dezelfde is_studio_owner-RPC gecontroleerd die de
 *    magic-link-callback en requireStudioOwner() afdwingen;
 *  - alle bestaande pagina-/action-guards (requireStudioOwner) zijn
 *    onveranderd; de sessiebeveiliging (httpOnly cookies via Supabase SSR)
 *    is ongewijzigd.
 * Geen magic-link meer: geen verificatie-e-mail, alleen wachtwoord.
 */
export async function loginWithPassword(form: FormData) {
  const parsed = z.string().email().safeParse(String(form.get("email") ?? "").trim().toLowerCase());
  const password = String(form.get("password") ?? "");
  if (!parsed.success || parsed.data !== OWNER_EMAIL || password.length === 0) redirect("/login?error=invalid");

  const client = await getSessionClient();
  const { error } = await client.auth.signInWithPassword({
    email: parsed.data,
    password,
  });
  if (error) {
    // 400 = onjuiste inloggegevens; 429 = Supabase-frequentielimiet.
    const reason = error.status === 429 ? "rate_limit" : "invalid";
    redirect(`/login?error=${reason}`);
  }

  // Zelfde eigenaar-controle als de auth-callback: een geldige sessie die
  // geen studio-eigenaar is, krijgt geen toegang (defense in depth).
  const { data: owner } = await client.rpc("is_studio_owner");
  if (owner !== true) {
    await client.auth.signOut();
    redirect("/login?error=access_denied");
  }
  redirect("/dashboard");
}

export async function signOut() {
  const client = await getSessionClient();
  await client.auth.signOut();
  redirect("/login");
}
