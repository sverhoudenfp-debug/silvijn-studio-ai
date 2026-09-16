import { LeadsView } from "@/components/leads/leads-view";
import { getLeadRepository } from "@/lib/repositories/lead-repository";

export default async function LeadsPage() {
  const leads = await getLeadRepository().list();
  return <LeadsView leads={leads} />;
}
