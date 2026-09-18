import "server-only";
import { z } from "zod";
import { isLeadTransitionAllowed, leadLifecycleStates, type LeadLifecycleStatus } from "./lifecycle";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * AI-toegestane lead-transities (Fase E). Dit is de applicatie-spiegel van
 * de SQL-whitelist in migratie 0018 (transition_lead_automated).
 *
 * HARDE GRENS: geen enkele menselijke gate is AI-toegestane.
 * silvijn_approval, price_presented, price_accepted, payment_pending,
 * deposit_paid, paid, in_progress, ready_for_silvijn, final_payment_pending,
 * paid_in_full, approved, delivered, won en lost blijven uitsluitend
 * menselijke beslissingen (transition_lead, 0012).
 */
export const AUTOMATED_TRANSITION_TARGETS: readonly LeadLifecycleStatus[] = [
  "contacted",
  "demo_offered",
  "demo_sent",
  "interested",
  "demo_interested",
  "website_interested",
  "qualifying",
  "price_ready",
  "opted_out",
  "not_interested",
] as const;

export function isAutomatedTransitionTarget(next: LeadLifecycleStatus): boolean {
  return (AUTOMATED_TRANSITION_TARGETS as readonly string[]).includes(next);
}

const stateSchema = z.string().refine((value): value is LeadLifecycleStatus =>
  (leadLifecycleStates as string[]).includes(value), { message: "Onbekende lifecycle-status" });

// leadId/messageId zijn UUIDs in productie (Supabase); in memory-mode zijn
// de legitieme test-IDs (ld-xxx/uuid) geen UUID. Strikte UUID-validatie
// vindt plaats op de productieweg zelf (injectie-hardening PostgREST).
const automatedTransitionInput = z.object({
  leadId: z.string().min(1),
  expected: stateSchema,
  next: stateSchema,
  reason: z.string().trim().min(3).max(2000),
  messageId: z.string().min(1).nullable().optional(),
});

/**
 * Voert een AI-toegestane lead-transitie uit: dezelfde lifecycle-validatie
 * en dezelfde SQL-bewijsguards als de menselijke weg. In Supabase-mode
 * verloopt de schrijving via de service-role RPC (0018); de menselijke
 * transition_lead (0012) blijft onaangetast.
 */
export async function automatedLeadTransition(
  input: z.input<typeof automatedTransitionInput>
): Promise<void> {
  const parsed = automatedTransitionInput.parse(input);
  if (!isAutomatedTransitionTarget(parsed.next)) {
    throw new Error(`AUTOMATED_TRANSITION_FORBIDDEN: "${parsed.next}" is geen AI-toegestane status`);
  }
  if (!isLeadTransitionAllowed(parsed.expected, parsed.next)) {
    throw new Error(`ONGELDIGE_TRANSITIE: ${parsed.expected} -> ${parsed.next} staat niet in de lifecycle`);
  }

  if (isSupabaseConfigured()) {
    const { error } = await getSupabaseServerClient().rpc("transition_lead_automated", {
      p_lead: z.uuid().parse(parsed.leadId),
      p_expected: parsed.expected,
      p_next: parsed.next,
      p_reason: parsed.reason,
      p_message: parsed.messageId ?? null,
    });
    if (error) throw new Error(error.message);
    return;
  }

  // Memory-mode (development/tests): zelfde lifecycle-validatie, lokaal toegepast.
  const lead = await getLeadRepository().get(parsed.leadId);
  if (!lead) throw new Error("Lead niet gevonden");
  if (lead.leadStatus !== parsed.expected) throw new Error("STALE_LEAD_STATE_REFRESH_REQUIRED");
  if (lead.leadStatus === parsed.next) return;
  const updated = await getLeadRepository().updateStatuses(parsed.leadId, { leadStatus: parsed.next });
  if (!updated) throw new Error("Lead-statusupdate mislukt");
}
