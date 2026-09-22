/**
 * Contactability: outreach e-mail can only go to a verified e-mail address.
 * Google Places never provides e-mail, so discovered leads frequently lack one.
 * Nothing here guesses an address; it only classifies what a human must do.
 */

export type ContactChannel = "email" | "phone_only" | "none";

export function contactChannelFor(lead: { email: string | null; phone: string | null }): ContactChannel {
  if (lead.email && lead.email.trim()) return "email";
  if (lead.phone && lead.phone.trim()) return "phone_only";
  return "none";
}

/** True when outreach would want this lead but no e-mail exists: Silvijn must act. */
export function needsManualContact(lead: {
  leadStatus: string;
  outreachStatus: string;
  email: string | null;
  phone: string | null;
}): boolean {
  if (contactChannelFor(lead) === "email") return false;
  if (!["new", "analyzing", "qualified"].includes(lead.leadStatus)) return false;
  return lead.outreachStatus === "not_contacted";
}

export function manualContactDetail(lead: { phone: string | null }): string {
  const channel = contactChannelFor({ email: null, phone: lead.phone });
  return channel === "phone_only"
    ? `Geen e-mailadres bekend; handmatig contact nodig via telefoon ${lead.phone!.trim()}.`
    : "Geen e-mailadres en geen telefoonnummer bekend; handmatig contact of aanvullend onderzoek nodig.";
}
