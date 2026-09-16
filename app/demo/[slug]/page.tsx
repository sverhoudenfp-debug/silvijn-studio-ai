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

export async function generateStaticParams() {
  // SSG-slugs uit de repository (mock-mode: de bekende demo-slugs).
  const demoList = await getDemoRepository().list();
  return demoList.map((demo) => ({ slug: demo.slug }));
}

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

  if (!lead) notFound();
  return <DemoRenderer demo={demo} lead={lead} />;
}
