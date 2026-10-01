
import { requireStudioOwner } from "@/lib/auth/server";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getAIConfig } from "@/lib/ai/config";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireStudioOwner();

  // Echte AI-modus i.p.v. de oude hardcoded "Mock mode"-label: de productie-
  // omgeving draait live AI en de sidebar mag daar nooit over liegen.
  let aiMode: "live" | "mock" | "configfout" = "mock";
  try {
    aiMode = getAIConfig().mode === "live" ? "live" : "mock";
  } catch {
    aiMode = "configfout";
  }

  return (
    <DashboardShell aiMode={aiMode} supabaseConnected={isSupabaseConfigured()}>
      {children}
    </DashboardShell>
  );
}
