import type { DesignPlan } from "../design-plan";
import { D3_COMPOSITIONS, getD3Composition, type D3CompositionDefinition } from "./composition-registry";

export interface D3PlanningContext {
  industry: string;
  /** Only actual supplied assets count. Planned blueprint slots do not. */
  hasAvailableMedia?: boolean;
  /** Explicit opt-in ONLY at new plan generation; never during legacy reads/builds. */
  newGeneration?: boolean;
}

/** Pure, deterministic planning pass. Preserves pages, section order, blocks,
 * media slots, CTA targets, content hints and all factual content verbatim.
 * Records every override. A legacy read returns exactly the original object.
 */
export function selectD3Compositions(input: DesignPlan, context: D3PlanningContext): { plan: DesignPlan; adjustments: string[] } {
  if (!input.blueprint || (!context.newGeneration && !input.blueprint.pages.some(p=>p.sectionInstances.some(s=>s.composition)))) return {plan:input,adjustments:[]};
  const plan=structuredClone(input);
  const adjustments:string[]=[];
  const used=new Map<string,number>();
  const art=plan.artDirection;
  for(const page of plan.blueprint!.pages) {
    let previousFamily="";
    let cardCount=0;
    for(const section of page.sectionInstances) {
      const definitions=D3_COMPOSITIONS[section.type];
      if(!definitions) {previousFamily="";continue;}
      if(!section.composition && !context.newGeneration) continue;
      const functional=["cta","contact"].includes(section.type);
      const count=section.blocks.length;
      const requested=section.composition;
      // Allow media-catalogue sections to retain honest editable slots, but
      // avoid media-dependent choices when text-only alternatives exist.
      const suitable=definitions.filter(d=>d.minItems<=count && (!d.requiresMedia || context.hasAvailableMedia));
      const alternatives=suitable.length?suitable:definitions.filter(d=>!d.requiresMedia);
      const candidates=alternatives.length?alternatives:definitions;
      function score(d: D3CompositionDefinition): number {
        let value=requested?.variant===d.key?12:0;
        if(!functional) {
          value-=(used.get(`${section.type}/${d.key}`)??0)*30;
          if(d.family===previousFamily)value-=18;
          if(/grid|card|bento/.test(d.family)&&cardCount>=2)value-=30;
        }
        if(count>=4&&d.family==="featured")value+=8;
        if(requested?.importance==="primary"&&d.family==="featured")value+=2;
        if(functional && /contact|aanvraag|offerte|afspraak/i.test(plan.goals.conversionGoal??"") && ["form","split"].includes(d.family))value+=3;
        if(count<3&&["list","editorial","statement"].includes(d.family))value+=6;
        if(art?.composition==="asymmetric"&&/asymmetric|featured/.test(d.key))value+=5;
        if(art?.composition==="editorial"&&d.family==="editorial")value+=5;
        if(art?.imageryBalance==="text_forward"&&d.requiresMedia)value-=12;
        if(art?.brandPersonality==="premium_refined"&&d.family==="statement")value+=4;
        if(/praktijk|zorg|consult|jurid|account/i.test(context.industry)&&["editorial","list"].includes(d.family))value+=3;
        if(/contact|aanvraag|afspraak/i.test(page.purpose??"")&&d.family==="form")value+=4;
        if(/proces|werkwijze/i.test(page.purpose??"")&&d.family==="timeline")value+=4;
        return value;
      }
      const selected=[...candidates].sort((a,b)=>score(b)-score(a)||definitions.indexOf(a)-definitions.indexOf(b))[0];
      const density=count>5?"compact":requested?.density==="airy"&&count>0&&count<3?"compact":requested?.density??(count<3?"compact":"balanced");
      const changed=!requested||requested.variant!==selected.key||requested.density!==density;
      const reason=changed?`${count} geplande items; ${context.hasAvailableMedia?"aangeleverde media":"geen bevestigde media"}; familie ${selected.family}; rekening gehouden met paginadoel, art direction en herhaling.`:requested.rationale;
      section.composition={variant:selected.key,density,importance:requested?.importance??(section.type==="services"||functional?"primary":"supporting"),rationale:reason.slice(0,400)};
      if(changed)adjustments.push(`${page.key}/${section.type}: ${requested?.variant??"geen keuze"} → ${selected.key} (${density}). ${reason}`);
      if(!functional) {
        const signature=`${section.type}/${selected.key}`;
        used.set(signature,(used.get(signature)??0)+1);
        previousFamily=selected.family;
        if(/grid|card|bento/.test(selected.family))cardCount++;
      } else previousFamily="";
      if(!getD3Composition(section.type,section.composition.variant))throw new Error("D3 enum invariant failed");
    }
  }
  return {plan,adjustments};
}
