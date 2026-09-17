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
    description: "AI-ondersteuning bovenop de Lead Discovery Engine (Fase 5); basis werkt zonder AI.",
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
    description: "Genereert gepersonaliseerde outreach-concepten (draft) per lead; nooit automatisch verzonden (Fase 6).",
    status: "implemented",
    defaultTier: "balanced",
    defaultTask: "outreach_generation",
  },
  sales: {
    id: "sales",
    name: "Sales Agent",
    description: "Analyseert inkomende reacties, kwalificeert leads en draft een antwoord; nooit automatisch verzonden (Fase 7).",
    status: "implemented",
    defaultTier: "balanced",
    defaultTask: "sales_analysis",
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
    description:
      "Plant de website als gestructureerde, Zod-gevalideerde WebsiteSpecification op basis van échte lead-/projectinformatie; de deterministische generator bouwt daarna de site met gecontroleerde componenten — de AI schrijft nooit productiecode.",
    status: "implemented",
    defaultTier: "balanced",
    defaultTask: "website_planning",
  },
  website_quality_control: {
    id: "website_quality_control",
    name: "Website Quality Control Agent",
    description:
      "Hybride QC: voert deterministische checks uit en beoordeelt daarnaast content, UX, design, conversion en business-consistentie. Alléén adviserend — de menselijke approval (READY_FOR_SILVIJN → APPROVED) is een harde gate die de AI nooit overrult.",
    status: "implemented",
    defaultTier: "balanced",
    defaultTask: "website_quality_analysis",
  },
  quality_control: {
    id: "quality_control",
    name: "Quality Control Agent",
    description: "Generieke output-kwaliteitscontrole voor overige content (toekomstig).",
    status: "planned",
    defaultTier: "balanced",
    defaultTask: "generate_structured",
  },
  questionnaire: {
    id: "questionnaire",
    name: "Questionnaire Agent",
    description: "Genereert klantvragenlijsten uit bekende lead-/projectcontext en beoordeelt de volledigheid van antwoorden.",
    status: "implemented",
    defaultTier: "balanced",
    defaultTask: "questionnaire_generation",
  },
};
