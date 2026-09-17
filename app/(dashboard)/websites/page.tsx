
import { requireStudioOwner } from "@/lib/auth/server";
import { redirect } from "next/navigation";

/**
 * Fase 9: de oude Websites-shell (met fictieve data) is vervangen door de
 * echte /generated-websites-pagina; deze route verwijst door.
 */
export default async function WebsitesRedirectPage() {
  await requireStudioOwner();
  redirect("/generated-websites");
}
