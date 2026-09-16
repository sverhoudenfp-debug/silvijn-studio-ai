import { notFound } from "next/navigation";
import { ProjectDetail } from "@/components/projects/project-detail";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getSalesInteractionRepository } from "@/lib/sales/repository";
import { getProjectRepository } from "@/lib/projects/repository";
import { QualityControlService } from "@/lib/qc/service";
import { getGeneratedWebsiteRepository } from "@/lib/websites/repository";

export async function generateMetadata(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  const project = await getProjectRepository().getById(id);
  return { title: project ? `${project.name} | Silvijn Studio` : "Project | Silvijn Studio" };
}

/**
 * Project-detail — server component; alle mutaties lopen via expliciete
 * server actions (Fase 8).
 */
export default async function ProjectDetailPage(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;

  const project = await getProjectRepository().getById(id);
  if (!project) notFound();

  const [lead, interactions, websites] = await Promise.all([
    getLeadRepository().get(project.leadId),
    getSalesInteractionRepository().listByLead(project.leadId),
    getGeneratedWebsiteRepository().listByProject(project.id),
  ]);
  const latestWebsite = websites.find((w) => w.status !== "archived") ?? websites[0] ?? null;
  const latestQc = latestWebsite
    ? await new QualityControlService().getLatestQcForWebsite(latestWebsite.id)
    : null;
  const latestQualification = interactions[0]?.qualification ?? null;

  return (
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
  );
}
