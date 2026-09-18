import "server-only";
import { z } from "zod";
import { humanRpc, requireStudioOwner } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type ProductionGate = { allowed: boolean; paid: number; approved: number | null; required: number | null; requirementsComplete: boolean; fullyPaid: boolean };
export async function getProductionGate(projectId: string): Promise<ProductionGate> {
  z.uuid().parse(projectId);
  const { data, error } = await getSupabaseServerClient().rpc("project_production_gate", { p_project: projectId });
  if (error) throw new Error(`Production gate unavailable: ${error.message}`);
  return z.object({ allowed: z.boolean(), paid: z.number(), approved: z.number().nullable(), required: z.number().nullable(), requirementsComplete: z.boolean(), fullyPaid: z.boolean() }).parse(data);
}
/**
 * Getypeerde productie-poortweigering. De poort zelf is een harde,
 * menselijke grens (prijs-/betaalgoedkeuring) en wordt NOOIT verzwakt;
 * deze klasse bestaat uitsluitend zodat aanroepers (server actions) de
 * verwachte weigering kunnen onderscheiden van onverwachte fouten en de
 * ÉCHTE reden aan de eigenaar kunnen tonen i.p.v. een gemaskeerde
 * productiefout ("Minified React error #441").
 */
export class ProductionGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionGateError";
  }
}

export async function assertProductionAuthorized(projectId: string) {
  const gate = await getProductionGate(projectId);
  if (!gate.allowed) {
    throw new ProductionGateError(
      "PRODUCTION_BLOCKED: productie vereist een goedgekeurde scope/prijs, een betaalplan, een bevestigde betaling én complete requirements (Prijsgoedkeuring en betalingen op de projectpagina)."
    );
  }
  return gate;
}
export async function setPaymentPlan(projectId: string, plan: "full" | "split") {
  return humanRpc("set_project_payment_plan", { p_project: z.uuid().parse(projectId), p_plan: z.enum(["full", "split"]).parse(plan) });
}
export async function confirmPayment(input: { projectId: string; amount: number; reference: string; idempotencyKey: string }) {
  const v = z.object({ projectId: z.uuid(), amount: z.number().positive().max(99999999).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001, "Maximaal twee decimalen"), reference: z.string().trim().min(1).max(500), idempotencyKey: z.uuid() }).parse(input);
  return humanRpc("confirm_project_payment", { p_project: v.projectId, p_amount: v.amount, p_reference: v.reference, p_key: v.idempotencyKey });
}
export async function getProjectFinance(projectId: string) {
  const { client } = await requireStudioOwner();
  const [p, events, approvals, gate] = await Promise.all([
    client.from("projects").select("id,name,payment_plan,price_status,price_approval_id,requirements_complete").eq("id", z.uuid().parse(projectId)).single(),
    client.from("payment_events").select("id,amount,reference,actor_id,created_at").eq("project_id", projectId).order("created_at"),
    client.from("price_approvals").select("id,amount,currency,reason,actor_id,created_at").eq("project_id", projectId).order("created_at", { ascending: false }),
    getProductionGate(projectId),
  ]);
  if (p.error || events.error || approvals.error) throw new Error("Financiële gegevens konden niet veilig worden geladen.");
  return { project: p.data, events: events.data, approvals: approvals.data, gate };
}
