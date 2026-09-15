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
  cities?: string[];
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
    const { industries, cities, limit } = params;

    let result: RawBusiness[] = leads.map((lead) => ({
      businessName: lead.businessName,
      industry: lead.industry,
      city: lead.city,
      province: lead.province,
      phone: lead.phone,
      email: lead.email,
      website: lead.website,
      websiteStatus: lead.websiteStatus,
      googleRating: lead.googleRating,
      reviewCount: lead.reviewCount,
      source: lead.source,
    }));

    if (industries?.length) {
      result = result.filter((business) => industries.includes(business.industry));
    }
    if (cities?.length) {
      result = result.filter((business) => cities.includes(business.city));
    }

    return limit ? result.slice(0, limit) : result;
  }
}

export function getLeadSource(): LeadSource {
  // Later: actieve bron kiezen op basis van environment variables
  // (bijv. GOOGLE_MAPS_API_KEY -> GoogleMapsLeadSource).
  return new MockLeadSource();
}
