"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioOwner } from "@/lib/auth/server";
import { buildGmailAuthUrl } from "@/lib/gmail/oauth";
import { isGmailConfigured, gmailRedirectUriForHost, GMAIL_REDIRECT_HOST_ALLOWLIST } from "@/lib/gmail/config";
import { GMAIL_STATE_COOKIE } from "@/lib/gmail/oauth-state";
import { disconnectGmailConnection } from "@/lib/gmail/tokens";
import { ingestGmailInbox, gmailIngestStatus } from "@/lib/gmail/ingest";
import { sendOutreachViaGmail } from "@/lib/gmail/send";
import type { GmailIngestResult, GmailIngestStatus } from "@/lib/gmail/ingest";

/**
 * Server actions — de enige entree naar de Gmail-integratie vanuit de UI.
 * Verbinden, synchroniseren en verzenden zijn altijd expliciete
 * eigenaarsacties; er bestaat geen automatisch/autonoom verzenden of
 * ingest-planning (die volgt pas in de automationsfase).
 */


export async function getGmailStatus(): Promise<GmailIngestStatus> {
  await requireStudioOwner();
  return gmailIngestStatus();
}

export async function getGmailRedirectUris(): Promise<string[]> {
  await requireStudioOwner();
  const explicit = (process.env.GMAIL_REDIRECT_URI ?? "").trim();
  const derived = [...GMAIL_REDIRECT_HOST_ALLOWLIST].map((host) => gmailRedirectUriForHost(host)).filter(Boolean) as string[];
  return explicit ? [explicit, ...derived] : derived;
}

export async function startGmailConnect(): Promise<never> {
  await requireStudioOwner();
  const headerList = await headers();
  const host = (headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "app.silvijnstudio.com").split(",")[0].trim();
  const auth = buildGmailAuthUrl(host);
  (await cookies()).set(GMAIL_STATE_COOKIE, auth.state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  redirect(auth.url);
}

export async function disconnectGmail(): Promise<void> {
  await requireStudioOwner();
  await disconnectGmailConnection();
  revalidatePath("/settings");
}

export async function syncGmailInbox(): Promise<GmailIngestResult> {
  await requireStudioOwner();
  const result = await ingestGmailInbox();
  revalidatePath("/conversations");
  revalidatePath("/settings");
  return result;
}

export async function sendApprovedOutreachDraft(draftId: string): Promise<{ ok: true }> {
  await requireStudioOwner();
  if (!isGmailConfigured()) {
    throw new Error("BLOCKED_EXTERNAL_CONFIGURATION: Gmail OAuth is niet geconfigureerd (Vercel Environment Variables)");
  }
  z.uuid().parse(draftId);
  await sendOutreachViaGmail(draftId);
  revalidatePath("/outreach");
  return { ok: true };
}
