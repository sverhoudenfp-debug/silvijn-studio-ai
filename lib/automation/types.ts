/**
 * Automation Engine — types (Fase 11).
 *
 * De automation engine is een ORCHESTRATOR: hij bestuurt de bestaande
 * engines (discovery, scoring, outreach, sales, projects, pricing,
 * websitegeneratie, QC) en vervangt ze niet. Safety gates zijn
 * DETERMINISTISCH: AI-output kan permissions, gates, limieten,
 * approval- en deliverystatussen nooit bepalen.
 */

export type AutomationStatus = "draft" | "active" | "paused" | "completed" | "failed" | "disabled";

export type AutomationType = "lead_pipeline" | "discovery" | "custom";

/** Step-definities (gecontroleerde opsomming — geen vrije strings). */
export type AutomationStepType =
  | "discover_leads"
  | "analyze_lead"
  | "score_lead"
  | "generate_demo"
  | "generate_outreach"
  | "process_reply"
  | "qualify_lead"
  | "create_project"
  | "check_requirements"
  | "create_price_indication"
  | "check_price"
  | "generate_website"
  | "run_qc"
  | "wait_for_human"
  | "send_outreach" // capability: geblokkeerd in deze fase
  | "approve_website" // capability: geblokkeerd in deze fase
  | "deliver_website"; // capability: geblokkeerd in deze fase

export type AutomationStepStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "blocked";

export type AutomationRunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled" | "blocked";

/** Eindresultaat van één step-executie. */
export type StepOutcome = "success" | "failed" | "blocked" | "waiting_for_human";

/** Typed events — alle events komen uit deze opsomming (geen vrije strings). */
export type AutomationEventType =
  | "lead_created"
  | "lead_analyzed"
  | "lead_scored"
  | "lead_qualified"
  | "demo_ready"
  | "outreach_draft_ready"
  | "inbound_message_received"
  | "reply_processed"
  | "project_created"
  | "price_ready"
  | "website_ready_for_qc"
  | "qc_completed"
  | "website_ready_for_silvijn"
  | "website_approved"
  | "automation_started"
  | "automation_step_started"
  | "automation_step_completed"
  | "automation_step_failed"
  | "automation_step_blocked"
  | "automation_waiting_for_human"
  | "automation_completed"
  | "automation_failed"
  | "automation_cancelled";

/** Autonomieniveaus — deterministisch, alléén menselijk te wijzigen. */
export type AutonomyLevel = 0 | 1 | 2 | 3;
// 0 = manual, 1 = suggested (alleen voorbereiden/aanbevelen),
// 2 = semi-automatic (genereren + interne stappen, menselijke gates blijven),
// 3 = controlled autonomous (latere fase; NIET automatisch activeren).

/** Actie-permissies — expliciete checks, nooit AI-bepaald. */
export type AutomationAction = "read" | "analyze" | "generate" | "prepare" | "send" | "publish" | "approve" | "deliver" | "charge";

export interface AutomationStepDefinition {
  id: string;
  type: AutomationStepType;
  name: string;
  description: string;
  /** Bepaalt of een step automatisch mag draaien op het huidige autonomieniveau. */
  requiredAutonomy: AutonomyLevel;
  /** Timeout in ms per step-executie (nooit onbeperkt wachten). */
  timeoutMs: number;
  /** Maximale retries per step alléén voor tijdelijke fouten. */
  maxRetries: number;
  /** Optimistisch na deze step stoppen (human gate). */
  waitForHuman?: boolean;
  /** Verifieerbare wacht-voorwaarde voor de human gate (resume-check). */
  gate?: "website_approval" | "manual";
}

export interface Automation {
  id: string;
  name: string;
  description: string;
  type: AutomationType;
  status: AutomationStatus;
  enabled: boolean;
  /** Event-type dat deze automation start (typed). */
  trigger: AutomationEventType | "manual";
  steps: AutomationStepDefinition[];
  currentStep: string | null;
  executionCount: number;
  successCount: number;
  failureCount: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationStepExecution {
  stepId: string;
  stepType: AutomationStepType;
  status: AutomationStepStatus;
  startedAt: string | null;
  completedAt: string | null;
  outcome: StepOutcome | null;
  error: string | null;
  retryCount: number;
  /** Menselijk leesbaar resultaat voor de run-detail-pagina. */
  result: string | null;
  aiCalls: number;
  estimatedCostUsd: number;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  entityType: "lead" | "project" | "website" | "discovery" | "none";
  entityId: string | null;
  currentStep: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  retryCount: number;
  /** Waarom wacht/blokkeert de run (human gate, blocker, limiet). */
  waitingReason: string | null;
  steps: AutomationStepExecution[];
  metadata: Record<string, unknown>;
  /** Loop/cost/rate-guard observaties. */
  warnings: string[];
  aiCalls: number;
  estimatedCostUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationEvent {
  id: string;
  type: AutomationEventType;
  entityType: "lead" | "project" | "website" | "discovery" | "none";
  entityId: string | null;
  timestamp: string;
  payload: Record<string, unknown>;
  source: string;
}

export interface AutomationQueueItem {
  id: string;
  automationId: string;
  entityId: string | null;
  entityType: AutomationRun["entityType"];
  triggerEvent: AutomationEventType | "manual";
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  attempts: number;
  enqueuedAt: string;
  processedAt: string | null;
  error: string | null;
}

/** Resultaat van één step-uitvoering, geretourneerd door de executor. */
export interface StepExecutionResult {
  outcome: StepOutcome;
  result: string;
  aiCalls?: number;
  estimatedCostUsd?: number;
  /** Te publiceren events (typed) na succes. */
  events?: { type: AutomationEventType; payload?: Record<string, unknown> }[];
  /** Extra context voor volgende steps. */
  context?: Record<string, unknown>;
}
