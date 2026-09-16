import type {
  DiscoveryCandidate,
  DiscoveryRequest,
  LeadDiscoveryProvider,
} from "../types";

/**
 * MockDiscoveryProvider — de eerste discovery-bron. Bevat UITSLUITEND
 * fictieve testbedrijven; live=false zodat de UI nooit doet alsof deze
 * data uit Google of een andere echte externe bron komt.
 *
 * De kandidaten dekken bewust alle discovery-situaties:
 * - zonder website / goede website / slechte website / onbekende status
 * - ontbrekende contactgegevens (geen e-mail, geen telefoon)
 * - duplicaten van bestaande mock-leads (duplicate-detectie testen)
 * - duplicaat binnen de batch zelf
 * - ongeldige kandidaten (lege verplichte velden, kapotte website-URL)
 * - meerdere branches en Nederlandse steden
 */

const CANDIDATES: DiscoveryCandidate[] = [
  // --- zonder website (kansrijk voor de agency) ---
  { externalId: "mock-ext-001", businessName: "Brouwer Dakdekkers", industry: "Dakwerken", address: "Nokweg 4", postalCode: "5611 AA", city: "Eindhoven", province: "Noord-Brabant", country: "Nederland", phone: "+31 40 987 1122", email: "info@brouwerdakdekkers.nl", website: null, websiteStatusHint: "no_website", source: "mock", sourceUrl: null, metadata: { reviewsHint: 63, ratingHint: 4.5 } },
  { externalId: "mock-ext-002", businessName: "Pietersen Loodgieters", industry: "Loodgieters", address: "Kranestraat 90", postalCode: "3511 KK", city: "Utrecht", province: "Utrecht", country: "Nederland", phone: "+31 30 444 5566", email: null, website: null, websiteStatusHint: "no_website", source: "mock", sourceUrl: null, metadata: { reviewsHint: 41, ratingHint: 4.4 } },
  { externalId: "mock-ext-003", businessName: "Elfsteden Elektriciens", industry: "Elektriciens", address: "Voltgang 2", postalCode: "8911 BC", city: "Leeuwarden", province: "Friesland", country: "Nederland", phone: null, email: "contact@elfsteden-elektro.nl", website: null, websiteStatusHint: "no_website", source: "mock", sourceUrl: null, metadata: { reviewsHint: 28, ratingHint: 4.6 } },
  { externalId: "mock-ext-004", businessName: "Van Aken Schilders", industry: "Schilders", address: "Lindelaan 15", postalCode: "5911 AB", city: "Venlo", province: "Limburg", country: "Nederland", phone: "+31 77 222 3344", email: "info@vanakenschilders.nl", website: null, websiteStatusHint: "no_website", source: "mock", sourceUrl: null, metadata: { reviewsHint: 17, ratingHint: 4.1 } },
  { externalId: "mock-ext-005", businessName: "Groothuis Hoveniers", industry: "Hoveniers", address: "Perenpad 8", postalCode: "7201 ZZ", city: "Zutphen", province: "Gelderland", country: "Nederland", phone: "+31 575 123 908", email: "tuin@groothuishoveniers.nl", website: null, websiteStatusHint: "no_website", source: "mock", sourceUrl: null, metadata: { reviewsHint: 35, ratingHint: 4.7 } },
  { externalId: "mock-ext-006", businessName: "Riemsdijk Bouw", industry: "Bouwbedrijven", address: "Bouwmeer 27", postalCode: "9401 XX", city: "Assen", province: "Drenthe", country: "Nederland", phone: "+31 592 345 678", email: "bouw@riemsdijk.nl", website: null, websiteStatusHint: "no_website", source: "mock", sourceUrl: null, metadata: { reviewsHint: 52, ratingHint: 4.3 } },
  { externalId: "mock-ext-007", businessName: "Bakhuis Timmerwerken", industry: "Bouwbedrijven", address: "Zaagmolenstraat 3", postalCode: "6821 GH", city: "Arnhem", province: "Gelderland", country: "Nederland", phone: "+31 26 777 8899", email: "info@bakhuitimmerwerken.nl", website: null, websiteStatusHint: "no_website", source: "mock", sourceUrl: null, metadata: { reviewsHint: 22, ratingHint: 4.5 } },

  // --- met website (hint: onbewerkt → definitieve status wordt niet gegokt) ---
  { externalId: "mock-ext-010", businessName: "Sterren Auto's", industry: "Autogarages", address: "Motordreef 14", postalCode: "4811 KL", city: "Breda", province: "Noord-Brabant", country: "Nederland", phone: "+31 76 888 9900", email: "service@sterrenautos.nl", website: "https://www.sterrenautos.nl", websiteStatusHint: "has_website", source: "mock", sourceUrl: "https://www.sterrenautos.nl", metadata: { reviewsHint: 88, ratingHint: 4.2 } },
  { externalId: "mock-ext-011", businessName: "Duyn Bakkerij", industry: "Bakkers", address: "Gortstraat 21", postalCode: "2511 VP", city: "Den Haag", province: "Zuid-Holland", country: "Nederland", phone: "+31 70 111 2233", email: "bakker@duynbakkerij.nl", website: "https://www.duynbakkerij.nl", websiteStatusHint: "has_website", source: "mock", sourceUrl: null, metadata: { reviewsHint: 130, ratingHint: 4.8 } },
  { externalId: "mock-ext-012", businessName: "Meubelhuis Kemper", industry: "Keukenzaken", address: "Showroomweg 8", postalCode: "1812 RW", city: "Alkmaar", province: "Noord-Holland", country: "Nederland", phone: "+31 72 555 1122", email: "showroom@meubelhuiskemper.nl", website: "https://www.meubelhuiskemper.nl", websiteStatusHint: "has_website", source: "mock", sourceUrl: null, metadata: { reviewsHint: 45, ratingHint: 4.0 } },

  // --- website zonder protocol (normalisatie-test) ---
  { externalId: "mock-ext-015", businessName: "Waterland Schoonmaak", industry: "Schoonmaak", address: "Dweilstraat 5", postalCode: "1131 AA", city: "Volendam", province: "Noord-Holland", country: "Nederland", phone: "+31 299 222 110", email: "schoon@waterlandschoonmaak.nl", website: "www.waterlandschoonmaak.nl", websiteStatusHint: "has_website", source: "mock", sourceUrl: null, metadata: { reviewsHint: 19, ratingHint: 4.2 } },

  // --- website-status onbekend volgens de bron ---
  { externalId: "mock-ext-020", businessName: "Flevo Telecom", industry: "Telecom", address: "Golfslag 33", postalCode: "8231 ZZ", city: "Lelystad", province: "Flevoland", country: "Nederland", phone: "+31 320 111 222", email: null, website: "https://www.flevotelecom.nl", websiteStatusHint: "unknown", source: "mock", sourceUrl: null, metadata: { reviewsHint: 7, ratingHint: 3.9 } },

  // --- duplicaten van BESTAANDE leads (duplicate-detectie) ---
  { externalId: null, businessName: "Jansen Dakwerk BV", industry: "Dakwerken", address: "Dakpanstraat 12", postalCode: "5612 AB", city: "Eindhoven", province: "Noord-Brabant", country: "Nederland", phone: "+31 40 999 0000", email: "info@jansendakwerken.nl", website: null, websiteStatusHint: "no_website", source: "mock", sourceUrl: null, metadata: { duplicateTest: "email" } },
  { externalId: null, businessName: "Van Dijk Constructie", industry: "Bouwbedrijven", address: "Funderingsweg 102", postalCode: "5015 BX", city: "Tilburg", province: "Noord-Brabant", country: "Nederland", phone: "+31 13 999 1100", email: "vandijk@example-concurrent.nl", website: "www.vandijkbouw.nl", websiteStatusHint: "has_website", source: "mock", sourceUrl: null, metadata: { duplicateTest: "website" } },
  { externalId: null, businessName: "Berg Riool- & Waterleiding", industry: "Loodgieters", address: "Leidingweg 8", postalCode: "3021 CD", city: "Rotterdam", province: "Zuid-Holland", country: "Nederland", phone: "+31 10 234 5678", email: "berghydrauliek@example-concurrent.nl", website: null, websiteStatusHint: "no_website", source: "mock", sourceUrl: null, metadata: { duplicateTest: "phone" } },
  { externalId: null, businessName: "Jansen  Dakwerken", industry: "Dakwerken", address: "Kerkstraat 1", postalCode: "5611 XX", city: "Eindhoven", province: "Noord-Brabant", country: "Nederland", phone: "+31 40 555 0000", email: "alternatief-jansen@example-concurrent.nl", website: null, websiteStatusHint: "no_website", source: "mock", sourceUrl: null, metadata: { duplicateTest: "business_city" } },

  // --- duplicaat BINNEN de batch (zelfde external id) ---
  { externalId: "mock-ext-030", businessName: "Noord Installaties", industry: "Installatietechniek", address: "Warmteweg 12", postalCode: "9711 GC", city: "Groningen", province: "Groningen", country: "Nederland", phone: "+31 50 311 0099", email: "info@noordinstallaties.nl", website: null, websiteStatusHint: "no_website", source: "mock", sourceUrl: null, metadata: { duplicateTest: "batch_external_id" } },
  { externalId: "mock-ext-030", businessName: "Noord Installatiewerken", industry: "Installatietechniek", address: "Warmteweg 12A", postalCode: "9711 GC", city: "Groningen", province: "Groningen", country: "Nederland", phone: "+31 50 311 4455", email: "werk@noordinstallaties.nl", website: null, websiteStatusHint: "no_website", source: "mock", sourceUrl: null, metadata: { duplicateTest: "batch_external_id" } },

  // --- ongeldige kandidaten (validatie-tests) ---
  { externalId: "mock-ext-040", businessName: "", industry: "Schoonmaak", address: null, postalCode: null, city: "Delft", province: "Zuid-Holland", country: "Nederland", phone: null, email: null, website: null, websiteStatusHint: null, source: "mock", sourceUrl: null, metadata: { invalidTest: "empty_name" } },
  { externalId: "mock-ext-041", businessName: "Kapotte Url Klusbedrijf", industry: "Bouwbedrijven", address: null, postalCode: null, city: "Zeist", province: "Utrecht", country: "Nederland", phone: null, email: null, website: "geen geldige url", websiteStatusHint: "has_website", source: "mock", sourceUrl: null, metadata: { invalidTest: "invalid_website" } },

  // --- extra branches/steden voor volume ---
  { externalId: "mock-ext-050", businessName: "Wadden Zeilservice", industry: "Recreatie", address: "Havenkade 3", postalCode: "8861 XX", city: "Harlingen", province: "Friesland", country: "Nederland", phone: "+31 517 222 333", email: "info@waddenzeilservice.nl", website: null, websiteStatusHint: "no_website", source: "mock", sourceUrl: null, metadata: { reviewsHint: 12, ratingHint: 4.9 } },
  { externalId: "mock-ext-051", businessName: "Kuipers Fietsenmaker", industry: "Fietsenmakers", address: "Trapgat 9", postalCode: "7001 BR", city: "Doetinchem", province: "Gelderland", country: "Nederland", phone: "+31 314 999 888", email: null, website: null, websiteStatusHint: "no_website", source: "mock", sourceUrl: null, metadata: { reviewsHint: 26, ratingHint: 4.5 } },
  { externalId: "mock-ext-052", businessName: "Lindt Optiek", industry: "Opticiens", address: "Lensweg 7", postalCode: "6211 AK", city: "Maastricht", province: "Limburg", country: "Nederland", phone: "+31 43 888 7766", email: "optiek@lindt.nl", website: "https://www.lindtoptiek.nl", websiteStatusHint: "has_website", source: "mock", sourceUrl: null, metadata: { reviewsHint: 58, ratingHint: 4.6 } },
  { externalId: "mock-ext-053", businessName: "Haven Koffiebranders", industry: "Horeca", address: "Kade 88", postalCode: "3011 BB", city: "Rotterdam", province: "Zuid-Holland", country: "Nederland", phone: "+31 10 555 4433", email: "hallo@havenkoffie.nl", website: null, websiteStatusHint: "no_website", source: "mock", sourceUrl: null, metadata: { reviewsHint: 94, ratingHint: 4.7 } },
];

const COUNTRY_ALIASES: Record<string, string> = {
  nl: "nederland",
  nederland: "nederland",
  netherlands: "nederland",
};

function countryKey(value: string): string {
  const lower = value.trim().toLowerCase();
  return COUNTRY_ALIASES[lower] ?? lower;
}

function matches(candidate: DiscoveryCandidate, request: DiscoveryRequest): boolean {
  const q = request.query?.trim().toLowerCase();
  if (request.province && candidate.province.toLowerCase() !== request.province.toLowerCase()) return false;
  if (request.city && candidate.city.toLowerCase() !== request.city.toLowerCase()) return false;
  if (request.industry && candidate.industry.toLowerCase() !== request.industry.toLowerCase()) return false;
  if (request.country && countryKey(candidate.country) !== countryKey(request.country)) return false;
  if (
    q &&
    !`${candidate.businessName} ${candidate.industry} ${candidate.city}`
      .toLowerCase()
      .includes(q)
  ) {
    return false;
  }
  return true;
}

export class MockDiscoveryProvider implements LeadDiscoveryProvider {
  readonly id = "mock";
  readonly name = "Mock discovery provider (fictieve testbedrijven)";
  readonly live = false;

  async search(request: DiscoveryRequest): Promise<DiscoveryCandidate[]> {
    return CANDIDATES.filter((candidate) => matches(candidate, request)).slice(
      0,
      Math.max(1, request.limit)
    );
  }
}
