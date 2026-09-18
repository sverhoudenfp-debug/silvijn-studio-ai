
import { requireStudioOwner } from "@/lib/auth/server";
import { OutreachView } from "@/components/outreach/outreach-view";
import { OutreachCommandPanel } from "@/components/outreach/outreach-command-panel";
import { getOutreachCommandRepository } from "@/lib/outreach/command-repository";
import { findDueFollowups } from "@/lib/outreach/followups";
import { getDemoRepository } from "@/lib/repositories/demo-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { OutreachService } from "@/lib/outreach/service";
import { gmailIngestStatus } from "@/lib/gmail/ingest";

/**
 * Outreach-overzicht — echte data uit de draft-repository (geen mockstats).
 * Mock-dashboardwidgets met verzonnen "verzonden"-cijfers zijn hier bewust
 * vervangen; de dashboard-analytics uit een latere fase pakt dit centraal op.
 */
export default async function OutreachPage() {
  await requireStudioOwner();
  const service = new OutreachService();
  const [drafts, leads, demos, gmail, commands, dueFollowups] = await Promise.all([
    service.listAll(),
    getLeadRepository().list(),
    getDemoRepository().list(),
    gmailIngestStatus(),
    getOutreachCommandRepository().list(10),
    findDueFollowups(),
  ]);

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
