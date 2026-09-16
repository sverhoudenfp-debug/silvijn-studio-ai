import { notFound } from "next/navigation";
import { DemoDetail } from "@/components/demo/demo-detail";
import { getDemoRepository } from "@/lib/repositories/demo-repository";
import { getLeadRepository } from "@/lib/repositories/lead-repository";

export default async function DemoDetailPage(props: PageProps<"/demo-websites/[id]">) {
  const { id } = await props.params;
  const demo = await getDemoRepository().get(id);
  if (!demo) notFound();
  const lead = await getLeadRepository().get(demo.leadId);
  return <DemoDetail demo={demo} lead={lead ?? undefined} />;
}
