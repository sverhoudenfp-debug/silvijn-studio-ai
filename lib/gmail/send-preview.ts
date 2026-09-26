import "server-only";
import { z } from "zod";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { requireGmailConfig } from "./config";
import { getGmailAccessToken } from "./tokens";
import { buildGmailMime, signatureHtmlToText } from "./client";
import { buildFromHeader } from "./send-as";
import { checkSendAsAlias } from "./send-as-check";
import { resolveAliasSignature, resolveReplyThreadHeaders } from "./send";

/**
 * Verzendvoorbeeld (droge run) van een outreach-draft: exact dezelfde stappen
 * als sendOutreachViaGmail tot en met de MIME-opbouw (live alias-controle via
 * settings.sendAs, From met Gmail-weergavenaam, alias-handtekening één keer,
 * threading-headers), maar ZONDER verzendclaim en ZONDER Gmail-send. Er wordt
 * niets geschreven; het draft en de lead blijven onaangeraakt.
 *
 * De Message-ID is een voorbeeldwaarde; de echte verzending genereert zelf een
 * nieuwe. Ontbreekt een e-mailadres voor de lead, dan wordt dat expliciet
 * gemeld (de echte verzending zou dan weigeren) en de MIME met een duidelijk
 * ongeldige placeholder opgebouwd.
 */
export interface OutreachSendPreview {
  readonly draftId: string;
  readonly draftStatus: string;
  readonly sendWouldBeRefused: string | null;
  readonly account: string;
  readonly sendAs: {
    readonly ok: boolean;
    readonly status: string;
    readonly reason: string | null;
    readonly email: string | null;
    readonly displayName: string | null;
    readonly verificationStatus: string | null;
    readonly hasSignature: boolean;
  };
  readonly headers: {
    readonly from: string | null;
    readonly to: string;
    readonly subject: string;
    readonly messageId: string;
    readonly inReplyTo: string | null;
    readonly references: string | null;
    readonly threadId: string | null;
  };
  readonly signature: {
    readonly applied: boolean;
    readonly reason: string;
    readonly firstLine: string | null;
    readonly occurrencesInPlainPart: number;
    readonly occurrencesInHtmlPart: number;
  };
  readonly mime: string | null;
}

export const PREVIEW_TO_PLACEHOLDER = "geen-adres-bekend@fixture.invalid";

export async function buildOutreachSendPreview(draftId: string): Promise<OutreachSendPreview> {
  const id = z.uuid().parse(draftId);
  if (!isSupabaseConfigured()) throw new Error("BLOCKED_EXTERNAL_CONFIGURATION: database niet geconfigureerd");
  const client = getSupabaseServerClient();
  const config = requireGmailConfig();

  const { data: draft, error } = await client
    .from("outreach_drafts")
    .select("id,lead_id,status,channel,subject,body,provider_message_id,conversation_id")
    .eq("id", id)
    .single();
  if (error || !draft) throw new Error("Outreach-draft niet gevonden");
  if (draft.channel !== "email") throw new Error("Alleen e-mailoutreach kan via Gmail worden verzonden");

  const { data: contact } = await client
    .from("lead_contacts")
    .select("address")
    .eq("lead_id", draft.lead_id)
    .eq("channel", "email")
    .limit(1);
  const { data: lead } = await client.from("leads").select("email").eq("id", draft.lead_id).single();
  const to: string | null = contact?.[0]?.address ?? lead?.email ?? null;

  const refusals: string[] = [];
  if (draft.status !== "approved") refusals.push(`draft-status is "${draft.status}" (alleen approved wordt verzonden)`);
  if (draft.provider_message_id) refusals.push("draft is al geclaimd/verzonden");
  if (!to) refusals.push("geen e-mailadres bekend voor deze lead");

  const threadHeaders = await resolveReplyThreadHeaders(client, draft.conversation_id);
  const { accessToken, connection } = await getGmailAccessToken(config.accountKey);
  const accountEmail = connection.account_key.toLowerCase();
  if (accountEmail !== config.accountKey) refusals.push(`gekoppeld account ${accountEmail} is niet ${config.accountKey}`);

  const sendAs = await checkSendAsAlias({
    accessToken,
    grantedScopes: connection.scopes,
    accountEmail,
    sendAsEmail: config.sendAsEmail,
  });
  if (!sendAs.ok) refusals.push(`SEND_AS_ALIAS_UNAVAILABLE (${sendAs.status}): ${sendAs.reason}`);

  const messageId = `<preview-${id}@silvijnstudio.com>`;
  const base = {
    draftId: id,
    draftStatus: draft.status,
    sendWouldBeRefused: refusals.length ? refusals.join("; ") : null,
    account: connection.account_key,
  };
  if (!sendAs.ok) {
    return {
      ...base,
      sendAs: { ok: false, status: sendAs.status, reason: sendAs.reason, email: null, displayName: null, verificationStatus: null, hasSignature: false },
      headers: { from: null, to: to ?? PREVIEW_TO_PLACEHOLDER, subject: draft.subject, messageId, ...threadHeaders },
      signature: { applied: false, reason: "alias_unavailable", firstLine: null, occurrencesInPlainPart: 0, occurrencesInHtmlPart: 0 },
      mime: null,
    };
  }

  const from = buildFromHeader(sendAs.alias);
  const signature = resolveAliasSignature(sendAs.alias.signatureHtml, draft.body);
  const mime = buildGmailMime({
    from,
    to: to ?? PREVIEW_TO_PLACEHOLDER,
    subject: draft.subject,
    body: draft.body,
    messageIdHeader: messageId,
    signatureHtml: signature.html,
    ...threadHeaders,
  });

  const firstLine = sendAs.alias.signatureHtml
    ? signatureHtmlToText(sendAs.alias.signatureHtml).split("\n").map((l) => l.trim()).find((l) => l.length >= 6) ?? null
    : null;
  const count = (hay: string, needle: string | null) => (needle ? hay.split(needle).length - 1 : 0);
  const [plainPart, htmlPart] = splitAlternativeParts(mime);

  return {
    ...base,
    sendAs: {
      ok: true,
      status: sendAs.status,
      reason: null,
      email: sendAs.alias.sendAsEmail,
      displayName: sendAs.alias.displayName,
      verificationStatus: sendAs.alias.verificationStatus,
      hasSignature: Boolean(sendAs.alias.signatureHtml),
    },
    headers: { from, to: to ?? PREVIEW_TO_PLACEHOLDER, subject: draft.subject, messageId, ...threadHeaders },
    signature: {
      applied: Boolean(signature.html),
      reason: signature.reason,
      firstLine,
      occurrencesInPlainPart: count(plainPart, firstLine),
      occurrencesInHtmlPart: count(htmlPart, firstLine),
    },
    mime,
  };
}

/** Splitst een multipart/alternative-MIME in [plain, html]; single-part → [body, ""]. */
export function splitAlternativeParts(mime: string): [string, string] {
  const m = mime.match(/boundary="([^"]+)"/);
  if (!m) return [mime, ""];
  const parts = mime.split(`--${m[1]}`);
  const plain = parts.find((p) => /text\/plain/.test(p)) ?? "";
  const html = parts.find((p) => /text\/html/.test(p)) ?? "";
  return [plain, html];
}
