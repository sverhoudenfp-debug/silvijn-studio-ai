import type { AIModelTier, AgentType } from "./types";

/**
 * Agent-registry — de infrastructuur waarop de toekomstige agents draaien.
 * In Fase 4 is alleen business_analysis echt geïmplementeerd; de rest is
 * geregistreerd als toekomstige capability zonder implementatie.
 *
 * status:
 *   implemented — AI-service draait via de centrale AI-laag
 *   rule_based  — bestaat al als rule-based logica (lead scoring agent)
 *   planned     — toekomstige fase, nog geen implementatie
 */

export type AgentStatus = "implemented" | "rule_based" | "planned";

export interface AgentDefinition {
  id: AgentType;
  name: string;
  description: string;
  status: AgentStatus;
  defaultTier: AIModelTier;
  defaultTask: string;
}

export const AI_AGENTS: Record<AgentType, AgentDefinition> = {
  business_analysis: {
    id: "business_analysis",
    name: "Business Analysis Agent",
    description: "Analyseert een lead-bedrijf: samenvatting, kans, risico's en aanpak.",
    status: "implemented",
    defaultTier: "balanced",
    defaultTask: "business_analysis",
  },
  lead_scoring: {
    id: "lead_scoring",
    name: "Lead Scoring Agent",
    description: "Rule-based scoring (bestaand); AI-assisted scoring komt later op deze agent.",
    status: "rule_based",
    defaultTier: "fast",
    defaultTask: "lead_score",
  },
  lead_research: {
    id: "lead_research",
    name: "Lead Research Agent",
    description: "Verzamelt bedrijfsdata voor nieuwe leads (latere fase).",
    status: "planned",
    defaultTier: "fast",
    defaultTask: "generate_structured",
  },
  demo_generation: {
    id: "demo_generation",
    name: "Demo Generation Agent",
    description: "Genereert demo-website-content voor een lead (latere fase).",
    status: "planned",
    defaultTier: "balanced",
    defaultTask: "generate_structured",
  },
  outreach: {
    id: "outreach",
    name: "Outreach Agent",
    description: "Stelt gepersonaliseerde outreach-berichten op (latere fase).",
    status: "planned",
    defaultTier: "fast",
    defaultTask: "generate_text",
  },
  sales: {
    id: "sales",
    name: "Sales Agent",
    description: "Voert verkoopgesprekken in gespreksthreads (latere fase).",
    status: "planned",
    defaultTier: "balanced",
    defaultTask: "generate_text",
  },
  qualification: {
    id: "qualification",
    name: "Qualification Agent",
    description: "Kwalificeert leads op basis van antwoorden (latere fase).",
    status: "planned",
    defaultTier: "fast",
    defaultTask: "classify_lead",
  },
  pricing: {
    id: "pricing",
    name: "Pricing Agent",
    description: "Berekent prijsindicaties voor projecten (latere fase).",
    status: "planned",
    defaultTier: "fast",
    defaultTask: "generate_structured",
  },
  website_generation: {
    id: "website_generation",
    name: "Website Generation Agent",
    description: "Genereert definitieve klantwebsites (latere fase).",
    status: "planned",
    defaultTier: "powerful",
    defaultTask: "generate_structured",
  },
  quality_control: {
    id: "quality_control",
    name: "Quality Control Agent",
    description: "Controleert gegenereerde output op kwaliteit (latere fase).",
    status: "planned",
    defaultTier: "balanced",
    defaultTask: "generate_structured",
  },
};
