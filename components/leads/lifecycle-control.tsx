"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transitionLeadAction } from "@/app/actions/lead-lifecycle";
import { listInboundMessagesAction } from "@/app/actions/sales";
import { nextLeadStates, leadLifecycleMeta } from "@/lib/leads/lifecycle";
import type { LeadStatus } from "@/lib/types";
import type { InboundMessage } from "@/lib/sales/types";
import { Badge } from "@/components/ui/badge";
const field="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500";
export function LifecycleControl({leadId,status,projectId}:{leadId:string;status:LeadStatus;projectId?:string}){
 const router=useRouter(); const options=nextLeadStates(status);
 const [next,setNext]=useState<LeadStatus|"">(options[0]??""); const [reason,setReason]=useState(""); const [messageId,setMessageId]=useState("");
 const [messages,setMessages]=useState<InboundMessage[]>([]); const [error,setError]=useState(""); const [pending,start]=useTransition();
 useEffect(()=>{let active=true;listInboundMessagesAction(leadId).then(rows=>{if(active)setMessages(rows.filter(r=>r.replyConfirmed));}).catch(()=>{if(active)setError("Reacties konden niet worden geladen.");});return()=>{active=false;};},[leadId]);
 return <section className="space-y-3">
  <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-zinc-400">Lead / sales lifecycle</span><Badge variant={leadLifecycleMeta[status].variant}>{leadLifecycleMeta[status].label}</Badge></div>
  {status==="won"&&<p className="text-xs text-amber-300">Legacy WON is behouden. Dit bewijst geen prijsacceptatie, betaling of levering.</p>}
  {projectId&&<Link className="block break-all text-xs text-indigo-300" href={`/projects/${projectId}`}>Projectcontext bekijken</Link>}
  <Link className="block text-xs text-indigo-300" href={`/conversations?lead=${leadId}`}>Gekoppelde gesprekken en berichten</Link>
  {options.length>0&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();if(!next)return;setError("");start(async()=>{const result=await transitionLeadAction({leadId,expected:status,next,reason,projectId,messageId:messageId||null});if(result.error)setError(result.error);else router.refresh();});}}>
   <label className="block text-xs text-zinc-300">Volgende status<select className={field} value={next} onChange={e=>setNext(e.target.value as LeadStatus)}>{options.map(s=><option key={s} value={s}>{leadLifecycleMeta[s].label}</option>)}</select></label>
   <label className="block text-xs text-zinc-300">Reden / vastgestelde feiten<textarea className={field} value={reason} onChange={e=>setReason(e.target.value)} required minLength={3} maxLength={2000}/></label>
   <label className="block text-xs text-zinc-300">Onderliggende reactie<select className={field} value={messageId} onChange={e=>setMessageId(e.target.value)} required={next==="price_accepted"}><option value="">Geen reactie geselecteerd</option>{messages.map(m=><option key={m.id} value={m.id}>{m.subject||m.sender} ({new Date(m.receivedAt).toLocaleDateString("nl-NL")})</option>)}</select></label>
   <p className="text-xs text-zinc-500">De server controleert relaties, brongegevens en betaalvoorwaarden. Deze actie bevestigt geen betaling, keurt geen website goed en levert niets op.</p>
   <button disabled={pending} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{pending?"Controleren...":"Status opslaan"}</button>
  </form>}
  {error&&<p role="alert" className="break-words text-sm text-amber-300">{error}</p>}
 </section>;
}
