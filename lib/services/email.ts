/**
 * EmailProvider abstraction — verzenden van outreach-emails.
 * Providers zijn onderling uitwisselbaar; credentials komen altijd
 * uit environment variables, nooit uit de code.
 */

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
  // Later: keuze op basis van EMAIL_PROVIDER + API key uit environment
  // variables (Resend, Postmark, SendGrid, etc.). Zonder configuratie
  // blijft het systeem veilig in mock mode.
  return new MockEmailProvider();
}
