import "server-only";
import { z } from "zod";
import { humanRpc, requireStudioOwner } from "@/lib/auth/server";
import { confirmedReplyInput } from "./conversation-input";
export async function recordConfirmedReply(input:z.input<typeof confirmedReplyInput>) {
 const v=confirmedReplyInput.parse(input);
 return z.uuid().parse(await humanRpc("record_prospect_reply",{p_lead:v.leadId,p_channel:"email",p_sender:v.sender,p_subject:v.subject,p_body:v.body,p_received:v.receivedAt,p_key:v.requestId,p_outreach:v.outreachId??null,p_thread:v.threadKey}));
}

export type { ConversationRow, ConversationMessageRow, ConversationListItem } from "./conversation-list";
export { buildConversationList } from "./conversation-list";
import { buildConversationList as buildList } from "./conversation-list";
import type { ConversationRow, ConversationMessageRow, ConversationListItem } from "./conversation-list";
const buildConversationList = buildList;

export async function markConversationRead(conversationId:string):Promise<void> {
 await humanRpc("mark_conversation_read",{p_conversation:z.uuid().parse(conversationId)});
}

export async function getConversationPage(input:{leadId?:string;conversationId?:string;page:number;messagePage:number}) {
 const {client}=await requireStudioOwner();
 const page=Math.max(0,Math.min(100000,Math.floor(input.page)||0)); const messagePage=Math.max(0,Math.min(100000,Math.floor(input.messagePage)||0));
 let query=client.from("conversations").select("id,lead_id,contact_id,channel,thread_key,first_reply_id,last_reply_at,owner_last_read_at",{count:"exact"});
 if(input.leadId) query=query.eq("lead_id",z.uuid().parse(input.leadId));
 const rows=await query.order("last_reply_at",{ascending:false}).order("id").range(page*30,page*30+29);
 if(rows.error) throw new Error("Conversations could not be loaded");
 const conversations=(rows.data??[]) as ConversationRow[];
 let active:ConversationRow|null=conversations[0]??null;
 if(input.conversationId){
  let q=client.from("conversations").select("id,lead_id,contact_id,channel,thread_key,first_reply_id,last_reply_at,owner_last_read_at").eq("id",z.uuid().parse(input.conversationId));
  if(input.leadId) q=q.eq("lead_id",z.uuid().parse(input.leadId));
  const found=await q.maybeSingle(); if(found.error) throw new Error("Conversation could not be loaded"); active=found.data as ConversationRow|null;
 }
 if(!active) return {conversations:[],active:null,messages:[] as ConversationMessageRow[],messageCount:0,count:rows.count??0,contact:null as string|null,contactAddresses:{} as Record<string,string>,listItems:[] as ConversationListItem[]};

 // Contactadressen en laatste berichten voor de lijstweergave (één query per bron).
 const contactIds=[...new Set([...conversations.map((c)=>c.contact_id),active.contact_id])];
 const [messages,contact,contactRows,lastMessages]=await Promise.all([
  client.from("conversation_messages").select("id,lead_id,conversation_id,direction,sender,subject,body,occurred_at,source",{count:"exact"}).eq("conversation_id",active.id).eq("lead_id",active.lead_id).order("occurred_at").order("direction").order("id").range(messagePage*50,messagePage*50+49),
  client.from("lead_contacts").select("address").eq("id",active.contact_id).eq("lead_id",active.lead_id).single(),
  client.from("lead_contacts").select("id,address").in("id",contactIds),
  conversations.length>0
   ? client.from("conversation_messages").select("id,conversation_id,direction,sender,subject,body,occurred_at,source").in("conversation_id",conversations.map((c)=>c.id)).order("occurred_at",{ascending:true})
   : Promise.resolve({data:[] as ConversationMessageRow[],error:null as unknown}),
 ] as const);
 if(messages.error||contact.error||contactRows.error||lastMessages.error) throw new Error("Conversation messages could not be loaded safely");
 const contactAddresses:Record<string,string>={};
 for(const row of (contactRows.data??[]) as {id:string;address:string}[]) contactAddresses[row.id]=row.address;
 const listItems=buildConversationList(conversations,(lastMessages.data??[]) as ConversationMessageRow[],contactAddresses);
 return {conversations,active,messages:(messages.data??[]) as ConversationMessageRow[],messageCount:messages.count??0,count:rows.count??0,contact:contact.data.address as string|null,contactAddresses,listItems};
}
