import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStudioOwner } from "@/lib/auth/server";
import { getConversationPage } from "@/lib/sales/conversations";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { leadLifecycleMeta } from "@/lib/leads/lifecycle";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { z } from "zod";
export default async function ConversationsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 await requireStudioOwner();
 const params=await searchParams;
 const lead=typeof params.lead==="string"?params.lead:undefined; const id=typeof params.id==="string"?params.id:undefined;
 if((lead&&!z.uuid().safeParse(lead).success)||(id&&!z.uuid().safeParse(id).success))notFound();
 const page=Math.max(0,parseInt(String(params.page??"0"),10)||0); const messagePage=Math.max(0,parseInt(String(params.messages??"0"),10)||0);
 const [result,leads]=await Promise.all([getConversationPage({leadId:lead,conversationId:id,page,messagePage}),getLeadRepository().list()]);
 if(id&&!result.active)notFound();
 const leadMap=new Map(leads.map(l=>[l.id,l])); const activeLead=result.active?leadMap.get(result.active.lead_id):undefined;
 function href(values:{id?:string;page?:number;messages?:number}){const q=new URLSearchParams();if(lead)q.set("lead",lead);if(values.id)q.set("id",values.id);q.set("page",String(values.page??page));q.set("messages",String(values.messages??0));return `/conversations?${q.toString()}`;}
 return <div className="space-y-6">
  <div><h1 className="text-2xl font-semibold text-zinc-100">Gesprekken</h1><p className="mt-1 text-sm text-zinc-400">Alleen gesprekken met een bevestigde reactie. Uitgaande outreach zonder antwoord staat hier niet.</p></div>
  {result.count===0&&!result.active?<Card className="p-8"><p className="font-medium text-zinc-200">Nog geen gesprekken</p><p className="mt-2 text-sm text-zinc-400">Registreer een werkelijk ontvangen reactie bij de juiste lead. Gmail wordt in deze stap niet gekoppeld.</p>{lead&&<Link className="mt-4 block text-sm text-indigo-300" href={`/leads/${lead}`}>Naar lead en ontvangen reacties</Link>}</Card>:
   <div className="grid min-w-0 gap-6 lg:grid-cols-3">
    <Card className="min-w-0"><CardHeader title="Gesprekken" subtitle={`${result.count} gesprek(ken)`}/><div className="space-y-2">{result.conversations.map(c=>{const l=leadMap.get(c.lead_id);return <Link key={c.id} href={href({id:c.id})} aria-current={result.active?.id===c.id?"page":undefined} className={`block rounded-lg border p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${result.active?.id===c.id?"border-indigo-500 bg-indigo-500/10":"border-zinc-800 hover:bg-zinc-800/50"}`}><p className="break-words text-sm font-medium text-zinc-100">{l?.businessName??"Lead"}</p><p className="mt-1 text-xs text-zinc-400">{c.channel} · {new Date(c.last_reply_at).toLocaleDateString("nl-NL")}</p>{l&&<div className="mt-2"><Badge variant={leadLifecycleMeta[l.leadStatus].variant}>{leadLifecycleMeta[l.leadStatus].label}</Badge></div>}</Link>;})}</div><div className="mt-4 flex gap-4 text-sm text-indigo-300">{page>0&&<Link href={href({page:page-1})}>Vorige</Link>}{(page+1)*30<result.count&&<Link href={href({page:page+1})}>Volgende</Link>}</div></Card>
    {result.active&&<Card className="min-w-0 lg:col-span-2"><CardHeader title={activeLead?.businessName??"Gesprek"} subtitle={result.contact||result.active.channel}/><Link className="text-xs text-indigo-300" href={`/leads/${result.active.lead_id}`}>Lead, lifecycle en reactie registreren</Link><div className="mt-5 space-y-4">{result.messages.map(m=><article key={`${m.direction}-${m.id}`} className={`rounded-xl border p-4 ${m.direction==="inbound"?"border-zinc-700 bg-zinc-800/50":"border-indigo-500/30 bg-indigo-500/5"}`}><p className="text-xs text-zinc-400">{m.direction==="inbound"?"Ontvangen":"Verzonden"} · {new Date(m.occurred_at).toISOString()} {m.source==="manual_verified"?"· handmatig bevestigd":""}</p>{m.subject&&<h2 className="mt-2 break-words text-sm font-semibold text-zinc-100">{m.subject}</h2>}<p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">{m.body}</p></article>)}</div><div className="mt-5 flex flex-wrap gap-4 text-sm text-indigo-300">{messagePage>0&&<Link href={href({id:result.active.id,messages:messagePage-1})}>Eerdere berichten</Link>}{(messagePage+1)*50<result.messageCount&&<Link href={href({id:result.active.id,messages:messagePage+1})}>Latere berichten</Link>}</div><p className="mt-4 text-xs text-zinc-500">Geen automatische verzending of AI-antwoorden vanuit deze pagina.</p></Card>}
   </div>}
 </div>;
}
