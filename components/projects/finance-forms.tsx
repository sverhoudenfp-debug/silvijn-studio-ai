"use client";
import { useActionState } from "react";
import { approveConcretePriceAction, confirmPaymentAction, savePaymentPlanAction, type FinanceResult } from "@/app/actions/finance";
const field = "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500";
const button = "rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50";
function Feedback({ result }: { result: FinanceResult }) { return result.error ? <p role="alert" className="text-sm text-amber-400">{result.error}</p> : result.success ? <p role="status" className="text-sm text-emerald-400">{result.success}</p> : null; }
export function FinanceForms({ projectId, paymentPlan, outstanding, keyId }: { projectId: string; paymentPlan: string | null; outstanding: number | null; keyId: string }) {
  const [price, approve, approving] = useActionState(approveConcretePriceAction, {});
  const [plan, savePlan, saving] = useActionState(savePaymentPlanAction, {});
  const [payment, confirm, confirming] = useActionState(confirmPaymentAction, {});
  return <div className="grid gap-6 lg:grid-cols-3">
    <form action={approve} className="space-y-4 rounded-xl border border-zinc-800 p-5">
      <h2 className="font-semibold text-zinc-100">Concrete prijs goedkeuren</h2>
      <p className="text-xs text-zinc-400">Gebonden aan de nieuwste volledige prijsindicatie en huidige scope. Geen offerte wordt automatisch verstuurd.</p>
      <input type="hidden" name="projectId" value={projectId}/>
      <label className="block text-sm text-zinc-300">Totaalbedrag EUR<input className={field} type="number" name="amount" required min="0.01" step="0.01" /></label>
      <label className="block text-sm text-zinc-300">Reden bij wijziging<textarea name="reason" maxLength={2000} className={field}/></label>
      <label className="flex items-start gap-2 text-xs text-zinc-300"><input type="checkbox" required name="humanConfirmation" value="approved"/>Ik keur deze prijs en scope persoonlijk goed.</label>
      <button className={button} disabled={approving}>Prijs goedkeuren</button><Feedback result={price}/>
    </form>
    <form action={savePlan} className="space-y-4 rounded-xl border border-zinc-800 p-5">
      <h2 className="font-semibold text-zinc-100">Betaalplan van de klant</h2>
      <p className="text-xs text-zinc-400">Leg de keuze van de klant vast. Het plan is vergrendeld zodra een betaling is bevestigd.</p>
      <input type="hidden" name="projectId" value={projectId}/>
      <label className="block text-sm text-zinc-300">Betaalplan<select className={field} name="plan" defaultValue={paymentPlan ?? ""} required><option value="" disabled>Kies het overeengekomen plan</option><option value="full">100% vooraf</option><option value="split">50% vooraf, 50% vóór levering</option></select></label>
      <button className={button} disabled={saving}>Betaalplan opslaan</button><Feedback result={plan}/>
    </form>
    <form action={confirm} className="space-y-4 rounded-xl border border-zinc-800 p-5">
      <h2 className="font-semibold text-zinc-100">Ontvangen betaling bevestigen</h2>
      <p className="text-xs text-zinc-400">Controleer de daadwerkelijke ontvangst zelf. Een Stripe-link, klantbericht of AI-uitspraak geldt niet als betaalbevestiging.</p>
      <input type="hidden" name="projectId" value={projectId}/><input type="hidden" name="idempotencyKey" value={keyId}/>
      <label className="block text-sm text-zinc-300">Ontvangen bedrag EUR<input className={field} type="number" name="amount" required min="0.01" max={outstanding ?? undefined} step="0.01"/></label>
      <label className="block text-sm text-zinc-300">Betaalreferentie<input className={field} name="reference" required maxLength={500}/></label>
      <label className="flex items-start gap-2 text-xs text-zinc-300"><input type="checkbox" required name="humanConfirmation" value="confirmed"/>Ik heb deze betaling daadwerkelijk gecontroleerd.</label>
      <button className={button} disabled={confirming || Boolean(payment.success)}>Betaling bevestigen</button><Feedback result={payment}/>
      {payment.success && <a href={`/projects/${projectId}/finance`} className="block text-xs text-indigo-300 underline">Vernieuwen voor een volgende betaling</a>}
    </form>
  </div>;
}
