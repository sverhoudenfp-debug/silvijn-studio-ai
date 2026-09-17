import "server-only";
import { z } from "zod";
import { humanRpc } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { transitionInput } from "./validation";
export async function transitionLead(input: z.input<typeof transitionInput>) {
 const v=transitionInput.parse(input);
 await humanRpc("transition_lead",{p_lead:v.leadId,p_expected:v.expected,p_next:v.next,p_reason:v.reason,p_project:v.projectId??null,p_message:v.messageId??null});
}
/** Trusted server operation, not a human-approval operation. SQL enforces the existing financial gate. */
export async function startProjectProduction(projectId:string) {
 const {error}=await getSupabaseServerClient().rpc("start_project_production",{p_project:z.uuid().parse(projectId)});
 if(error) throw new Error(error.message);
}
