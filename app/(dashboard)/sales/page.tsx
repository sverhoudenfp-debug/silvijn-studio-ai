import { requireStudioOwner } from "@/lib/auth/server";
import { SalesView } from "@/components/sales/sales-view";
import { ReplyPipelinePanel } from "@/components/sales/reply-pipeline-panel";
import { RecentReplies } from "@/components/sales/recent-replies";
import { getInboundMessageRepository, getSalesInteractionRepository } from "@/lib/sales/repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { SalesService } from "@/lib/sales/service";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * AI Sales-overzicht — echte data uit de sales-repository's (geen mockstats).
 * Recente klantreacties staan bovenaan als kaarten; klik opent de
 * volledige conversation/thread.
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

  // Conversatie-koppeling per lead voor de "Open gesprek"-links.
  const conversationsByLead: Record<string, string> = {};
  if (isSupabaseConfigured()) {
    const { data } = await getSupabaseServerClient()
      .from("conversations")
      .select("id,lead_id,last_reply_at")
      .order("last_reply_at", { ascending: false });
    for (const row of (data ?? []) as { id: string; lead_id: string }[]) {
      if (!conversationsByLead[row.lead_id]) conversationsByLead[row.lead_id] = row.id;
    }
  }

  return (
    <div className="space-y-6">
      <ReplyPipelinePanel pendingCount={pendingReplies} />
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-50">Nieuwe reacties</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Elke bevestigde klantreactie, automatisch geanalyseerd door AI. In Review-modus maakt de AI een concept; jij beslist en verstuurt.
          </p>
        </div>
        <RecentReplies inbounds={inbounds} interactions={interactions} leadNames={leadNames} conversationsByLead={conversationsByLead} />
      </section>
      <SalesView interactions={interactions} leadNames={leadNames} />
    </div>
  );
}
