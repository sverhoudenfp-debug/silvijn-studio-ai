import { redirect } from "next/navigation";

/** Fase 11: de automation-shell is vervangen door het echte /automations-dashboard. */
export default function AutomationRedirectPage() {
  redirect("/automations");
}
