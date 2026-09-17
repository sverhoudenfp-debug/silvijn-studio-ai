"use server";
import { requireStudioOwner } from "@/lib/auth/server";
import { transitionLead } from "@/lib/leads/service";
import type { LeadStatus } from "@/lib/types";
import { revalidatePath } from "next/cache";
export async function transitionLeadAction(input:{leadId:string;expected:LeadStatus;next:LeadStatus;reason:string;projectId?:string|null;messageId?:string|null}) {
 await requireStudioOwner();
 try {
  await transitionLead(input);
  for(const route of ["/leads",`/leads/${input.leadId}`,"/conversations","/sales","/projects"]) revalidatePath(route);
  if(input.projectId) revalidatePath(`/projects/${input.projectId}`);
  return {success:true as const};
 } catch(error) {return {error:error instanceof Error?error.message:"State transition failed"};}
}
