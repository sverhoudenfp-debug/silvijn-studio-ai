
import { requireStudioOwner } from "@/lib/auth/server";
import { DiscoveryView } from "@/components/discovery/discovery-view";

export default async function LeadDiscoveryPage() {
  await requireStudioOwner();
  return <DiscoveryView />;
}
