
import { requireStudioOwner } from "@/lib/auth/server";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireStudioOwner();
  return <DashboardShell>{children}</DashboardShell>;
}
