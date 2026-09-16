"use server";

import { revalidatePath } from "next/cache";
import { LeadDiscoveryService } from "@/lib/discovery/service";
import type { DiscoveryRequest, DiscoverySource } from "@/lib/discovery/types";

/**
 * Server action — de enige entree voor een discovery-run vanuit de UI.
 * Expliciet, gecontroleerd, limiet-afgetopt. Geen enkele automatische trigger.
 */

export interface DiscoveryFormInput {
  country: string;
  province?: string;
  city?: string;
  industry?: string;
  query?: string;
  source: string;
  limit: number;
}

const KNOWN_SOURCES: DiscoverySource[] = ["mock", "google", "directory"];

export async function runDiscovery(input: DiscoveryFormInput) {
  const source = KNOWN_SOURCES.includes(input.source as DiscoverySource)
    ? (input.source as DiscoverySource)
    : "mock";

  const request: DiscoveryRequest = {
    country: (input.country || "NL").trim() || "NL",
    province: input.province?.trim() || undefined,
    city: input.city?.trim() || undefined,
    industry: input.industry?.trim() || undefined,
    query: input.query?.trim() || undefined,
    limit: Number.isFinite(input.limit) ? input.limit : 20,
    source,
  };

  const result = await new LeadDiscoveryService().discover(request);

  if (result.createdLeads > 0) {
    revalidatePath("/leads");
    revalidatePath("/dashboard");
  }

  return result;
}
