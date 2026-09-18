"use server";

import { requireStudioOwner } from "@/lib/auth/server";
import { revalidatePath } from "next/cache";
import { DiscoveryInputError, DiscoveryOrchestrator, type DiscoveryCommandResult } from "@/lib/discovery/orchestrator";
import { getDiscoveryRunRepository } from "@/lib/repositories/discovery-run-repository";
import type { DiscoveryRunRecord } from "@/lib/discovery/run-types";
import type { DiscoverySource } from "@/lib/discovery/types";

/**
 * Server action — de enige entree voor een discovery-run vanuit de UI.
 * Expliciet, gecontroleerd, limiet-afgetopt. Geen enkele automatische trigger,
 * geen cron, geen entity-event. Discovery start uitsluitend door de eigenaar
 * en start nooit zelf outreach.
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

export async function runDiscovery(input: DiscoveryFormInput): Promise<DiscoveryCommandResult> {
  await requireStudioOwner();
  const { user } = await requireStudioOwner();
  const source = KNOWN_SOURCES.includes(input.source as DiscoverySource)
    ? (input.source as DiscoverySource)
    : "mock";

  const orchestrator = new DiscoveryOrchestrator();
  try {
    const result = await orchestrator.runCommand({
      ownerUserId: user.id,
      country: input.country || "NL",
      province: input.province,
      city: input.city,
      industry: input.industry,
      query: input.query,
      source,
      limit: Number.isFinite(input.limit) ? input.limit : 20,
    });
    if (result.runId) {
      revalidatePath("/lead-discovery");
      if (result.createdLeadSummaries.length > 0) {
        revalidatePath("/leads");
        revalidatePath("/dashboard");
      }
    }
    return result;
  } catch (error) {
    if (error instanceof DiscoveryInputError) {
      return {
        runId: null,
        command: "",
        status: "rejected",
        discovery: null,
        createdLeadSummaries: [],
        errors: [error.message],
      };
    }
    throw error;
  }
}

/** Recente discovery-opdrachten voor de geschiedenis in het dashboard (owner-only). */
export async function listDiscoveryRuns(limit = 10): Promise<DiscoveryRunRecord[]> {
  await requireStudioOwner();
  return getDiscoveryRunRepository().list(limit);
}
