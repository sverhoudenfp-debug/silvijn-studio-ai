import { requireStudioOwner } from "@/lib/auth/server";
import { DiscoveryView } from "@/components/discovery/discovery-view";
import { getDiscoveryRunRepository } from "@/lib/repositories/discovery-run-repository";

export default async function LeadDiscoveryPage() {
  await requireStudioOwner();
  const recentRuns = await getDiscoveryRunRepository().list(10);
  return <DiscoveryView recentRuns={recentRuns} />;
}
