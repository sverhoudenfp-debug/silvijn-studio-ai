import test from "node:test";
import assert from "node:assert/strict";
import { DESIGN_PLAN } from "./fixtures/theme";
import { selectD3Compositions } from "../lib/websites/blueprint/composition-engine";
import { websiteBlueprintSchema, blueprintSectionInstanceSchema } from "../lib/websites/blueprint/blueprint";
import { D3_COMPOSITIONS, buildD3CompositionContract, getD3Composition } from "../lib/websites/blueprint/composition-registry";
import type { DesignPlan } from "../lib/websites/design-plan";
function plan(count=4, pages=1, variant="featured_service"):DesignPlan {
 const section={type:"services",layout:"cards",blocks:Array.from({length:count},()=>({kind:"service",hint:null})),media:[],cta:null,background:"default",motion:"none",contentHints:null,composition:{variant,density:"balanced",importance:"primary",rationale:"Het hoofdaanbod krijgt nadruk."}};
 return {...structuredClone(DESIGN_PLAN),blueprint:websiteBlueprintSchema.parse({version:2,pages:Array.from({length:pages},(_,i)=>({key:i===0?"home":"p"+i,title:"Aanbod",purpose:"Diensten en uitleg",seo:null,sectionInstances:[structuredClone(section)]})),trustElements:{usps:[],stats:[],badges:[]},conversionPlan:{primaryGoal:null,leadCapture:null,contactPreference:null},missingInformation:[]})};
}
test("D3 closed contract rejects cross-type variants and arbitrary CSS",()=>{
 const s=plan().blueprint!.pages[0].sectionInstances[0];
 assert(!blueprintSectionInstanceSchema.safeParse({...s,composition:{...s.composition,variant:"split_form"}}).success);
 assert(!blueprintSectionInstanceSchema.safeParse({...s,composition:{...s.composition,variant:"display:grid"}}).success);
 assert(!blueprintSectionInstanceSchema.safeParse({...s,composition:{...s.composition,density:"giant"}}).success);
});
test("D3 catalogue has 46 unique per-type choices and explicit mobile strategies",()=>{
 let count=0;for(const [type,defs] of Object.entries(D3_COMPOSITIONS)){assert.equal(new Set(defs!.map(d=>d.key)).size,defs!.length,type);for(const d of defs!){count++;assert(d.label.length<=50);assert(d.mobileStrategy.length>5);assert(d.minItems>=0);}}
 assert.equal(count,46);
});
test("D3 four services can be primary plus secondary, not automatic equal cards",()=>{
 const input=plan();const selected=selectD3Compositions(input,{industry:"creatieve studio",newGeneration:true});
 assert.equal(selected.plan.blueprint!.pages[0].sectionInstances[0].composition!.variant,"featured_service");
 assert.deepEqual(input,plan());
});
test("D3 insufficient items cannot select a bento grid",()=>{
 const selected=selectD3Compositions(plan(2,1,"bento"),{industry:"advies",newGeneration:true});
 assert.notEqual(selected.plan.blueprint!.pages[0].sectionInstances[0].composition!.variant,"bento");assert(selected.adjustments.length);
});
test("D3 repeated compositions diversify across pages without mutating content/order",()=>{
 const input=plan(4,3);const out=selectD3Compositions(input,{industry:"studio",newGeneration:true});
 const keys=out.plan.blueprint!.pages.map(p=>p.sectionInstances[0].composition!.variant);assert.equal(new Set(keys).size,3);
 const without=(p:DesignPlan)=>p.blueprint!.pages.map(p=>({...p,sectionInstances:p.sectionInstances.map(s=>{const copy={...s};delete copy.composition;return copy;})}));assert.deepEqual(without(input),without(out.plan));
});
test("D3 planned media never counts as supplied media",()=>{
 const input=plan(4,1,"split_media");input.blueprint!.pages[0].sectionInstances[0].media=[{role:"image",ratio:"wide",alt:null}];
 const missing=selectD3Compositions(input,{industry:"studio",newGeneration:true});assert.notEqual(missing.plan.blueprint!.pages[0].sectionInstances[0].composition!.variant,"split_media");
 const present=selectD3Compositions(input,{industry:"studio",newGeneration:true,hasAvailableMedia:true});assert.equal(present.plan.blueprint!.pages[0].sectionInstances[0].composition!.variant,"split_media");
});
test("D3 legacy read returns original object; new generation is explicit",()=>{
 const old=plan();delete old.blueprint!.pages[0].sectionInstances[0].composition;
 assert.equal(selectD3Compositions(old,{industry:"studio"}).plan,old);
 assert(selectD3Compositions(old,{industry:"studio",newGeneration:true}).plan.blueprint!.pages[0].sectionInstances[0].composition);
});
test("D3 low content density reduces airy spacing and logs correction",()=>{
 const input=plan(2);input.blueprint!.pages[0].sectionInstances[0].composition!.density="airy";
 const out=selectD3Compositions(input,{industry:"studio",newGeneration:true});assert.equal(out.plan.blueprint!.pages[0].sectionInstances[0].composition!.density,"compact");assert(out.adjustments.length);
});
test("D3 AI contract includes machine catalogue, media honesty and mobile execution",()=>{
 const contract=buildD3CompositionContract();for(const defs of Object.values(D3_COMPOSITIONS))for(const d of defs!){assert(contract.includes(d.key));assert(contract.includes(d.mobileStrategy));}
 assert(contract.includes("GEEN aanwezige afbeelding"));assert(contract.includes("hero, usp_band"));assert(contract.includes("hint:null"));assert(contract.includes("Geen vrije CSS"));assert.equal(getD3Composition("hero","featured_service"),undefined);
});

test("D3 retry returns exact schema diagnostics to design model, never broadens enums",async()=>{
 const { AIService }=await import("../lib/ai/service");const {z}=await import("zod");
 const service=new AIService();const prompts:string[]=[];
 Object.defineProperty(service,"provider",{get:()=>({generateText:async(request:{prompt:string})=>{prompts.push(request.prompt);return {text:JSON.stringify({layout:prompts.length===1?"statement":"split"}),model:"mock",mode:"mock",usage:{inputTokens:1,outputTokens:1,totalTokens:2}};}})});
 const result=await service.generateStructured({agent:"design_planning",system:"test",prompt:"Original contract"},z.object({layout:z.enum(["split","story"])}));
 assert.equal(result.data.layout,"split");assert.equal(prompts.length,2);assert.equal(prompts[0],"Original contract");assert(prompts[1].includes("VALIDATIEFEEDBACK"));assert(prompts[1].includes("layout:"));assert(prompts[1].includes("composition.variant"));
});
