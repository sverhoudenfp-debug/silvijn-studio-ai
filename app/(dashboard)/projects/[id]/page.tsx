
import Link from "next/link";
import { LifecycleControl } from "@/components/leads/lifecycle-control";
import { requireStudioOwner } from "@/lib/auth/server";
import { notFound } from "next/navigation";
import { ProjectDetail } from "@/components/projects/project-detail";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getSalesInteractionRepository } from "@/lib/sales/repository";
import { getProjectRepository } from "@/lib/projects/repository";
import { QualityControlService } from "@/lib/qc/service";
import { getGeneratedWebsiteRepository } from "@/lib/websites/repository";
import { getDownloadableArtifactForWebsite } from "@/lib/websites/theme-zip/download";
import { findQuestionnairesByLead } from "@/lib/questionnaire/service";
import { QuestionnaireSection } from "@/components/leads/questionnaire-section";
import { DesignPlanService } from "@/lib/websites/design-plan-service";
import { evaluateRequirementsCompleteness } from "@/lib/projects/completeness";

export async function generateMetadata(props: PageProps<"/projects/[id]">) {
  await requireStudioOwner();
  const { id } = await props.params;
  const project = await getProjectRepository().getById(id);
  return { title: project ? `${project.name} | Silvijn Studio` : "Project | Silvijn Studio" };
}

/**
 * Project-detail — server component; alle mutaties lopen via expliciete
 * server actions (Fase 8).
 */
export default async function ProjectDetailPage(props: PageProps<"/projects/[id]">) {
  await requireStudioOwner();
  const { id } = await props.params;

  const project = await getProjectRepository().getById(id);
  if (!project) notFound();

  const [lead, interactions, websites, questionnaires, designPlans] = await Promise.all([
    getLeadRepository().get(project.leadId),
    getSalesInteractionRepository().listByLead(project.leadId),
    getGeneratedWebsiteRepository().listByProject(project.id),
    findQuestionnairesByLead(project.leadId),
    new DesignPlanService().listByProject(project.id),
  ]);
  const completeness = evaluateRequirementsCompleteness(project.requirements, questionnaires.map((q) => ({
    status: q.status,
    completionStatus: q.completionStatus,
  })));
  const latestWebsite = websites.find((w) => w.status !== "archived") ?? websites[0] ?? null;
  const latestQc = latestWebsite
    ? await new QualityControlService().getLatestQcForWebsite(latestWebsite.id)
    : null;
  const latestZipArtifact = latestWebsite ? await getDownloadableArtifactForWebsite(latestWebsite.id) : null;
  const latestQualification = interactions[0]?.qualification ?? null;

  return (
    <div className="space-y-4">
    <Link className="inline-block rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200" href={`/projects/${id}/finance`}>Prijsgoedkeuring en betalingen</Link>
    {lead && <div className="rounded-xl border border-zinc-800 p-5"><LifecycleControl key={lead.leadStatus} leadId={lead.id} status={lead.leadStatus} projectId={project.id}/></div>}
    {lead && <QuestionnaireSection leadId={lead.id} leadBusinessName={lead.businessName} projectId={project.id} questionnaires={questionnaires} />}
    <ProjectDetail
      project={project}
      lead={
        lead
          ? {
              id: lead.id,
              businessName: lead.businessName,
              leadScore: lead.leadScore,
              leadStatus: lead.leadStatus,
              industry: lead.industry,
              city: lead.city,
            }
          : null
      }
      websites={websites}
      latestQc={latestQc}
      latestZipArtifact={latestZipArtifact}
      designPlans={designPlans}
      completeness={completeness}
      latestQualification={
        latestQualification
          ? {
              status: latestQualification.status,
              interestLevel: latestQualification.interestLevel,
              projectType: latestQualification.projectType,
              timeline: latestQualification.timeline,
              missingInformation: latestQualification.missingInformation,
            }
          : null
      }
    />
    </div>
  );
}
