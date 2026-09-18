
import { requireStudioOwner } from "@/lib/auth/server";
import { SalesView } from "@/components/sales/sales-view";
import { ReplyPipelinePanel } from "@/components/sales/reply-pipeline-panel";
import { getInboundMessageRepository, getSalesInteractionRepository } from "@/lib/sales/repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { SalesService } from "@/lib/sales/service";

/**
 * AI Sales-overzicht — echte data uit de sales-repository's (geen mockstats).
 */
export default async function SalesPage() {
  await requireStudioOwner();
  const service = new SalesService();
  const [interactions, leads, inbounds] = await Promise.all([
    service.listAllInteractions(),
    getLeadRepository().list(),
    getInboundMessageRepository().list(),
  ]);
  const processedInboundIds = new Set(
    (await getSalesInteractionRepository().list()).map((i) => i.inboundMessageId)
  );
  const pendingReplies = inbounds.filter((m) => m.replyConfirmed && !processedInboundIds.has(m.id)).length;

  const leadNames: Record<string, string> = {};
  for (const lead of leads) leadNames[lead.id] = lead.businessName;

  return (
    <div className="space-y-6">
      <ReplyPipelinePanel pendingCount={pendingReplies} />
      <SalesView interactions={interactions} leadNames={leadNames} />
    </div>
  );
}
