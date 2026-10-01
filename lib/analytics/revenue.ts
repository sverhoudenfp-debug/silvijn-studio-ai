import "server-only";
import { cache } from "react";
import { z } from "zod";
import { requireStudioOwner } from "@/lib/auth/server";

/**
 * Bevestigde betalingen (2026-10-01) — analytics-bron voor omzet.
 *
 * payment_events ontstaat uitsluitend via de menselijke confirm_project_payment
 * RPC: elke rij is een door de eigenaar bevestigde echte betaling. Geen enkele
 * andere bron levert omzet: onbetaalde prijsgoedkeuringen, drafts of project-
 * statussen tellen NIET als omzet.
 */

export interface RevenueEvent {
  id: string;
  projectId: string;
  amount: number;
  reference: string;
  createdAt: string;
}

const RevenueEventRow = z.object({
  id: z.string(),
  project_id: z.string(),
  amount: z.number(),
  reference: z.string(),
  created_at: z.string(),
});

const revenueEventsCache = cache(async (): Promise<RevenueEvent[]> => {
  const { client } = await requireStudioOwner();
  const { data, error } = await client
    .from("payment_events")
    .select("id,project_id,amount,reference,created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Betaalgegevens ophalen mislukt: ${error.message}`);
  return (data ?? []).map((row) => RevenueEventRow.parse(row))
    .map((row) => ({ id: row.id, projectId: row.project_id, amount: row.amount, reference: row.reference, createdAt: row.created_at }));
});

/** Per-request gedupliceerde read (één query voor dashboard + analytics). */
export function listRevenueEvents(): Promise<RevenueEvent[]> {
  return revenueEventsCache();
}
