import type { AutomationAction, AutomationStepType, StepOutcome } from "./types";

/**
 * Capability matrix (Fase 11, spec §12-14) — DETERMINISTISCH.
 *
 * Elke step-type heeft vaste acties en een vaste policy. AI-output kan
 * deze matrix NOOIT wijzigen; er bestaat geen enkele code die de matrix
 * runtime muteert. Geblokkeerde steps eindigen altijd BLOCKED /
 * WAITING_FOR_HUMAN — nooit stilzwijgend uitgevoerd.
 */

export interface StepCapability {
  /** Acties die dit step-type Fundamenteel nodig heeft. */
  actions: AutomationAction[];
  /** Harde policy van dit step-type in de huidige fase. */
  policy: "allowed" | "human_required" | "blocked";
}

export const STEP_CAPABILITY_MATRIX: Record<AutomationStepType, StepCapability> = {
  discover_leads: { actions: ["read"], policy: "allowed" },
  analyze_lead: { actions: ["read", "analyze"], policy: "allowed" },
  score_lead: { actions: ["read", "analyze"], policy: "allowed" },
  generate_demo: { actions: ["read", "generate"], policy: "allowed" },
  generate_outreach: { actions: ["read", "generate", "prepare"], policy: "allowed" },
  process_reply: { actions: ["read", "analyze"], policy: "allowed" },
  qualify_lead: { actions: ["read", "analyze"], policy: "allowed" },
  create_project: { actions: ["read", "generate"], policy: "allowed" },
  check_requirements: { actions: ["read"], policy: "allowed" },
  create_price_indication: { actions: ["read", "generate"], policy: "allowed" },
  check_price: { actions: ["read"], policy: "allowed" },
  generate_website: { actions: ["read", "generate"], policy: "allowed" },
  run_qc: { actions: ["read", "analyze"], policy: "allowed" },
  wait_for_human: { actions: [], policy: "human_required" },
  // HARDE GRENNEN van deze fase (spec §13/14/17):
  send_outreach: { actions: ["send"], policy: "human_required" },
  approve_website: { actions: ["approve"], policy: "human_required" },
  deliver_website: { actions: ["deliver", "publish"], policy: "blocked" },
};

/** Acties die automation in deze fase NOOIT automatisch mag uitvoeren. */
export const FORBIDDEN_AUTOMATION_ACTIONS: AutomationAction[] = ["send", "publish", "approve", "deliver", "charge"];

export function stepPolicy(stepType: AutomationStepType): StepCapability["policy"] {
  return STEP_CAPABILITY_MATRIX[stepType].policy;
}

/**
 * Bepaalt of een step op het gegeven autonomieniveau mag draaien.
 * Geblokkeerde/human-required steps → WAITING_FOR_HUMAN (nooit exec).
 */
export function evaluateStepPermission(
  stepType: AutomationStepType,
  autonomy: AutonomyLevelCompat
): { allowed: boolean; outcome: StepOutcome; reason: string } {
  const capability = STEP_CAPABILITY_MATRIX[stepType];

  if (capability.policy === "blocked") {
    return {
      allowed: false,
      outcome: "blocked",
      reason: `Step "${stepType}" is in deze fase hard geblokkeerd (acties: ${capability.actions.join(", ")}) — geen automatische delivery/publicatie.`,
    };
  }

  if (capability.policy === "human_required") {
    return {
      allowed: false,
      outcome: "waiting_for_human",
      reason: `Step "${stepType}" vereist een menselijke actie — automation wacht en voert deze NOOIT zelf uit.`,
    };
  }

  if (capability.actions.some((action) => FORBIDDEN_AUTOMATION_ACTIONS.includes(action))) {
    return {
      allowed: false,
      outcome: "blocked",
      reason: `Step "${stepType}" vereist verboden acties (${capability.actions.join(", ")}) — buiten de automation- permissies.`,
    };
  }

  if (autonomy <= 0) {
    return {
      allowed: false,
      outcome: "blocked",
      reason: "Autonomieniveau 0 (manual): er worden geen steps automatisch uitgevoerd — start handmatig.",
    };
  }

  return { allowed: true, outcome: "success", reason: "" };
}

type AutonomyLevelCompat = 0 | 1 | 2 | 3;
