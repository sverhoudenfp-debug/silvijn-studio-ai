import "server-only";
import { isOutreachSuppressed } from "@/lib/leads/lifecycle";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getInboundMessageRepository } from "@/lib/sales/repository";
import { OutreachService } from "./service";
import { approveAndSendDraft } from "./send";
import { getOutreachRepository } from "./repository";
import type { OutreachCommandLeadSummary } from "./command-types";

/**
 * Follow-up-engine (Fase E) — natuurlijke follow-ups, MAXIMAAL 2 per lead
 * wanneer er geen reactie komt.
 *
 * Een follow-up is alléén aan de orde wanneer:
 *  - initiële outreach is VERZONDEN (sent + verzendbewijs);
 *  - de lead nog in status 'contacted' staat (geen reactie ontvangen);
 *  - er géén inbound berichten bestaan (geen enkele reactie);
 *  - de lead niet is onderdrukt (opted_out/not_interested/lost);
 *  - er minder dan MAX_FOLLOWUPS_PER_LEAD (2) follow-ups zijn verstuurd;
 *  - de laatste verzending FOLLOWUP_AFTER_DAYS (default 4) oud is.
 *
 * De eigenaar activeert een follow-upronde expliciet vanaf het dashboard
 * (binnen een commando: mode review = concept, mode auto = verzenden).
 * Bij opt-out stopt alles direct: isOutreachSuppressed blokkeert selectie
 * en de SQL-guard (0012) weigert verzending naar onderdrukte leads.
 */

export const MAX_FOLLOWUPS_PER_LEAD = 2;

export function getFollowupAfterDays(): number {
  const parsed = Number.parseInt(process.env.FOLLOWUP_AFTER_DAYS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 4;
}

export interface DueFollowup {
  leadId: string;
  businessName: string;
  sentInitialAt: string;
  sentFollowups: number;
}

export interface FollowupRunResult {
  processed: OutreachCommandLeadSummary[];
  dueCount: number;
  sentFollowups: number;
  errors: string[];
}

export async function findDueFollowups(now: Date = new Date()): Promise<DueFollowup[]> {
  const afterMs = getFollowupAfterDays() * 24 * 60 * 60 * 1000;
  const [leads, drafts, inbounds] = await Promise.all([
    getLeadRepository().list(),
    getOutreachRepository().list(),
    getInboundMessageRepository().list(),
  ]);

  const due: DueFollowup[] = [];
  for (const lead of leads) {
    if (isOutreachSuppressed(lead.leadStatus, lead.outreachStatus)) continue;
    if (lead.leadStatus !== "contacted") continue; // reactie/verdere flow = geen follow-up
    if (inbounds.some((m) => m.leadId === lead.id)) continue; // er is gereageerd

    const initial = drafts
      .filter((d) => d.leadId === lead.id && d.purpose === "initial" && d.status === "sent" && d.sentAt)
      .sort((a, b) => (a.sentAt! < b.sentAt! ? 1 : -1))[0];
    if (!initial) continue;

    const sentFollowups = drafts.filter(
      (d) => d.leadId === lead.id && d.purpose === "followup" && d.status === "sent" && d.sentAt
    ).length;
    if (sentFollowups >= MAX_FOLLOWUPS_PER_LEAD) continue;

    const lastSent = drafts
      .filter((d) => d.leadId === lead.id && d.status === "sent" && d.sentAt)
      .sort((a, b) => (a.sentAt! < b.sentAt! ? 1 : -1))[0]?.sentAt ?? initial.sentAt!;
    if (now.getTime() - new Date(lastSent).getTime() < afterMs) continue;

    due.push({
      leadId: lead.id,
      businessName: lead.businessName,
      sentInitialAt: initial.sentAt!,
      sentFollowups,
    });
  }
  return due;
}

/**
 * Verwerkt alle vervolgfollow-ups binnen één expliciete eigenaarsronde.
 * mode review = concepten; mode auto = concept + verzending (begrensd).
 */
export async function processDueFollowups(input: {
  mode: "review" | "auto";
  limit?: number;
}): Promise<FollowupRunResult> {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 10), 1), 25);
  const due = (await findDueFollowups()).slice(0, limit);
  const outreachService = new OutreachService();
  const processed: OutreachCommandLeadSummary[] = [];
  const errors: string[] = [];
  let sentFollowups = 0;

  for (const item of due) {
    try {
      const generation = await outreachService.generateDraftForLead(item.leadId, { purpose: "followup" });
      if (!generation.qualityPassed) {
        processed.push({
          leadId: item.leadId,
          businessName: item.businessName,
          leadStatus: "contacted",
          outcome: "quality_failed",
          detail: `Quality check niet geslaagd: ${generation.draft.qualityIssues.join("; ")}`,
          draftId: generation.draft.id,
        });
        continue;
      }

      if (input.mode === "review") {
        processed.push({
          leadId: item.leadId,
          businessName: item.businessName,
          leadStatus: "contacted",
          outcome: "draft_created",
          detail: `Follow-up ${item.sentFollowups + 1}/${MAX_FOLLOWUPS_PER_LEAD} klaar voor review`,
          draftId: generation.draft.id,
        });
        continue;
      }

      const sent = await approveAndSendDraft(generation.draft.id);
      sentFollowups += 1;
      processed.push({
        leadId: item.leadId,
        businessName: item.businessName,
        leadStatus: "contacted",
        outcome: "sent",
        detail: `Follow-up ${item.sentFollowups + 1}/${MAX_FOLLOWUPS_PER_LEAD} verzonden via ${sent.accountKey}`,
        draftId: generation.draft.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      processed.push({
        leadId: item.leadId,
        businessName: item.businessName,
        leadStatus: "contacted",
        outcome: "error",
        detail: message,
      });
      errors.push(`${item.businessName}: ${message}`);
    }
  }

  return { processed, dueCount: due.length, sentFollowups, errors };
}
