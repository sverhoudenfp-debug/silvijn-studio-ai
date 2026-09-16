import { SalesView } from "@/components/sales/sales-view";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { SalesService } from "@/lib/sales/service";

/**
 * AI Sales-overzicht — echte data uit de sales-repository's (geen mockstats).
 */
export default async function SalesPage() {
  const service = new SalesService();
  const [interactions, leads] = await Promise.all([
    service.listAllInteractions(),
    getLeadRepository().list(),
  ]);

  const leadNames: Record<string, string> = {};
  for (const lead of leads) leadNames[lead.id] = lead.businessName;

  return <SalesView interactions={interactions} leadNames={leadNames} />;
}
