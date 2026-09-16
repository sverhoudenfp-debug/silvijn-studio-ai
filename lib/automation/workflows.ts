import type { AutomationStepDefinition, AutomationStepType } from "./types";

/**
 * Workflow-definities (Fase 11, spec §18-19) — typed, gecontroleerde
 * step-opsommingen. Nieuwe workflows = nieuw definie-object, geen vrije
 * runtime-steps. De AI kan géén nieuwe steps creëren of uitvoeren.
 */

const DEFAULT_STEP = {
  requiredAutonomy: 1,
  timeoutMs: 60_000,
  maxRetries: 2,
} as const;

function step(
  id: string,
  type: AutomationStepType,
  name: string,
  description: string,
  overrides: Partial<AutomationStepDefinition> = {}
): AutomationStepDefinition {
  return { id, type, name, description, ...DEFAULT_STEP, ...overrides };
}

/** Workflow 1: Qualified Lead → Website Ready (eindigt bij WAIT FOR HUMAN). */
export const QUALIFIED_LEAD_TO_WEBSITE_STEPS: AutomationStepDefinition[] = [
  step("create-project", "create_project", "Project aanmaken", "Bestaande ProjectService; 1 project per qualified lead (idempotent)."),
  step("check-requirements", "check_requirements", "Requirements controleren", "Deterministische check; onbekende kern-vereisten → wachten op mens (AI verzint niets)."),
  step("create-price", "create_price_indication", "Prijsindicatie berekenen", "Bestaande PricingEngine; CONFIGURATION_MISSING → BLOCKED, geen fallback-prijs."),
  step("check-price", "check_price", "Prijs controleren", "Deterministische check; geen websitegeneratie zonder geldige prijsindicatie."),
  step("generate-website", "generate_website", "Website genereren", "Bestaande WebsiteGenerationService (guards, limieten, versie-beheer onverkort)."),
  step("run-qc", "run_qc", "Kwaliteitscontrole draaien", "Bestaande QualityControlService; QC PASS ≠ APPROVED."),
  step("wait-for-human", "wait_for_human", "Wachten op goedkeuring Silvijn", "HARDE GATE: goedkeuren kan alléén via de menselijke server action (approveWebsiteAction); automation voert dit NOOIT uit.", {
    waitForHuman: true,
    gate: "website_approval" as const,
  }),
];

/** Workflow 2: Lead Discovery (discovery-draai; verstuur nooit automatisch outreach). */
export const LEAD_DISCOVERY_STEPS: AutomationStepDefinition[] = [
  step("discover", "discover_leads", "Leads ontdekken", "Bestaande LeadDiscoveryService: zoeken + dedupliceren + verrijken + opslaan in één gecontroleerde run."),
  step("analyze", "analyze_lead", "Leads analyseren", "Deterministische analyse van de gevonden leads (geen AI-call)."),
  step("score", "score_lead", "Leads scoren", "Deterministische rule-based scoring per lead (geen AI-call)."),
];
