"use server";
import { z } from "zod";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionClient } from "@/lib/auth/server";

// Studio mailbox from Masterconfig, not a user-controlled ownership claim.
const OWNER_EMAIL = "silvijn@silvijnstudio.com";

/**
 * Callback-URL voor de magische inloglink. Volgt de host waarop de eigenaar
 * daadwerkelijk inlogt (app.silvijnstudio.com, vercel.app of lokale dev).
 * Supabase dwingt bovendien de uri_allow_list af: niet-toegestane hosts
 * vallen automatisch terug op de geconfigureerde site_url.
 */
async function callbackUrl(): Promise<string> {
  const host = (await headers()).get("host");
  const proto = host?.startsWith("localhost") ? "http" : "https";
  if (host) return `${proto}://${host}/auth/callback`;
  return "https://app.silvijnstudio.com/auth/callback";
}

export async function requestLogin(form: FormData) {
  const parsed = z.string().email().safeParse(String(form.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success || parsed.data !== OWNER_EMAIL) redirect("/login?error=access_denied");
  const client = await getSessionClient();
  const { error } = await client.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: true, emailRedirectTo: await callbackUrl() },
  });
  if (error) {
    // Supabase limiteert ingebouwde e-mailverzending (frequentie/uur); dit is
    // geen configuratiefout maar een korte wachttijd voor de eigenaar.
    const retryable = error.status === 429;
    redirect(retryable ? "/login?error=rate_limit" : "/login?error=delivery");
  }
  redirect("/login?sent=1");
}
export async function signOut() {
  const client = await getSessionClient();
  await client.auth.signOut();
  redirect("/login");
}
