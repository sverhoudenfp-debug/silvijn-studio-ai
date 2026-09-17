"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { humanRpc, requireStudioOwner } from "@/lib/auth/server";
import { confirmPayment, setPaymentPlan } from "@/lib/payments/service";
export type FinanceResult = { error?: string; success?: string };
function message(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code.includes("IDEMPOTENCY")) return "Deze bevestiging is al gebruikt met andere gegevens. Vernieuw de pagina en controleer de betaalhistorie.";
  if (code.includes("EXCEEDS_APPROVED")) return "Het bedrag overschrijdt de nog openstaande goedgekeurde prijs.";
  if (code.includes("PAYMENT_EXISTS")) return "Er zijn al betalingen. Eerst is een menselijke financiële afstemming nodig.";
  if (code.includes("PRICE_NOT_READY") || code.includes("APPROVED_PRICE")) return "Er is nog geen volledige prijsindicatie of goedgekeurde prijs.";
  if (code.includes("REASON_REQUIRED")) return "Vermeld een reden voor de gewijzigde prijs.";
  return "De wijziging is niet bevestigd. Controleer de invoer en de huidige prijs- en betaalstatus.";
}
export async function savePaymentPlanAction(_previous: FinanceResult, form: FormData): Promise<FinanceResult> {
  await requireStudioOwner();
  try {
    const id = z.uuid().parse(form.get("projectId"));
    await setPaymentPlan(id, z.enum(["full", "split"]).parse(form.get("plan")));
    revalidatePath(`/projects/${id}/finance`);
    return { success: "Betaalplan vastgelegd." };
  } catch (error) { return { error: message(error) }; }
}
export async function confirmPaymentAction(_previous: FinanceResult, form: FormData): Promise<FinanceResult> {
  await requireStudioOwner();
  try {
    z.literal("confirmed").parse(form.get("humanConfirmation"));
    const id = z.uuid().parse(form.get("projectId"));
    await confirmPayment({ projectId: id, amount: Number(form.get("amount")), reference: String(form.get("reference") ?? ""), idempotencyKey: String(form.get("idempotencyKey")) });
    revalidatePath(`/projects/${id}/finance`);
    revalidatePath(`/projects/${id}`);
    return { success: "Betaling door jou bevestigd en met je gebruikers-ID vastgelegd." };
  } catch (error) { return { error: message(error) }; }
}
export async function approveConcretePriceAction(_previous: FinanceResult, form: FormData): Promise<FinanceResult> {
  await requireStudioOwner();
  try {
    const id = z.uuid().parse(form.get("projectId"));
    const amount = z.coerce.number().positive().max(99999999).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001).parse(form.get("amount"));
    z.literal("approved").parse(form.get("humanConfirmation"));
    await humanRpc("approve_project_price", { p_project: id, p_amount: amount, p_reason: z.string().max(2000).parse(form.get("reason") ?? "") });
    revalidatePath(`/projects/${id}/finance`);
    revalidatePath(`/projects/${id}`);
    return { success: "Concrete prijs en bijbehorende scope goedgekeurd. Er is niets naar de klant verstuurd." };
  } catch (error) { return { error: message(error) }; }
}
