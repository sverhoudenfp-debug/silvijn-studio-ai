import { notFound } from "next/navigation";
import { LeadDetail } from "@/components/leads/lead-detail";
import { getDemoRepository } from "@/lib/repositories/demo-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getProjectRepository } from "@/lib/projects/repository";

export default async function LeadDetailPage(props: PageProps<"/leads/[id]">) {
  const { id } = await props.params;
  const lead = await getLeadRepository().get(id);
  if (!lead) notFound();
  const [demo, project] = await Promise.all([
    getDemoRepository().findByLeadId(lead.id),
    getProjectRepository().getByLeadId(lead.id),
  ]);
  return <LeadDetail lead={lead} demo={demo} project={project} />;
}
