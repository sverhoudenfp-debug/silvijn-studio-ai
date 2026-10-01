import "server-only";
import { cache } from "react";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getProjectRepository } from "@/lib/projects/repository";
import { getGeneratedWebsiteRepository } from "@/lib/websites/repository";
import { getOutreachRepository } from "@/lib/outreach/repository";
import { getInboundMessageRepository, getSalesInteractionRepository } from "@/lib/sales/repository";
import { getQuestionnaireRepository } from "@/lib/questionnaire/repository";
import { getQualityControlRepository } from "@/lib/qc/repository";
import { getDemoRepository } from "@/lib/repositories/demo-repository";
import { getAIRunRepository } from "@/lib/repositories/ai-run-repository";
import { getAutomationRepository, getAutomationRunRepository } from "@/lib/automation/repositories";
import type { Lead } from "@/lib/types";
import type { Project } from "@/lib/projects/types";
import type { GeneratedWebsite } from "@/lib/websites/types";
import type { QualityControl } from "@/lib/qc/types";
import type { OutreachDraft } from "@/lib/outreach/types";
import type { Questionnaire } from "@/lib/questionnaire/repository";
import type { DemoWebsite } from "@/lib/types";
import type { AIRunRecord } from "@/lib/repositories/ai-run-repository";
import type { InboundMessage, SalesInteraction } from "@/lib/sales/types";
import type { Automation, AutomationRun } from "@/lib/automation/types";

/**
 * Per-request read-deduplicatie (2026-10-01).
 *
 * React cache() deelt het resultaat binnen één server-render: pagina's die
 * dezelfde tabellen meerdere keren nodig hebben (analytics + needs-silvijn +
 * de pagina zelf) doen nu precies één Supabase-query per tabel per request.
 * Mutaties blijven ongewijzigd: server actions revalidatePath en de volgende
 * render krijgt een verse cache.
 *
 * Alleen lees-paden. Geen enkele business rule verandert hier.
 */

export const cachedListLeads = cache(async (): Promise<Lead[]> => getLeadRepository().list());
export const cachedListProjects = cache(async (): Promise<Project[]> => getProjectRepository().list());
export const cachedListWebsites = cache(async (): Promise<GeneratedWebsite[]> => getGeneratedWebsiteRepository().list());
export const cachedListOutreach = cache(async (): Promise<OutreachDraft[]> => getOutreachRepository().list());
export const cachedListInbound = cache(async (): Promise<InboundMessage[]> => getInboundMessageRepository().list());
export const cachedListInteractions = cache(async (): Promise<SalesInteraction[]> => getSalesInteractionRepository().list());
export const cachedListQuestionnaires = cache(async (): Promise<Questionnaire[]> => getQuestionnaireRepository().list());
export const cachedListQualityControls = cache(async (): Promise<QualityControl[]> => getQualityControlRepository().list());
export const cachedListDemos = cache(async (): Promise<DemoWebsite[]> => getDemoRepository().list());
export const cachedListAiRuns = cache(async (limit: number): Promise<AIRunRecord[]> => getAIRunRepository().listRecent(limit));
export const cachedListAutomations = cache(async (): Promise<Automation[]> => getAutomationRepository().list());
export const cachedListAutomationRuns = cache(async (limit: number): Promise<AutomationRun[]> => getAutomationRunRepository().list(limit));

/**
 * Nieuwste QC-resultaat per website in één batch (was: N+1 met een seriële
 * getLatestByWebsiteId-query per website op /dashboard en /analytics).
 */
export const cachedLatestQcByWebsite = cache(async (): Promise<Map<string, QualityControl>> => {
  const all = await cachedListQualityControls();
  const byWebsite = new Map<string, QualityControl>();
  for (const qc of all) {
    const existing = byWebsite.get(qc.generatedWebsiteId);
    if (!existing || new Date(qc.createdAt) > new Date(existing.createdAt)) {
      byWebsite.set(qc.generatedWebsiteId, qc);
    }
  }
  return byWebsite;
});
