import Link from "next/link";
import { requireStudioOwner } from "@/lib/auth/server";
import { getProjectFinance } from "@/lib/payments/service";
import { FinanceForms } from "@/components/projects/finance-forms";
export const dynamic = "force-dynamic";
const euro = (n: number | null) => n === null ? "Nog niet vastgesteld" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);
export default async function FinancePage({ params }: { params: Promise<{ id: string }> }) {
  await requireStudioOwner();
  const { id } = await params;
  const { project, gate, events, approvals } = await getProjectFinance(id);
  return <div className="space-y-6">
    <Link href={`/projects/${id}`} className="text-sm text-indigo-300">Terug naar project</Link>
    <div><h1 className="text-2xl font-semibold text-zinc-100">Prijs en betalingen</h1><p className="text-sm text-zinc-400">{project.name}</p></div>
    <div className="grid gap-4 sm:grid-cols-3">{[["Goedgekeurd totaal", euro(gate.approved)], ["Bevestigd ontvangen", euro(gate.paid)], ["Vereist vóór productie", euro(gate.required)]].map(([label,value]) => <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5"><p className="text-xs text-zinc-400">{label}</p><p className="mt-2 text-xl text-zinc-100">{value}</p></div>)}</div>
    <p className="rounded-lg border border-amber-500/30 p-4 text-sm text-amber-300">{gate.allowed ? "De financiële en scopevoorwaarden voor productie zijn vervuld. Dit is geen websitegoedkeuring of levering." : "Productie geblokkeerd totdat scope, prijs, betaalplan, betaling en requirements aantoonbaar voldoen."} {gate.fullyPaid ? "Volledige betaling bevestigd." : "Eindbetaling is nog niet volledig bevestigd."}</p>
    <FinanceForms projectId={id} paymentPlan={project.payment_plan} outstanding={gate.approved === null ? null : gate.approved-gate.paid} keyId={crypto.randomUUID()}/>
    <section className="rounded-xl border border-zinc-800 p-5"><h2 className="font-semibold text-zinc-100">Betaalhistorie</h2>{events.length===0 ? <p className="mt-3 text-sm text-zinc-400">Geen bevestigde betalingen.</p> : <ul className="mt-3 space-y-3">{events.map(e=><li key={e.id} className="break-words text-sm text-zinc-300">{euro(e.amount)} · {e.reference}<p className="text-xs text-zinc-500">{e.created_at} · gebruiker {e.actor_id}</p></li>)}</ul>}</section>
    <section className="rounded-xl border border-zinc-800 p-5"><h2 className="font-semibold text-zinc-100">Prijsgoedkeuringen</h2><ul className="mt-3 space-y-3">{approvals.map(a=><li key={a.id} className="break-words text-sm text-zinc-300">{euro(a.amount)} · {a.reason || "Berekende prijs goedgekeurd"}<p className="text-xs text-zinc-500">{a.created_at} · gebruiker {a.actor_id}</p></li>)}</ul>{approvals.length===0 && <p className="mt-3 text-sm text-zinc-400">Nog geen goedgekeurde prijs.</p>}</section>
  </div>;
}
