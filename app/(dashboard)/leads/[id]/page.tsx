import { notFound } from "next/navigation";
import { LeadDetail } from "@/components/leads/lead-detail";
import { leads } from "@/lib/mock-data";

export default async function LeadDetailPage(props: PageProps<"/leads/[id]">) {
  const { id } = await props.params;
  const lead = leads.find((item) => item.id === id);
  if (!lead) notFound();
  return <LeadDetail lead={lead} />;
}
