import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import graph from "../lib/leads/lifecycle.json";
import { canCreateProjectForLead, isOutreachSuppressed, isLeadTransitionAllowed, leadLifecycleMeta, leadLifecycleStates, nextLeadStates } from "../lib/leads/lifecycle";
import { transitionInput } from "../lib/leads/validation";
import { confirmedReplyInput } from "../lib/sales/conversation-input";
const migration=readFileSync("supabase/migrations/0012_core_lead_conversations.sql","utf8");
const id="10000000-0000-4000-8000-000000000001";
test("every canonical state and all legacy values remain supported",()=>{
 const canonical="NEW ANALYZING DEMO_OFFERED DEMO_INTERESTED DEMO_SENT WEBSITE_INTERESTED QUALIFYING PRICE_READY SILVIJN_APPROVAL PRICE_PRESENTED PRICE_ACCEPTED PAYMENT_PENDING DEPOSIT_PAID PAID IN_PROGRESS READY_FOR_SILVIJN FINAL_PAYMENT_PENDING PAID_IN_FULL APPROVED DELIVERED NOT_INTERESTED OPTED_OUT LOST".toLowerCase().split(" ");
 for(const s of [...canonical,"qualified","contacted","interested","won"])assert.ok(s in leadLifecycleMeta,s);
 assert.equal(leadLifecycleStates.length,27);
});
test("all 729 state pairs agree with allowed edges, invalid jumps are denied",()=>{
 let count=0;
 for(const from of leadLifecycleStates)for(const to of leadLifecycleStates){assert.equal(isLeadTransitionAllowed(from,to),from===to||(graph[from] as string[]).includes(to));count++;}
 assert.equal(count,729);assert.equal(isLeadTransitionAllowed("new","paid"),false);assert.equal(isLeadTransitionAllowed("payment_pending","deposit_paid"),true);
});
test("legacy won is not treated as accepted or delivered; opt-out is terminal",()=>{
 assert.deepEqual(nextLeadStates("won"),["opted_out"]);
 assert.deepEqual(nextLeadStates("opted_out"),[]);
 assert.equal(isLeadTransitionAllowed("won","delivered"),false);
});
test("application and SQL use exactly the same transition graph",()=>{
 const literal=migration.match(/\(\('(.+)'::jsonb\)->p_from\)/);
 assert.ok(literal); assert.deepEqual(JSON.parse(literal[1]),graph);
});
test("manual reply registration requires explicit attestation, actual timestamp and valid sender",()=>{
 const good={leadId:id,sender:"contact@example.invalid",subject:"Reply",body:"Actual prospect message",receivedAt:"2026-09-17T12:00:00.000Z",requestId:id,confirmedReply:true};
 assert.ok(confirmedReplyInput.safeParse(good).success);
 for(const patch of [{confirmedReply:false},{confirmedReply:undefined},{receivedAt:""},{sender:"Unknown TESTDATA"},{body:" "},{requestId:"not-an-id"}]) assert.equal(confirmedReplyInput.safeParse({...good,...patch}).success,false);
});
test("transition action input validates IDs, canonical values and a reason",()=>{
 const good={leadId:id,expected:"new",next:"analyzing",reason:"Start analysis"};assert.ok(transitionInput.safeParse(good).success);
 for(const patch of [{leadId:"wrong"},{next:"approved_by_ai"},{reason:""},{messageId:"wrong"},{projectId:"wrong"}])assert.equal(transitionInput.safeParse({...good,...patch}).success,false);
});
test("conversation page uses persisted records rather than the old fake transcript",()=>{
 const s=readFileSync("app/(dashboard)/conversations/page.tsx","utf8");assert.match(s,/getConversationPage/);assert.doesNotMatch(s,/mock-data|conversationMessages|AI voert gesprek|750-1500/);
 assert.match(migration,/create view public.conversation_messages with\(security_invoker=true\)/);
 assert.match(migration,/where status='sent' and conversation_id is not null/);
});
test("production start uses server financial gate, not human approval RPC",()=>{
 const s=readFileSync("lib/projects/service.ts","utf8");assert.match(s,/if \(status === "in_progress"\) await startProjectProduction\(id\)/);
 assert.match(migration,/grant execute on function public.start_project_production\(uuid\) to authenticated,service_role/);
});

test("canonical qualification remains usable by existing project and outreach services",()=>{
 assert.equal(canCreateProjectForLead("qualifying"),true); assert.equal(canCreateProjectForLead("website_interested"),true); assert.equal(canCreateProjectForLead("qualified"),true);
 for(const state of ["won","opted_out","not_interested","lost"]) assert.equal(canCreateProjectForLead(state),false);
 for(const state of ["opted_out","not_interested","lost"]) assert.equal(isOutreachSuppressed(state,"not_contacted"),true);
 assert.equal(isOutreachSuppressed("new","opted_out"),true); assert.equal(isOutreachSuppressed("new","not_contacted"),false);
});
