import { getAutomationEventRepository } from "./repositories";
import type { AutomationEvent, AutomationEventType } from "./types";

/**
 * Typed intern event-systeem (Fase 11, spec §5).
 * Alle events komen uit de AutomationEventType-enum — er bestaat geen
 * emit-call met een vrije string (TypeScript dwingt dit af).
 */

export interface EmitEventInput {
  type: AutomationEventType;
  entityType: AutomationEvent["entityType"];
  entityId: string | null;
  payload?: Record<string, unknown>;
  source: string;
}

export async function emitEvent(input: EmitEventInput): Promise<AutomationEvent> {
  return getAutomationEventRepository().record({
    type: input.type,
    entityType: input.entityType,
    entityId: input.entityId,
    payload: input.payload ?? {},
    source: input.source,
  });
}

export async function listRecentEvents(limit = 50): Promise<AutomationEvent[]> {
  return getAutomationEventRepository().list(limit);
}

export async function listEventsForEntity(
  entityType: AutomationEvent["entityType"],
  entityId: string,
  limit = 50
): Promise<AutomationEvent[]> {
  return getAutomationEventRepository().listByEntity(entityType, entityId, limit);
}

/** Menselijk leesbare labels (UI). */
export const EVENT_LABELS: Record<AutomationEventType, string> = {
  lead_created: "Lead aangemaakt",
  lead_analyzed: "Lead geanalyseerd",
  lead_scored: "Lead gescoord",
  lead_qualified: "Lead gekwalificeerd",
  demo_ready: "Demo klaar",
  outreach_draft_ready: "Outreach-concept klaar",
  inbound_message_received: "Inkomend bericht ontvangen",
  reply_processed: "Reactie verwerkt",
  project_created: "Project aangemaakt",
  price_ready: "Prijsindicatie klaar",
  website_ready_for_qc: "Website klaar voor QC",
  qc_completed: "Kwaliteitscontrole voltooid",
  website_ready_for_silvijn: "Website klaar voor Silvijn",
  website_approved: "Website goedgekeurd (menselijk)",
  automation_started: "Automation gestart",
  automation_step_started: "Step gestart",
  automation_step_completed: "Step voltooid",
  automation_step_failed: "Step mislukt",
  automation_step_blocked: "Step geblokkeerd",
  automation_waiting_for_human: "Automation wacht op mens",
  automation_completed: "Automation voltooid",
  automation_failed: "Automation mislukt",
  automation_cancelled: "Automation geannuleerd",
};
