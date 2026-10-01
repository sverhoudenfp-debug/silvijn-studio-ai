
import { requireStudioOwner } from "@/lib/auth/server";
import { OutreachView } from "@/components/outreach/outreach-view";
import { OutreachCommandPanel } from "@/components/outreach/outreach-command-panel";
import { getOutreachCommandRepository } from "@/lib/outreach/command-repository";
import { findDueFollowups } from "@/lib/outreach/followups";
import { getDemoRepository } from "@/lib/repositories/demo-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { OutreachService } from "@/lib/outreach/service";
import { gmailIngestStatus } from "@/lib/gmail/ingest";
import { isTestLead, isTestLeadLinked, resolveShowTestData, testLeadIdSet } from "@/lib/leads/test-data";

/**
 * Outreach-overzicht — echte data uit de draft-repository (geen mockstats).
 * Mock-dashboardwidgets met verzonnen "verzonden"-cijfers zijn hier bewust
 * vervangen; de dashboard-analytics uit een latere fase pakt dit centraal op.
 */
export default async function OutreachPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStudioOwner();
  const showTestData = resolveShowTestData(await searchParams);
  const service = new OutreachService();
  const [allDrafts, allLeads, demos, gmail, commands, allFollowups] = await Promise.all([
    service.listAll(),
    getLeadRepository().list(),
    getDemoRepository().list(),
    gmailIngestStatus(),
    getOutreachCommandRepository().list(10),
    findDueFollowups(),
  ]);
  // Testdata-scheiding (2026-10-01): drafts/followups van mock-/fixture-leads
  // verdwijnen uit het normale outreach-overzicht; ?test=1 toont expliciet.
  const testIds = testLeadIdSet(allLeads);
  const drafts = showTestData ? allDrafts : allDrafts.filter((d) => !isTestLeadLinked(testIds, d.leadId));
  const leads = showTestData ? allLeads : allLeads.filter((l) => !isTestLead(l));
  const dueFollowups = showTestData ? allFollowups : allFollowups.filter((d) => !isTestLeadLinked(testIds, d.leadId));

  const leadNames: Record<string, { name: string; hasDemo: boolean; demoUrl: string | null }> = {};
  for (const lead of leads) {
    const demo = demos.find((d) => d.leadId === lead.id);
    leadNames[lead.id] = {
      name: lead.businessName,
      hasDemo: demo?.status === "ready",
      demoUrl: demo?.status === "ready" ? demo.previewUrl : null,
    };
  }

  return (
    <div className="space-y-6">
      <OutreachCommandPanel
        commands={commands}
        dueFollowups={dueFollowups.map((d) => ({
          leadId: d.leadId,
          businessName: d.businessName,
          sentFollowups: d.sentFollowups,
        }))}
      />
      <OutreachView initialDrafts={drafts} leadNames={leadNames} gmailReady={gmail.configured && gmail.connected} />
    </div>
  );
}
