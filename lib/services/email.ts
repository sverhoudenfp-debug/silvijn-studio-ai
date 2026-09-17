/**
 * EmailProvider abstraction — verzenden van outreach-emails.
 * Providers zijn onderling uitwisselbaar; credentials komen altijd
 * uit environment variables, nooit uit de code.
 */

import { GmailEmailProvider } from "@/lib/gmail/provider";

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
  leadId: string;
}

export interface EmailSendResult {
  providerId: string;
  status: "sent" | "mocked";
  messageId: string;
}

export interface EmailProvider {
  readonly id: string;
  readonly name: string;
  send(email: OutboundEmail): Promise<EmailSendResult>;
}

export class MockEmailProvider implements EmailProvider {
  readonly id = "mock";
  readonly name = "Mock email provider (development mode)";

  async send(email: OutboundEmail): Promise<EmailSendResult> {
    console.log(`[mock email] to=${email.to} lead=${email.leadId} subject="${email.subject}"`);
    return {
      providerId: this.id,
      status: "mocked",
      messageId: `mock-${Date.now()}`,
    };
  }
}

export function getEmailProvider(): EmailProvider {
  // EMAIL_PROVIDER bepaalt de provider; credentials komen altijd uit
  // environment variables. Standaard (en in tests) blijft de mock.
  // EMAIL_PROVIDER=gmail zonder complete OAuth-configuratie faalt
  // expliciet (fail-loud): er wordt nooit stil mock verzonden.
  const provider = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (provider === "gmail") {
    return new GmailEmailProvider();
  }
  if (provider && provider !== "mock") {
    throw new Error(`BLOCKED_EXTERNAL_CONFIGURATION: onbekende EMAIL_PROVIDER '${provider}'`);
  }
  return new MockEmailProvider();
}
