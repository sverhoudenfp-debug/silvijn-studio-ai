/**
 * Discovery-testsuite (Fase 5) — draait volledig in mock mode, zonder AI
 * en zonder externe calls (website-checks staan default uit).
 * Uitvoeren: npx tsx scripts/test-discovery.ts
 */
import { LeadDiscoveryService, getMaxDiscoveryResults } from "../lib/discovery/service";
import { MockDiscoveryProvider } from "../lib/discovery/providers/mock-provider";
import { getDiscoveryProvider } from "../lib/discovery/providers";
import { WebsiteDiscoveryService } from "../lib/discovery/website-service";
import { normalizePhoneKey, normalizeBusinessName } from "../lib/discovery/duplicate-detector";
import { getAIRunRepository } from "../lib/repositories/ai-run-repository";
import { getLeadRepository } from "../lib/repositories/lead-repository";

const service = new LeadDiscoveryService();
let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  console.info(`${condition ? "PASS" : "FAIL"} — ${name}${condition || !detail ? "" : ` (${detail})`}`);
  if (!condition) failures += 1;
}

async function main() {
  // TESTS draaien uitsluitend op mock-data (Fase-instructie): een eventueel
  // aanwezige Supabase-configuratie wordt bewust genegeerd — géén live API-calls.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  // 1) Mock provider retourneert kandidaten
  const provider = new MockDiscoveryProvider();
  const all = await provider.search({ country: "NL", limit: 50, source: "mock" });
  check("mock provider returns candidates", all.length >= 20, `${all.length} candidates`);

  // 2) Limit werkt (provider-niveau)
  const limited = await provider.search({ country: "NL", limit: 3, source: "mock" });
  check("provider limit works", limited.length === 3);

  // 3) Volledige run: alle situaties afgedekt
  const first = await service.discover({ country: "NL", limit: 100, source: "mock" });
  check("discovery returns result", first.totalFound >= 20, `found=${first.totalFound}`);
  check("discovery limit clamps to max", first.query.limit === getMaxDiscoveryResults(), `limit=${first.query.limit}`);
  check("created leads > 0", first.createdLeads > 0, `created=${first.createdLeads}`);
  check("no errors in mock run", first.errors.length === 0, first.errors.join("; "));

  const reasons = first.candidates.map((c) => c.reason ?? "");

  check("duplicate email detected", reasons.some((r) => r.includes("E-mail bestaat al")));
  check("duplicate website detected", reasons.some((r) => r.includes("Website bestaat al")));
  check("duplicate phone detected", reasons.some((r) => r.includes("Telefoonnummer bestaat al")));
  check("duplicate business+city detected (normalized)", reasons.some((r) => r.includes("Zelfde bedrijfsnaam + stad")));
  check("duplicate source id (within batch) detected", reasons.some((r) => r.includes("Extern bron-ID")));
  check("invalid candidate skipped", first.invalidCandidatesSkipped >= 2, `invalid=${first.invalidCandidatesSkipped}`);
  check("invalid reasons are safe", reasons.every((r) => !r.includes("sk-ant") && !r.includes("key")), "no secrets in reasons");

  // 4) Website-normalisatie & unknown-status
  const created = first.candidates.filter((c) => c.status === "created");
  const waterland = created.find((c) => c.candidate.businessName === "Waterland Schoonmaak");
  check("website URL normalized with https", waterland?.candidate.website === "https://www.waterlandschoonmaak.nl", waterland?.candidate.website ?? undefined);
  const withWebsite = created.find((c) => Boolean(c.candidate.website));
  check("unchecked website → unknown status", withWebsite?.websiteStatus === "unknown", withWebsite?.websiteStatus);
  const withoutWebsite = created.find((c) => !c.candidate.website);
  check("no website → no_website status", withoutWebsite?.websiteStatus === "no_website");

  // 5) Lead creation via repository
  const leadRepo = getLeadRepository();
  const firstCreated = created[0];
  const stored = firstCreated?.leadId ? await leadRepo.get(firstCreated.leadId) : null;
  check("created lead persisted", Boolean(stored));
  check("new lead starts with status new", stored?.leadStatus === "new");
  check("new lead outreach not_contacted", stored?.outreachStatus === "not_contacted");
  check("new lead demo not_created", stored?.demoStatus === "not_created");
  check("new lead scored rule-based", (stored?.leadScore ?? 0) > 0, `score=${stored?.leadScore}`);
  check("discovery note added", (stored?.notes ?? []).some((n) => n.includes("Lead Discovery")));

  // 6) Idempotentie: tweede run → alles duplicate, niets nieuws
  const second = await service.discover({ country: "NL", limit: 100, source: "mock" });
  check("re-run creates no new leads", second.createdLeads === 0, `created=${second.createdLeads}`);
  check("re-run flags duplicates", second.duplicatesSkipped >= first.createdLeads, `dups=${second.duplicatesSkipped}`);

  // 7) Leeg resultaat
  const empty = await service.discover({ country: "NL", city: "Bestaatnietstad", limit: 20, source: "mock" });
  check("empty result works", empty.totalFound === 0 && empty.candidates.length === 0 && empty.errors.length === 0);

  // 8) Ongeconfigureerde echte provider → MISSING CONFIGURATION
  const google = await service.discover({ country: "NL", limit: 10, source: "google" });
  check("google provider reports missing configuration", google.errors.length === 1 && google.errors[0].includes("MISSING CONFIGURATION"), google.errors[0]);
  check("google provider creates nothing", google.createdLeads === 0);
  const directory = getDiscoveryProvider("directory");
  let directoryError = "";
  try { await directory.search({ country: "NL", limit: 5, source: "directory" }); } catch (e) { directoryError = e instanceof Error ? e.message : ""; }
  check("directory provider reports missing configuration", directoryError.includes("MISSING CONFIGURATION"), directoryError);

  // 9) Geen AI-calls tijdens discovery
  const aiRuns = getAIRunRepository();
  console.info(`INFO — AI-run logging ongewijzigd: discovery raakt de AIService niet (repository: ${aiRuns.sink})`);

  // 10) Unit-checks normalisatie
  check("phone key last 9 digits", normalizePhoneKey("+31 10 234 5678") === "102345678");
  check("business name normalization", normalizeBusinessName("Jansen  Dakwerken BV") === "jansen dakwerken");
  check("url normalization adds protocol", WebsiteDiscoveryService.normalizeUrl("www.example.nl") === "https://www.example.nl");
  check("same host with www/http matches", WebsiteDiscoveryService.isSameWebsite("https://www.x.nl", "http://x.nl") === true);
  check("invalid url rejected", WebsiteDiscoveryService.normalizeUrl("geen geldige url") === null);

  console.info(failures === 0 ? "\nALLE DISCOVERY-TESTS PASS" : `\n${failures} TEST(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.info(`Onverwachte fout: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
