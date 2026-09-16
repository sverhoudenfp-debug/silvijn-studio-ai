import { notFound } from "next/navigation";
import { QcReportView } from "@/components/websites/qc-report-view";
import { QualityControlService } from "@/lib/qc/service";
import { getGeneratedWebsiteRepository } from "@/lib/websites/repository";

export async function generateMetadata(props: PageProps<"/generated-websites/[slug]/qc">) {
  const { slug } = await props.params;
  const website = await getGeneratedWebsiteRepository().getBySlug(slug);
  return {
    title: website ? `QC — ${website.businessName} | Silvijn Studio` : "Quality Control | Silvijn Studio",
  };
}

/**
 * QC-rapport + menselijke approval-flow per websiteversie (Fase 10).
 * Onbekende slug → echte 404.
 */
export default async function WebsiteQcPage(props: PageProps<"/generated-websites/[slug]/qc">) {
  const { slug } = await props.params;
  const website = await getGeneratedWebsiteRepository().getBySlug(slug);
  if (!website) notFound();

  const qc = await new QualityControlService().getLatestQcForWebsite(website.id);

  return <QcReportView website={website} qc={qc} />;
}
