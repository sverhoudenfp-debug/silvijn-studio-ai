/**
 * Fase 12 §P — productie-analytics.
 * ALLE cijfers komen uit de echte repositories (live Supabase indien
 * geconfigureerd, anders de bewuste mock-laag voor development).
 * Geen enkele hard-coded KPI: geen data → 0 / lege state.
 */

import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getAIRunRepository } from "@/lib/repositories/ai-run-repository";
import { getOutreachRepository } from "@/lib/outreach/repository";
import { getInboundMessageRepository, getSalesInteractionRepository } from "@/lib/sales/repository";
import { getProjectRepository } from "@/lib/projects/repository";
import { getGeneratedWebsiteRepository } from "@/lib/websites/repository";
import { getQualityControlRepository } from "@/lib/qc/repository";
import { getAutomationRunRepository } from "@/lib/automation/repositories";
import type { Lead, LeadStatus } from "@/lib/types";
import type { ProjectStatus } from "@/lib/projects/types";
import type { GeneratedWebsite } from "@/lib/websites/types";
import type { OutreachDraftStatus } from "@/lib/outreach/types";
import type { AIRunRecord } from "@/lib/repositories/ai-run-repository";
import type { AutomationRun } from "@/lib/automation/types";

export interface LeadMetrics {
  total: number;
  byStatus: Record<LeadStatus, number>;
  new: number;
  analyzed: number;
  qualified: number;
  contacted: number;
  interested: number;
  won: number;
  lost: number;
}

export interface OutreachMetrics {
  /** Alle niet-geannuleerde concepten (draft + ready_for_review + approved). */
  drafts: number;
  readyForReview: number;
  approved: number;
  failed: number;
  // Lead-niveau statussen:
  sent: number;
  opened: number;
  replied: number;
  interested: number;
  optedOut: number;
  notContacted: number;
}

export interface SalesMetrics {
  inboundMessages: number;
  qualified: number;
  needsHuman: number;
  objections: number;
  demoRequests: number;
  callRequests: number;
}

export interface ProjectMetrics {
  total: number;
  byStatus: Partial<Record<ProjectStatus, number>>;
  active: number;
  awaitingApproval: number;
  inProgress: number;
  readyForReview: number;
  completed: number;
  cancelled: number;
}

export interface WebsiteMetrics {
  generated: number;
  qcPass: number;
  qcRevision: number;
  approved: number;
  readyForSilvijn: number;
  archived: number;
}

export interface AIMetrics {
  totalRuns: number;
  successful: number;
  failed: number;
  totalTokens: number;
  totalCostUsd: number;
  costPerLead: number | null;
  costPerQualifiedLead: number | null;
  recentRuns: AIRunRecord[];
}

export interface AutomationMetrics {
  totalRuns: number;
  completed: number;
  failed: number;
  stopped: number;
  blocked: number;
  averageDurationMs: number | null;
  aiCalls: number;
  estimatedCostUsd: number;
  recentRuns: AutomationRun[];
}

export interface AgencyAnalytics {
  leadSource: "mock" | "supabase";
  leads: LeadMetrics;
  outreach: OutreachMetrics;
  sales: SalesMetrics;
  projects: ProjectMetrics;
  websites: WebsiteMetrics;
  ai: AIMetrics;
  automation: AutomationMetrics;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

function zeroLeadStatuses(): Record<LeadStatus, number> {
  return { new: 0, analyzing: 0, qualified: 0, contacted: 0, interested: 0, won: 0, lost: 0 };
}

export async function getAgencyAnalytics(): Promise<AgencyAnalytics> {
  const leadRepo = getLeadRepository();
  const outreachRepo = getOutreachRepository();
  const inboundRepo = getInboundMessageRepository();
  const interactionRepo = getSalesInteractionRepository();
  const projectRepo = getProjectRepository();
  const websiteRepo = getGeneratedWebsiteRepository();
  const qcRepo = getQualityControlRepository();
  const runRepo = getAIRunRepository();
  const automationRunRepo = getAutomationRunRepository();

  const [leads, outreach, inbound, interactions, projects, websites, aiRuns, automationRuns] = await Promise.all([
    leadRepo.list(),
    outreachRepo.list(),
    inboundRepo.list(),
    interactionRepo.list(),
    projectRepo.list(),
    websiteRepo.list(),
    runRepo.listRecent(200),
    automationRunRepo.list(200),
  ]);

  // QC-resultaten per website (nieuwste QC per website telt)
  const latestQcResults = new Map<string, string>();
  for (const w of websites) {
    const latest = await qcRepo.getLatestByWebsiteId(w.id);
    if (latest) latestQcResults.set(w.id, latest.overallResult);
  }

  const leadStatusCounts = { ...zeroLeadStatuses(), ...countBy(leads, (l: Lead) => l.leadStatus) };
  const outreachCounts = countBy(outreach, (d: { status: OutreachDraftStatus }) => d.status);
  // Lead-niveau outreach-statussen (sent/opened/replied/opted_out) bestaan alleen op de lead.
  const leadOutreachCounts = countBy(leads, (l: Lead) => l.outreachStatus ?? "not_contacted");
  const qualifiedLeads = leads.filter((l: Lead) =>
    ["qualified", "contacted", "interested", "won"].includes(l.leadStatus)
  ).length;

  const aiTotalCost = aiRuns.reduce((sum, r) => sum + (r.estimatedCost ?? 0), 0);
  const aiTotalTokens = aiRuns.reduce((sum, r) => sum + (r.totalTokens ?? 0), 0);

  const runDurations = automationRuns
    .map((r: AutomationRun) => {
      if (!r.startedAt || !r.completedAt) return null;
      const ms = new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime();
      return Number.isFinite(ms) ? ms : null;
    })
    .filter((ms): ms is number => ms !== null);

  const websitesStatus = countBy(websites, (w: GeneratedWebsite) => w.status);

  return {
    leadSource: leadRepo.source,
    leads: {
      total: leads.length,
      byStatus: leadStatusCounts as Record<LeadStatus, number>,
      new: leadStatusCounts.new ?? 0,
      analyzed: leadStatusCounts.analyzing ?? 0,
      qualified: leadStatusCounts.qualified ?? 0,
      contacted: leadStatusCounts.contacted ?? 0,
      interested: leadStatusCounts.interested ?? 0,
      won: leadStatusCounts.won ?? 0,
      lost: leadStatusCounts.lost ?? 0,
    },
    outreach: {
      drafts: (outreachCounts.draft ?? 0) + (outreachCounts.ready_for_review ?? 0) + (outreachCounts.approved ?? 0),
      readyForReview: outreachCounts.ready_for_review ?? 0,
      approved: outreachCounts.approved ?? 0,
      failed: outreachCounts.failed ?? 0,
      sent: leadOutreachCounts.sent ?? 0,
      opened: leadOutreachCounts.opened ?? 0,
      replied: leadOutreachCounts.replied ?? 0,
      interested: leadOutreachCounts.interested ?? 0,
      optedOut: leadOutreachCounts.opted_out ?? 0,
      notContacted: leadOutreachCounts.not_contacted ?? 0,
    },
    sales: {
      inboundMessages: inbound.length,
      qualified: interactions.filter((i: { qualification: { status?: string; }; }) => i.qualification?.status === "qualified").length,
      needsHuman: interactions.filter((i: { escalationRequired: boolean }) => i.escalationRequired).length,
      objections: interactions.filter((i: { objectionType: string }) => i.objectionType && i.objectionType !== "none").length,
      demoRequests: interactions.filter((i: { intent: string }) => i.intent === "demo_request").length,
      callRequests: interactions.filter((i: { intent: string }) => i.intent === "call_request").length,
    },
    projects: (() => {
      const byStatus = countBy(projects, (p: { status: ProjectStatus }) => p.status);
      return {
        total: projects.length,
        byStatus,
        active: (byStatus.in_progress ?? 0) + (byStatus.approved ?? 0),
        awaitingApproval: byStatus.awaiting_approval ?? 0,
        inProgress: byStatus.in_progress ?? 0,
        readyForReview: byStatus.ready_for_review ?? 0,
        completed: byStatus.completed ?? 0,
        cancelled: byStatus.cancelled ?? 0,
      };
    })(),
    websites: {
      generated: websites.filter((w: GeneratedWebsite) => w.status !== "generating").length,
      qcPass: [...latestQcResults.values()].filter((r) => r === "pass").length,
      qcRevision: [...latestQcResults.values()].filter((r) => r === "needs_revision").length,
      approved: websitesStatus.approved ?? 0,
      readyForSilvijn: websitesStatus.ready_for_silvijn ?? 0,
      archived: websitesStatus.archived ?? 0,
    },
    ai: {
      totalRuns: aiRuns.length,
      successful: aiRuns.filter((r) => r.status === "completed").length,
      failed: aiRuns.filter((r) => r.status === "failed").length,
      totalTokens: aiTotalTokens,
      totalCostUsd: Math.round(aiTotalCost * 1_000_000) / 1_000_000,
      costPerLead: leads.length > 0 ? Math.round((aiTotalCost / leads.length) * 1_000_000) / 1_000_000 : null,
      costPerQualifiedLead: qualifiedLeads > 0 ? Math.round((aiTotalCost / qualifiedLeads) * 1_000_000) / 1_000_000 : null,
      recentRuns: aiRuns.slice(0, 10),
    },
    automation: {
      totalRuns: automationRuns.length,
      completed: automationRuns.filter((r: AutomationRun) => r.status === "completed").length,
      failed: automationRuns.filter((r: AutomationRun) => r.status === "failed").length,
      stopped: automationRuns.filter((r: AutomationRun) => r.status === "cancelled").length,
      blocked: automationRuns.filter((r: AutomationRun) => r.status === "blocked").length,
      averageDurationMs: runDurations.length > 0 ? Math.round(runDurations.reduce((a, b) => a + b, 0) / runDurations.length) : null,
      aiCalls: automationRuns.reduce((sum, r: AutomationRun) => {
        const meta = r.metadata as { aiCalls?: number } | null;
        return sum + (meta?.aiCalls ?? 0);
      }, 0),
      estimatedCostUsd: Math.round(
        automationRuns.reduce((sum, r: AutomationRun) => {
          const meta = r.metadata as { estimatedCostUsd?: number } | null;
          return sum + (meta?.estimatedCostUsd ?? 0);
        }, 0) * 1_000_000
      ) / 1_000_000,
      recentRuns: automationRuns.slice(0, 10),
    },
  };
}
