import { leads } from "@/lib/mock-data";
import type { RawBusiness } from "@/lib/types";

/**
 * LeadSource abstraction — alle lead discovery providers implementeren
 * deze interface, zodat databronnen later kunnen worden vervangen of
 * gecombineerd (Google Maps, openbare bedrijfs-APIs, etc.) zonder dat
 * de rest van het systeem verandert.
 */

export interface LeadSearchParams {
  industries?: string[];
  locations?: string[];
  limit?: number;
}

export interface LeadSource {
  readonly id: string;
  readonly name: string;
  searchBusinesses(params?: LeadSearchParams): Promise<RawBusiness[]>;
}

export class MockLeadSource implements LeadSource {
  readonly id = "mock";
  readonly name = "Mock lead source (development mode)";

  async searchBusinesses(params: LeadSearchParams = {}): Promise<RawBusiness[]> {
    const { industries, locations, limit } = params;

    let result: RawBusiness[] = leads.map((lead) => ({
      name: lead.name,
      category: lead.category,
      location: lead.location,
      phone: lead.phone,
      email: lead.email,
      website: lead.website,
      rating: lead.rating,
      reviewCount: lead.reviewCount,
      source: "mock",
    }));

    if (industries?.length) {
      result = result.filter((business) => industries.includes(business.category));
    }
    if (locations?.length) {
      result = result.filter((business) => locations.includes(business.location));
    }

    return limit ? result.slice(0, limit) : result;
  }
}

export function getLeadSource(): LeadSource {
  // Later: actieve bron kiezen op basis van environment variables
  // (bijv. GOOGLE_MAPS_API_KEY -> GoogleMapsLeadSource).
  return new MockLeadSource();
}
