
import { requireStudioOwner } from "@/lib/auth/server";
import { LeadsView } from "@/components/leads/leads-view";
import { getLeadRepository } from "@/lib/repositories/lead-repository";

export default async function LeadsPage() {
  await requireStudioOwner();
  const leads = await getLeadRepository().list();
  return <LeadsView leads={leads} />;
}
