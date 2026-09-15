import { notFound } from "next/navigation";
import { DemoDetail } from "@/components/demo/demo-detail";
import { demos } from "@/lib/mock-demos";
import { leads } from "@/lib/mock-data";

export default async function DemoDetailPage(props: PageProps<"/demo-websites/[id]">) {
  const { id } = await props.params;
  const demo = demos.find((item) => item.id === id);
  if (!demo) notFound();
  const lead = leads.find((item) => item.id === demo.leadId);
  return <DemoDetail demo={demo} lead={lead} />;
}
