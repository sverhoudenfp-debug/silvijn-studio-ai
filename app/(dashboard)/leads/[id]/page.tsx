
import { requireStudioOwner } from "@/lib/auth/server";
import { notFound } from "next/navigation";
import { LeadDetail } from "@/components/leads/lead-detail";
import { getDemoRepository } from "@/lib/repositories/demo-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getProjectRepository } from "@/lib/projects/repository";
import { findQuestionnairesByLead } from "@/lib/questionnaire/service";

export default async function LeadDetailPage(props: PageProps<"/leads/[id]">) {
  await requireStudioOwner();
  const { id } = await props.params;
  const lead = await getLeadRepository().get(id);
  if (!lead) notFound();
  const [demo, project, questionnaires] = await Promise.all([
    getDemoRepository().findByLeadId(lead.id),
    getProjectRepository().getByLeadId(lead.id),
    findQuestionnairesByLead(lead.id),
  ]);
  return <LeadDetail key={lead.updatedAt} lead={lead} demo={demo} project={project} questionnaires={questionnaires} />;
}
