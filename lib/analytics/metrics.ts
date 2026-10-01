import "server-only";
import {
  bucketCounts,
  bucketSums,
  dailyBuckets,
  monthlyBuckets,
  previousRange,
  type PeriodRange,
  type TimeBucket,
} from "@/lib/analytics/period";
import { listRevenueEvents, type RevenueEvent } from "@/lib/analytics/revenue";
import { cachedListAiRuns, cachedListInbound, cachedListLeads, cachedListOutreach, cachedListProjects } from "@/lib/dashboard/cached-reads";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { isTestLeadLinked, testLeadIdSet } from "@/lib/leads/test-data";
import type { Lead } from "@/lib/types";
import type { OutreachDraft } from "@/lib/outreach/types";
import type { InboundMessage } from "@/lib/sales/types";
import type { AIRunRecord } from "@/lib/repositories/ai-run-repository";

/**
 * Periode-analytics (2026-10-01). Uitsluitend echte data:
 * - Omzet = payment_events (menselijk bevestigde betalingen), niets anders.
 * - Testdata-scheiding: fixture-/mock-lead-betaal- en lead-gegevens tellen
 *   nooit mee in productie-cijfers.
 * - Onbekend is onbekend: alleen tonen wat berekenbaar is, nul = echt nul.
 */

function inRange(timestamp: string | null | undefined, from: Date, to: Date): boolean {
  if (typeof timestamp !== "string") return false;
  const t = new Date(timestamp).getTime();
  return Number.isFinite(t) && t >= from.getTime() && t < to.getTime();
}

export interface RevenueSummary {
  count: number;
  total: number;
  average: number | null;
}

export interface PeriodKpis {
  revenue: RevenueSummary;
  previousRevenue: RevenueSummary | null;
  newLeads: number;
  previousNewLeads: number | null;
  replies: number;
  previousReplies: number | null;
  outreachSent: number;
  aiRuns: number;
  aiCostUsd: number;
}

export interface FunnelRow {
  stage: string;
  count: number;
  /** Percentage t.o.v. de breedste treder (null bij 0 totaal). */
  share: number | null;
}

export interface Timeseries {
  buckets: TimeBucket[];
  revenue: number[];
  leads: number[];
  outreachSent: number[];
  replies: number[];
}

export interface PeriodAnalyticsResult {
  leadSource: "mock" | "supabase";
  kpis: PeriodKpis;
  /** Lifetime-totaal (onafhankelijk van de geselecteerde periode). */
  lifetimeRevenue: RevenueSummary;
  leadsByStage: FunnelRow[];
  outreachFunnel: FunnelRow[];
  series: Timeseries;
  hasAnyProductionData: boolean;
}

function sumRange(events: RevenueEvent[], from: Date, to: Date): RevenueSummary {
  const inPeriod = events.filter((e) => inRange(e.createdAt, from, to));
  const total = inPeriod.reduce((sum, e) => sum + e.amount, 0);
  return {
    count: inPeriod.length,
    total: Math.round(total * 100) / 100,
    average: inPeriod.length > 0 ? Math.round((total / inPeriod.length) * 100) / 100 : null,
  };
}

function funnelFrom(rows: { stage: string; count: number }[]): FunnelRow[] {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return rows.map((r) => ({ stage: r.stage, count: r.count, share: max > 0 ? Math.round((r.count / max) * 100) : null }));
}

export async function getPeriodAnalytics(range: PeriodRange): Promise<PeriodAnalyticsResult> {
  const leadRepo = getLeadRepository();
  const [allLeads, allProjects, allOutreach, allInbound, aiRuns, revenueEvents] = await Promise.all([
    cachedListLeads(),
    cachedListProjects(),
    cachedListOutreach(),
    cachedListInbound(),
    cachedListAiRuns(200),
    listRevenueEvents(),
  ]);

  // Testdata-scheiding: alles wat aan een mock-/fixture-lead hangt (of via een
  // project aan zo'n lead) hoort niet in productie-cijfers.
  const testIds = testLeadIdSet(allLeads);
  const leads = allLeads.filter((l: Lead) => !testIds.has(l.id));
  const projects = allProjects.filter((p) => !isTestLeadLinked(testIds, p.leadId));
  const productionProjectIds = new Set(projects.map((p) => p.id));
  const revenue = revenueEvents.filter((e) => productionProjectIds.has(e.projectId));

  const prev = previousRange(range);
  const aiCost = (runs: AIRunRecord[]) =>
    Math.round(runs.reduce((sum, r) => sum + (r.estimatedCost ?? 0), 0) * 1_000_000) / 1_000_000;

  const kpis: PeriodKpis = {
    revenue: sumRange(revenue, range.from, range.to),
    previousRevenue: prev ? sumRange(revenue, prev.from, prev.to) : null,
    newLeads: leads.filter((l) => inRange(l.createdAt, range.from, range.to)).length,
    previousNewLeads: prev ? leads.filter((l) => inRange(l.createdAt, prev.from, prev.to)).length : null,
    replies: allInbound
      .filter((m: InboundMessage) => !isTestLeadLinked(testIds, m.leadId))
      .filter((m: InboundMessage) => inRange(m.receivedAt, range.from, range.to)).length,
    previousReplies: prev
      ? allInbound
          .filter((m: InboundMessage) => !isTestLeadLinked(testIds, m.leadId))
          .filter((m: InboundMessage) => inRange(m.receivedAt, prev.from, prev.to)).length
      : null,
    outreachSent: allOutreach
      .filter((d: OutreachDraft) => !isTestLeadLinked(testIds, d.leadId))
      .filter((d: OutreachDraft) => inRange(d.sentAt, range.from, range.to)).length,
    aiRuns: aiRuns.filter((r) => inRange(r.createdAt, range.from, range.to)).length,
    aiCostUsd: aiCost(aiRuns.filter((r) => inRange(r.createdAt, range.from, range.to))),
  };

  // Lifetime-omzet (productie, onafhankelijk van periodefilter).
  const lifetimeRevenue: RevenueSummary = {
    count: revenue.length,
    total: Math.round(revenue.reduce((sum, e) => sum + e.amount, 0) * 100) / 100,
    average: revenue.length > 0 ? Math.round((revenue.reduce((sum, e) => sum + e.amount, 0) / revenue.length) * 100) / 100 : null,
  };

  // Lead-funnel (lifecycle-cumulatief): een lead die "contacted" is, is ook
  // "qualified" geweest — de treden zijn cumulatief en eerlijk.
  const stageOf = (l: Lead): number => {
    switch (l.leadStatus) {
      case "won": return 5;
      case "interested": return 4;
      case "contacted": return 3;
      case "qualified": return 2;
      case "analyzing": return 1;
      default: return 0;
    }
  };
  const atLeast = (min: number) => leads.filter((l) => stageOf(l) >= min).length;
  const leadsByStage = funnelFrom([
    { stage: "Leads", count: leads.length },
    { stage: "Geanalyseerd", count: atLeast(1) },
    { stage: "Gekwalificeerd", count: atLeast(2) },
    { stage: "Gecontacteerd", count: atLeast(3) },
    { stage: "Geïnteresseerd", count: atLeast(4) },
    { stage: "Gewonnen", count: atLeast(5) },
  ]);

  // Outreach-funnel: verzonden → geopend → gereageerd (lead-niveau, cumulatief).
  const sentLeads = leads.filter((l) => ["sent", "opened", "replied", "interested"].includes(l.outreachStatus ?? "not_contacted")).length;
  const openedLeads = leads.filter((l) => ["opened", "replied", "interested"].includes(l.outreachStatus ?? "not_contacted")).length;
  const repliedLeads = leads.filter((l) => ["replied", "interested"].includes(l.outreachStatus ?? "not_contacted")).length;
  const outreachFunnel = funnelFrom([
    { stage: "Outreach verzonden", count: sentLeads },
    { stage: "Geopend", count: openedLeads },
    { stage: "Gereageerd", count: repliedLeads },
  ]);

  // Tijdreeksen: dagelijkse buckets voor korte periodes, anders maanden.
  const spanDays = (range.to.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000);
  const buckets = range.kind === "all" || spanDays > 31 ? monthlyBuckets(new Date(0), range.to, 12) : dailyBuckets(range.from, range.to, 31);
  const series: Timeseries = {
    buckets,
    revenue: bucketSums(revenue, buckets, (e) => e.createdAt, (e) => e.amount),
    leads: bucketCounts(leads, buckets, (l) => l.createdAt),
    outreachSent: bucketCounts(
      allOutreach.filter((d: OutreachDraft) => !isTestLeadLinked(testIds, d.leadId)),
      buckets,
      (d: OutreachDraft) => d.sentAt,
    ),
    replies: bucketCounts(
      allInbound.filter((m: InboundMessage) => !isTestLeadLinked(testIds, m.leadId)),
      buckets,
      (m: InboundMessage) => m.receivedAt,
    ),
  };

  const hasAnyProductionData =
    leads.length > 0 || revenue.length > 0 || kpis.outreachSent > 0 || series.replies.some((c) => c > 0) || aiRuns.length > 0;

  return {
    leadSource: leadRepo.source,
    kpis,
    lifetimeRevenue,
    leadsByStage,
    outreachFunnel,
    series,
    hasAnyProductionData,
  };
}
