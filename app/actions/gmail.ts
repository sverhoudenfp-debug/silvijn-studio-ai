"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioOwner } from "@/lib/auth/server";
import { buildGmailAuthUrl } from "@/lib/gmail/oauth";
import { isGmailConfigured, gmailRedirectUriForHost, GMAIL_REDIRECT_HOST_ALLOWLIST } from "@/lib/gmail/config";
import { GMAIL_STATE_COOKIE } from "@/lib/gmail/oauth-state";
import { disconnectGmailConnection, getGmailAccessToken } from "@/lib/gmail/tokens";
import { requireGmailConfig } from "@/lib/gmail/config";
import { checkSendAsAlias } from "@/lib/gmail/send-as-check";
import type { SendAsResolution } from "@/lib/gmail/send-as";
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

/**
 * Live hercontrole van het "Verzenden als"-alias (settings.sendAs.list) op het
 * gekoppelde primaire account; legt de uitkomst vast op de verbinding. Puur
 * lezen bij Google, nooit aanmaken of wijzigen.
 */
export async function recheckGmailSendAs(): Promise<SendAsResolution> {
  await requireStudioOwner();
  const config = requireGmailConfig();
  const { accessToken, connection } = await getGmailAccessToken(config.accountKey);
  const result = await checkSendAsAlias({
    accessToken,
    grantedScopes: connection.scopes,
    accountEmail: connection.account_key.toLowerCase(),
    sendAsEmail: config.sendAsEmail,
  });
  revalidatePath("/settings");
  return result;
}

export async function syncGmailInbox(): Promise<GmailIngestResult> {
  await requireStudioOwner();
  const result = await ingestGmailInbox();
  revalidatePath("/conversations");
  revalidatePath("/settings");
  return result;
}

/**
 * Resultaat van een expliciete verzendactie. In Next 16 mag een Server Action
 * voor VERWACHTE fouten geen throw doen: de client-render crasht dan met
 * "Minified React error #441" (Server Components-renderfout, geen error.tsx
 * op /outreach). Alle fouten komen daarom als getypeerd resultaat terug en
 * worden server-side gelogd; de UI toont ze zonder de pagina te breken.
 * Onverwachte fouten worden nooit ingeslikt: zelfde resultaatkanaal + log.
 */
export type SendDraftResult =
  | { ok: true; sentAt: string }
  | { ok: false; error: string };

export async function sendApprovedOutreachDraft(draftId: string): Promise<SendDraftResult> {
  await requireStudioOwner();
  try {
    if (!isGmailConfigured()) {
      return {
        ok: false,
        error: "BLOCKED_EXTERNAL_CONFIGURATION: Gmail OAuth is niet geconfigureerd (Vercel Environment Variables)",
      };
    }
    z.uuid().parse(draftId);
    const sent = await sendOutreachViaGmail(draftId);
    revalidatePath("/outreach");
    return { ok: true, sentAt: sent.sentAt };
  } catch (error) {
    // Server-side log voor Vercel/observability; de eigenaar ziet de
    // leesbare melding in het dashboard.
    console.error("[outreach-send] verzenden mislukt:", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Verzenden via Gmail mislukt",
    };
  }
}
