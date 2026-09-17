"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { getSessionClient } from "@/lib/auth/server";

// Studio mailbox from Masterconfig, not a user-controlled ownership claim.
const OWNER_EMAIL = "silvijn@silvijnstudio.com";
export async function requestLogin(form: FormData) {
  const parsed = z.string().email().safeParse(String(form.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success || parsed.data !== OWNER_EMAIL) redirect("/login?error=access_denied");
  const client = await getSessionClient();
  const { error } = await client.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: true, emailRedirectTo: "https://silvijn-studio-ai.vercel.app/auth/callback" },
  });
  if (error) redirect("/login?error=delivery");
  redirect("/login?sent=1");
}
export async function signOut() {
  const client = await getSessionClient();
  await client.auth.signOut();
  redirect("/login");
}
