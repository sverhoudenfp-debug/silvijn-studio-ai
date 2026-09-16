import { notFound } from "next/navigation";
import { GeneratedWebsiteRenderer } from "@/components/websites/generated-website-renderer";
import { WebsiteStatusPage } from "@/components/websites/website-status-page";
import { getGeneratedWebsiteRepository } from "@/lib/websites/repository";

export async function generateMetadata(props: PageProps<"/generated-websites/[slug]">) {
  const { slug } = await props.params;
  const website = await getGeneratedWebsiteRepository().getBySlug(slug);
  return {
    title: website ? `${website.businessName} — preview | Silvijn Studio` : "Website | Silvijn Studio",
  };
}

/**
 * Veilige preview-route voor gegenereerde websites (Fase 9).
 * READY_FOR_QC → volledige weergave via gecontroleerde componenten;
 * GENERATING/GENERATED/BUILDING → statuspagina; FAILED → foutstatus;
 * onbekende slug → echte 404.
 */
export default async function GeneratedWebsitePage(props: PageProps<"/generated-websites/[slug]">) {
  const { slug } = await props.params;
  const website = await getGeneratedWebsiteRepository().getBySlug(slug);
  if (!website) notFound();

  if (website.status === "ready_for_qc" && website.generatedContent) {
    return <GeneratedWebsiteRenderer website={website} />;
  }

  return <WebsiteStatusPage website={website} />;
}
