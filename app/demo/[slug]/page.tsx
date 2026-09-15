import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoRenderer } from "@/components/demo/demo-renderer";
import { DemoStatusPage } from "@/components/demo/demo-status-page";
import { demos } from "@/lib/mock-demos";
import { leads } from "@/lib/mock-data";

/**
 * Demo Website System — publieke preview-route.
 * READY → volledige preview via het templatesysteem.
 * GENERATING/FAILED → nette statuspagina.
 * Onbekende slug of geen demo-record → 404 (geen fake demo's).
 */

export function generateStaticParams() {
  return demos.map((demo) => ({ slug: demo.slug }));
}

export async function generateMetadata(props: PageProps<"/demo/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const demo = demos.find((item) => item.slug === slug);
  if (!demo) return { title: "Demo niet gevonden | Silvijn Studio" };
  return {
    title: `${demo.businessName} | ${demo.industry} in ${demo.city}`,
    description: demo.description,
  };
}

export default async function DemoPage(props: PageProps<"/demo/[slug]">) {
  const { slug } = await props.params;
  const demo = demos.find((item) => item.slug === slug);
  if (!demo) notFound();

  const lead = leads.find((item) => item.id === demo.leadId);

  if (demo.status !== "ready") {
    return <DemoStatusPage demo={demo} lead={lead} />;
  }

  if (!lead) notFound();
  return <DemoRenderer demo={demo} lead={lead} />;
}
