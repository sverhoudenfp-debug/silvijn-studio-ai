
import { requireStudioOwner } from "@/lib/auth/server";
import { redirect } from "next/navigation";

/** Fase 11: de automation-shell is vervangen door het echte /automations-dashboard. */
export default async function AutomationRedirectPage() {
  await requireStudioOwner();
  redirect("/automations");
}
