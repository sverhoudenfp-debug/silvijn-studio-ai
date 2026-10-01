import type { Lead } from "@/lib/types";
import { needsManualContact } from "@/lib/outreach/contactability";

/**
 * Belangrijkste actie per lead (2026-10-01) — deterministisch en puur, zodat
 * de leadtabel, mobile-kaarten en tests dezelfde prioritering delen.
 *
 * Prioriteit (menselijke poorten eerst):
 *  1. Handmatig contact: outreach wil deze lead maar er is geen e-mailadres.
 *  2. Reactie bekijken: er is gereageerd — nooit negeren.
 *  3. Outreach afronden: draft geopend/verzonden maar lead nog niet verder.
 *  4. Demo delen: demo klaar, geen actieve outreach.
 *  5. Outreach genereren: hoge score, nog niet gecontacteerd.
 *  6. Klant — bekijken (won) / Bekijken.
 */

export interface PrimaryAction {
  label: string;
  tone: "warning" | "accent" | "neutral";
}

export function primaryAction(lead: Lead): PrimaryAction {
  if (needsManualContact(lead)) return { label: "Handmatig contact", tone: "warning" };
  if (lead.outreachStatus === "replied" || lead.outreachStatus === "interested") return { label: "Reactie bekijken", tone: "accent" };
  if (lead.outreachStatus === "draft" || lead.outreachStatus === "opened") return { label: "Outreach afronden", tone: "accent" };
  if (lead.demoStatus === "ready") return { label: "Demo delen", tone: "accent" };
  // Won staat vóór outreach-generatie: een gewonnen klant krijgt nooit meer
  // een verkoop-actie aangeraden.
  if (lead.leadStatus === "won") return { label: "Klant — bekijken", tone: "neutral" };
  if (lead.outreachStatus === "not_contacted" && lead.leadScore >= 50) return { label: "Outreach genereren", tone: "accent" };
  return { label: "Bekijken", tone: "neutral" };
}
