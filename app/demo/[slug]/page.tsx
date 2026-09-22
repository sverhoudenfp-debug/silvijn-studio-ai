import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoRenderer } from "@/components/demo/demo-renderer";
import { DemoStatusPage } from "@/components/demo/demo-status-page";
import { getDemoRepository } from "@/lib/repositories/demo-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";

/**
 * Demo Website System — publieke preview-route (data via het DemoRepository:
 * automatisch Supabase zodra geconfigureerd, anders mock).
 * READY → volledige preview via het templatesysteem.
 * GENERATING/FAILED → nette statuspagina.
 * Onbekende slug of geen demo-record → 404 (geen fake demo's).
 */

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/demo/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const demo = await getDemoRepository().findBySlug(slug);
  if (!demo) return { title: "Demo niet gevonden | Silvijn Studio" };
  return {
    title: `${demo.businessName} | ${demo.industry} in ${demo.city}`,
    description: demo.description,
  };
}

export default async function DemoPage(props: PageProps<"/demo/[slug]">) {
  const { slug } = await props.params;
  const demo = await getDemoRepository().findBySlug(slug);
  if (!demo) notFound();

  const lead = await getLeadRepository().get(demo.leadId);

  if (demo.status !== "ready") {
    return <DemoStatusPage demo={demo} lead={lead ?? undefined} />;
  }

  if (demo.source === "theme_page") {
    // G4: het volledige, zelfstandige HTML-document uit ons eigen thema.
    return (
      <iframe
        title={`Voorbeeldontwerp ${demo.businessName}`}
        src={`/demo/${demo.slug}/html`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        style={{ display: "block", width: "100vw", height: "100vh", border: 0, background: "#fff" }}
      />
    );
  }

  if (!lead) notFound();
  return <DemoRenderer demo={demo} lead={lead} />;
}
