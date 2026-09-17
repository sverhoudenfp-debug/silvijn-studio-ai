import "server-only";
import { randomBytes } from "node:crypto";
import type { EmailProvider, OutboundEmail, EmailSendResult } from "@/lib/services/email";
import { requireGmailConfig } from "./config";
import { getGmailAccessToken } from "./tokens";
import { gmailSend } from "./client";

/**
 * GmailEmailProvider — verzendt outreach via de Gmail-API met OAuth
 * (gmail.send). Past in de bestaande EmailProvider-abstrahatie; de mock
 * blijft de default zodat bestaande tests ongewijzigd draaien.
 *
 * Het bericht krijgt een eigen Message-ID (<outreach-…@silvijnstudio.com>)
 * die ook als provider_message_id op het outreach-draft wordt opgeslagen;
 * antwoorden daarop matchen 1-op-1 via In-Reply-To.
 */

export function newOutreachMessageIdHeader(): string {
  return `<outreach-${randomBytes(16).toString("hex")}@silvijnstudio.com>`;
}

export class GmailEmailProvider implements EmailProvider {
  readonly id = "gmail";
  readonly name = "Gmail (OAuth 2.0, studio-account)";
  private readonly accountKey: string;

  /** Fail-loud: EMAIL_PROVIDER=gmail zonder complete OAuth-configuratie
   *  faalt bij constructie — er wordt nooit stil mock verzonden. */
  constructor() {
    this.accountKey = requireGmailConfig().accountKey;
  }

  async send(email: OutboundEmail): Promise<EmailSendResult> {
    const { accessToken } = await getGmailAccessToken(this.accountKey);
    const messageIdHeader = newOutreachMessageIdHeader();
    await gmailSend(accessToken, {
      from: this.accountKey,
      to: email.to,
      subject: email.subject,
      body: email.body,
      messageIdHeader,
    });
    // messageId is de RFC Message-ID die wij zelf in de MIME zetten;
    // hiermee matchen toekomstige antwoorden op dit specifieke bericht.
    return { providerId: this.id, status: "sent", messageId: messageIdHeader };
  }
}

export { gmailSend as _gmailSendForTesting };
