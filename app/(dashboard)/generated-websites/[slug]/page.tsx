import { notFound } from "next/navigation";
import { GeneratedWebsiteRenderer } from "@/components/websites/generated-website-renderer";
import { QcBanner } from "@/components/websites/qc-banner";
import { WebsiteStatusPage } from "@/components/websites/website-status-page";
import { QualityControlService } from "@/lib/qc/service";
import { getGeneratedWebsiteRepository } from "@/lib/websites/repository";

export async function generateMetadata(props: PageProps<"/generated-websites/[slug]">) {
  const { slug } = await props.params;
  const website = await getGeneratedWebsiteRepository().getBySlug(slug);
  return {
    title: website ? `${website.businessName} — preview | Silvijn Studio` : "Website | Silvijn Studio",
  };
}

/**
 * Veilige preview-route voor gegenereerde websites (Fase 9/10).
 * Volledig rendeerbaar vanaf READY_FOR_QC (met QC-banner); GENERATING/
 * GENERATED/BUILDING → statuspagina; FAILED → foutstatus (incl. QC-fail);
 * onbekende slug → echte 404.
 */
export default async function GeneratedWebsitePage(props: PageProps<"/generated-websites/[slug]">) {
  const { slug } = await props.params;
  const website = await getGeneratedWebsiteRepository().getBySlug(slug);
  if (!website) notFound();

  const qc = await new QualityControlService().getLatestQcForWebsite(website.id);
  const renderable =
    website.generatedContent &&
    ["ready_for_qc", "qc_running", "ready_for_silvijn", "needs_revision", "approved"].includes(website.status);

  if (renderable) {
    return (
      <div className="min-h-screen bg-white text-zinc-900">
        <QcBanner website={website} qc={qc} />
        <GeneratedWebsiteRenderer website={website} />
      </div>
    );
  }

  return <WebsiteStatusPage website={website} qc={qc} />;
}
