
import { requireStudioOwner } from "@/lib/auth/server";
import { DemoWebsitesView } from "@/components/demo/demo-websites-view";
import { getDemoRepository } from "@/lib/repositories/demo-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";

export default async function DemoWebsitesPage() {
  await requireStudioOwner();
  const [demos, leads] = await Promise.all([
    getDemoRepository().list(),
    getLeadRepository().list(),
  ]);
  const rows = demos.map((demo) => ({
    demo,
    lead: leads.find((item) => item.id === demo.leadId) ?? null,
  }));
  return <DemoWebsitesView rows={rows} />;
}
