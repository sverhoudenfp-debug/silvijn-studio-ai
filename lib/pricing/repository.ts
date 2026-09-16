import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { PriceIndication } from "./types";

/**
 * PriceIndicationRepository — historie van prijsindicaties per project.
 * Oude indicaties worden NOOIT stilzwijgend overschreven: elke berekening
 * is een nieuwe indicatie met de eigen pricingVersion (versie-herleidbaar).
 */

export interface PriceIndicationRepository {
  readonly source: "mock" | "supabase";
  create(indication: PriceIndication): Promise<PriceIndication>;
  listByProject(projectId: string): Promise<PriceIndication[]>;
}

class MemoryPriceIndicationRepository implements PriceIndicationRepository {
  readonly source = "mock" as const;
  private indications: PriceIndication[] = [];

  async create(indication: PriceIndication): Promise<PriceIndication> {
    this.indications.push(indication);
    return indication;
  }
  async listByProject(projectId: string): Promise<PriceIndication[]> {
    return this.indications
      .filter((i) => i.projectId === projectId)
      .sort((a, b) => b.calculatedAt.localeCompare(a.calculatedAt));
  }
}

class SupabasePriceIndicationRepository implements PriceIndicationRepository {
  readonly source = "supabase" as const;

  async create(indication: PriceIndication): Promise<PriceIndication> {
    const { error } = await getSupabaseServerClient().from("price_indications").insert({
      id: indication.id,
      project_id: indication.projectId,
      currency: indication.currency,
      pricing_version: indication.pricingVersion,
      line_items: indication.lineItems,
      base_price: indication.basePrice,
      add_ons_total: indication.addOnsTotal,
      adjustments_total: indication.adjustmentsTotal,
      subtotal: indication.subtotal,
      tax: indication.tax,
      total: indication.total,
      price_range: indication.priceRange,
      assumptions: indication.assumptions,
      missing_information: indication.missingInformation,
      status: indication.status,
      requires_human: indication.requiresHuman,
      escalation_reasons: indication.escalationReasons,
      calculated_at: indication.calculatedAt,
    });
    if (error) throw new Error(`PriceIndicationRepository: indicatie opslaan mislukt: ${error.message}`);
    return indication;
  }
  async listByProject(projectId: string): Promise<PriceIndication[]> {
    const { data, error } = await getSupabaseServerClient()
      .from("price_indications")
      .select("*")
      .eq("project_id", projectId)
      .order("calculated_at", { ascending: false });
    if (error) throw new Error(`PriceIndicationRepository: indicaties ophalen mislukt: ${error.message}`);
    return (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id as string,
        projectId: r.project_id as string,
        currency: r.currency as string,
        pricingVersion: r.pricing_version as string,
        lineItems: (r.line_items as PriceIndication["lineItems"]) ?? [],
        basePrice: r.base_price as number,
        addOnsTotal: r.add_ons_total as number,
        adjustmentsTotal: r.adjustments_total as number,
        subtotal: r.subtotal as number,
        tax: r.tax as number,
        total: r.total as number,
        priceRange: (r.price_range as PriceIndication["priceRange"]) ?? null,
        assumptions: (r.assumptions as string[]) ?? [],
        missingInformation: (r.missing_information as string[]) ?? [],
        status: r.status as PriceIndication["status"],
        requiresHuman: r.requires_human as boolean,
        escalationReasons: (r.escalation_reasons as string[]) ?? [],
        calculatedAt: r.calculated_at as string,
      };
    });
  }
}

let memoryRepo: MemoryPriceIndicationRepository | null = null;

export function getPriceIndicationRepository(): PriceIndicationRepository {
  if (isSupabaseConfigured()) return new SupabasePriceIndicationRepository();
  memoryRepo ??= new MemoryPriceIndicationRepository();
  return memoryRepo;
}
