import "server-only";
import { isOutreachSuppressed } from "@/lib/leads/lifecycle";
import { automatedLeadTransition } from "@/lib/leads/automated";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { OutreachService } from "./service";
import { approveAndSendDraft } from "./send";
import { getOutreachRepository } from "./repository";
import { getOutreachCommandRepository } from "./command-repository";
import type {
  OutreachCommandLeadSummary,
  OutreachCommandMode,
  OutreachCommandPatch,
  OutreachCommandRecord,
  OutreachCommandSummary,
} from "./command-types";

/**
 * OutreachOrchestrator (Fase E) — de expliciete owner-opdracht als ENIGE
 * entree voor outreach.
 *
 *   owner-opdracht (mode review|auto, limiet)
 *     → geschikte leads selecteren (deterministisch)
 *     → draft genereren via de bestaande OutreachService (AI + quality check)
 *     → review-modus: draft klaar voor menselijke review (bestaande flow)
 *       auto-modus:  approve + verzenden via de goedgekeurde provider,
 *                   lead-transitie naar contacted via de AI-whitelist (0018)
 *
 * Grenzen: max 25 leads per opdracht; per opdracht precies één
 * command-record + audit; een lead met openstaand/verzonden initiële
 * outreach wordt overgeslagen; opt-out/not_interested/lost wordt nooit
 * geselecteerd. Discovery kan deze orchestrator nooit aanroepen — de enige
 * caller is de owner-server-action.
 */

const MAX_COMMAND_LIMIT = 25;

export class OutreachCommandValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutreachCommandValidationError";
  }
}

/** Statussen waaruit initiële outreach mag starten. */
const OUTREACH_SOURCE_STATUSES = ["new", "analyzing", "qualified"] as const;

export function isEligibleForInitialOutreach(
  lead: {
    leadStatus: string;
    outreachStatus: string;
    email: string | null;
  },
  hasOpenInitialDraft: boolean,
  hasSentInitialDraft: boolean
): boolean {
  if (isOutreachSuppressed(lead.leadStatus, lead.outreachStatus)) return false;
  if (!(OUTREACH_SOURCE_STATUSES as readonly string[]).includes(lead.leadStatus)) return false;
  if (!lead.email || !lead.email.trim()) return false;
  if (hasSentInitialDraft) return false;
  if (hasOpenInitialDraft) return false;
  return true;
}

async function writeAuditEvent(
  ownerUserId: string,
  commandId: string,
  action: "outreach_command_completed" | "outreach_command_failed",
  details: Record<string, unknown>
): Promise<void> {
  if (!isSupabaseConfigured()) return; // development/mock: geen audit-opslag
  try {
    const client = getSupabaseServerClient();
    const { error } = await client.from("audit_events").insert({
      actor_id: ownerUserId,
      action,
      entity_type: "outreach_command",
      entity_id: commandId,
      details,
    });
    if (error) throw error;
  } catch {
    console.warn("[Outreach] AUDIT_WRITE_FAILED", { commandId, action });
  }
}

export interface RunOutreachCommandInput {
  ownerUserId: string;
  mode: OutreachCommandMode;
  limit: number;
}

export interface RunOutreachCommandResult {
  command: OutreachCommandRecord;
  summary: OutreachCommandSummary;
}

export class OutreachOrchestrator {
  constructor(private readonly commandRepository = getOutreachCommandRepository()) {}

  async runCommand(input: RunOutreachCommandInput): Promise<RunOutreachCommandResult> {
    const mode = input.mode === "auto" ? "auto" : input.mode === "review" ? "review" : undefined;
    if (!mode) throw new OutreachCommandValidationError("Ongeldige modus: alleen 'review' of 'auto'");
    if (!input.ownerUserId) throw new OutreachCommandValidationError("Owner-identificatie vereist");

    const requestedLimit = Math.floor(input.limit);
    if (!Number.isFinite(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_COMMAND_LIMIT) {
      throw new OutreachCommandValidationError(`Limiet moet tussen 1 en ${MAX_COMMAND_LIMIT} liggen`);
    }
    const effectiveLimit = Math.min(requestedLimit, MAX_COMMAND_LIMIT);

    // Generatielimiet = commandolimiet (expliciete opdracht, begrensd op 25);
    // de menselijke dashboard-flow behoudt de default-limiet.
    const outreachService = new OutreachService({ maxGenerationsPerRun: effectiveLimit });

    const command = await this.commandRepository.create({
      ownerUserId: input.ownerUserId,
      mode,
      requestedLimit,
      effectiveLimit,
      command: `Outreach-opdracht (${mode}) — limiet ${effectiveLimit} leads`,
    });

    const startedAt = Date.now();
    const leadSummaries: OutreachCommandLeadSummary[] = [];
    const errors: string[] = [];

    try {
      const [leads, drafts] = await Promise.all([
        getLeadRepository().list(),
        getOutreachRepository().list(),
      ]);

      // Selectie: één initiële outreach per lead, alleen verse leads.
      const selected = leads
        .filter((lead) =>
          isEligibleForInitialOutreach(
            lead,
            drafts.some(
              (d) => d.leadId === lead.id && d.purpose === "initial" && ["draft", "ready_for_review", "approved"].includes(d.status)
            ),
            drafts.some((d) => d.leadId === lead.id && d.purpose === "initial" && d.status === "sent")
          )
        )
        .sort((a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0))
        .slice(0, effectiveLimit);

      for (const lead of selected) {
        try {
          const generation = await outreachService.generateDraftForLead(lead.id, { purpose: "initial" });
          if (!generation.qualityPassed) {
            leadSummaries.push({
              leadId: lead.id,
              businessName: lead.businessName,
              leadStatus: lead.leadStatus,
              outcome: "quality_failed",
              detail: `Quality check niet geslaagd: ${generation.draft.qualityIssues.join("; ")}`,
              draftId: generation.draft.id,
            });
            continue;
          }

          if (mode === "review") {
            leadSummaries.push({
              leadId: lead.id,
              businessName: lead.businessName,
              leadStatus: lead.leadStatus,
              outcome: "draft_created",
              detail: "Concept klaar voor menselijke review",
              draftId: generation.draft.id,
            });
            continue;
          }

          // Auto-modus: expliciete opdracht machtigt verzending binnen de limiet.
          const sent = await approveAndSendDraft(generation.draft.id);
          await automatedLeadTransition({
            leadId: lead.id,
            expected: lead.leadStatus,
            next: "contacted",
            reason: `Outreach-commando ${command.id} (${mode}): initiële e-mail verzonden (message ${sent.messageId})`,
          });
          leadSummaries.push({
            leadId: lead.id,
            businessName: lead.businessName,
            leadStatus: "contacted",
            outcome: "sent",
            detail: `Verzonden via ${sent.accountKey}`,
            draftId: generation.draft.id,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          leadSummaries.push({
            leadId: lead.id,
            businessName: lead.businessName,
            leadStatus: lead.leadStatus,
            outcome: "error",
            detail: message,
          });
          errors.push(`${lead.businessName}: ${message}`);
        }
      }

      const counts = {
        selectedLeads: selected.length,
        draftsCreated: leadSummaries.filter((l) => l.outcome === "draft_created").length,
        qualityFailed: leadSummaries.filter((l) => l.outcome === "quality_failed").length,
        sent: leadSummaries.filter((l) => l.outcome === "sent").length,
        skipped: leadSummaries.filter((l) => l.outcome === "skipped").length,
      };
      const patch: OutreachCommandPatch = {
        status: "completed",
        ...counts,
        durationMs: Date.now() - startedAt,
        selectedLeadIds: selected.map((l) => l.id),
        summary: { leads: leadSummaries },
        errors,
        completedAt: new Date().toISOString(),
      };
      const completed = await this.commandRepository.complete(command.id, patch);
      await writeAuditEvent(input.ownerUserId, command.id, "outreach_command_completed", {
        mode,
        ...counts,
        errors: errors.length,
      });
      return { command: completed ?? { ...command, ...patch }, summary: patch.summary };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const patch: OutreachCommandPatch = {
        status: "failed",
        selectedLeads: 0,
        draftsCreated: 0,
        qualityFailed: 0,
        sent: 0,
        skipped: 0,
        durationMs: Date.now() - startedAt,
        selectedLeadIds: [],
        summary: { leads: leadSummaries },
        errors: [message, ...errors],
        completedAt: new Date().toISOString(),
      };
      await this.commandRepository.complete(command.id, patch);
      await writeAuditEvent(input.ownerUserId, command.id, "outreach_command_failed", { message });
      throw error;
    }
  }
}
