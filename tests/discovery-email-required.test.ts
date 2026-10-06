import { test } from "node:test";
import assert from "node:assert/strict";
import { GoogleNoWebsiteListedDiscoveryService } from "../lib/discovery/identity/pre-kvk-service";
import { LeadDiscoveryService, getEmailRequiredCandidateCap } from "../lib/discovery/service";
import type { ContactEnrichmentProvider } from "../lib/discovery/contact-enrichment/provider";
import { getLeadRepository } from "../lib/repositories/lead-repository";
import type { DiscoveryRequest } from "../lib/discovery/types";
import type { TemporaryGoogleCandidate } from "../lib/discovery/identity/types";

// Force the test-only in-memory repositories. Never touch production data.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * Email-required discovery (2026-10-03): google-kandidaten worden pas een lead
 * als de contactverrijking (Brave + de drie bestaande verificatieregels) een
 * zakelijk adres accepteert. Alles hieronder draait tegen stubs — geen enkele
 * externe API wordt geraadpleegd.
 */

const baseRequest: DiscoveryRequest = {
  country: "NL",
  city: "Eindhoven",
  industry: "schilder",
  limit: 2,
  source: "google",
};

let nameCounter = 0;
function temp(placeId: string, businessName: string, city = "Eindhoven"): TemporaryGoogleCandidate {
  // Uniek telefoonnummer per kandidaat: de bestaande duplicaatdetector
  // herkent ook op telefoon, dus gedeelde nummers worden terecht geweerd.
  nameCounter += 1;
  const phone = `040 123 ${String(4500 + nameCounter).padStart(4, "0")}`;
  return {
    kind: "temporary_google",
    placeId,
    displayName: businessName,
    websiteUrl: null,
    websiteListingStatus: "no_website_listed",
    address: {
      postalCode: "5611 AA",
      houseNumber: "1",
      addition: null,
      street: "Teststraat",
      city,
      province: "Noord-Brabant",
      countryCode: "NL",
    },
    phone,
    rating: 4.5,
    reviewCount: 12,
  };
}

function uniqueName(): string {
  nameCounter += 1;
  return `Emailrequired Zaak ${String(nameCounter).padStart(3, "0")} Bv`;
}

function googleWith(pool: TemporaryGoogleCandidate[]): GoogleNoWebsiteListedDiscoveryService {
  return new GoogleNoWebsiteListedDiscoveryService({
    provider: {
      async searchPage() {
        return { candidates: pool, nextPageToken: null };
      },
    },
    officialWebsite: {
      async discover() {
        return { status: "not_found" as const, inspectedCandidates: 0 };
      },
    },
  });
}

interface StubProvider {
  provider: ContactEnrichmentProvider;
  calls: string[];
}

function stubProvider(
  accepted: Record<string, string>,
  options?: { throwOn?: string[] }
): StubProvider {
  const calls: string[] = [];
  return {
    calls,
    provider: {
      id: "stub-enrichment",
      live: true,
      async attempt(target) {
        calls.push(target.businessName);
        if (options?.throwOn?.includes(target.businessName)) throw new Error("providerfout in stub");
        const email = accepted[target.businessName];
        if (!email) {
          return { email: null, sourceUrl: null, rule: null, websiteUrl: null, reason: "geen openbaar zakelijk adres gevonden", queries: [], pagesFetched: 0 };
        }
        return {
          email,
          websiteUrl: null,
          sourceUrl: `https://${email.split("@")[1]}/contact`,
          rule: "second_source",
          reason: "twee onafhankelijke bronnen",
          queries: [],
          pagesFetched: 1,
        };
      },
    },
  };
}

test("getEmailRequiredCandidateCap is min(3x limit, 24) with a clamped env override", () => {
  const original = process.env.DISCOVERY_EMAIL_REQUIRED_MAX_CANDIDATES;
  try {
    delete process.env.DISCOVERY_EMAIL_REQUIRED_MAX_CANDIDATES;
    assert.equal(getEmailRequiredCandidateCap(1), 3);
    assert.equal(getEmailRequiredCandidateCap(4), 12);
    assert.equal(getEmailRequiredCandidateCap(10), 24, "3x limiet (30) wordt afgetopt op de harde 24");
    assert.equal(getEmailRequiredCandidateCap(200), 24);

    process.env.DISCOVERY_EMAIL_REQUIRED_MAX_CANDIDATES = "5";
    assert.equal(getEmailRequiredCandidateCap(10), 5, "env-override verlaagt de cap");
    assert.equal(getEmailRequiredCandidateCap(2), 5, "env-override geldt ook onder 3x limiet");

    process.env.DISCOVERY_EMAIL_REQUIRED_MAX_CANDIDATES = "100";
    assert.equal(getEmailRequiredCandidateCap(50), 24, "env boven 24 wordt hard afgetopt");
  } finally {
    if (original === undefined) delete process.env.DISCOVERY_EMAIL_REQUIRED_MAX_CANDIDATES;
    else process.env.DISCOVERY_EMAIL_REQUIRED_MAX_CANDIDATES = original;
  }
});

test("candidate without accepted email is counted and skipped, never persisted as a lead", async () => {
  const repository = getLeadRepository();
  const before = [...(await repository.list())]; // kopie: de repository geeft de live array terug
  const name = uniqueName();
  const candidate = temp("er-no-email", name);

  const stub = stubProvider({});
  const service = new LeadDiscoveryService({ google: googleWith([candidate]), contactEnrichment: stub.provider });
  const result = await service.discover({ ...baseRequest, limit: 2 }, { runId: "run-test" });

  assert.equal(result.createdLeads, 0, "geen lead zonder geverifieerd adres");
  assert.equal(result.emailRequired?.noEmailFound, 1);
  assert.equal(result.emailRequired?.candidatesResearched, 1);
  assert.equal(result.emailRequired?.leadsCreated, 0);
  assert.equal(result.emailRequired?.stopReason, "candidates_exhausted");
  assert.equal(result.emailRequired?.message, "0 van 2 e-mail-leads gevonden — kandidaatpool uitgeput");
  assert.equal(result.candidates[0]?.status, "skipped");
  assert.match(result.candidates[0]?.reason ?? "", /geen geverifieerd zakelijk e-mailadres/);
  assert.equal(stub.calls.length, 1, "de provider is wél geraadpleegd (geen raden, geen skip zonder onderzoek)");

  const after = [...(await repository.list())]; // kopie
  assert.equal(after.length, before.length, "niets toegevoegd aan de repository");
  assert.ok(!after.some((lead) => lead.businessName === name), "de kandidaat bestaat nergens als lead");
});

test("accepted email creates the lead with email, audit note (source + rule) and scoring", async () => {
  const repository = getLeadRepository();
  const name = uniqueName();
  const email = `info@zaak-${nameCounter}.example`;
  const candidate = temp("er-accepted", name);

  const stub = stubProvider({ [name]: email });
  const service = new LeadDiscoveryService({ google: googleWith([candidate]), contactEnrichment: stub.provider });
  const result = await service.discover({ ...baseRequest, limit: 1 }, { runId: "run-test" });

  assert.equal(result.createdLeads, 1);
  assert.equal(result.emailRequired?.emailsFound, 1);
  assert.equal(result.emailRequired?.leadsCreated, 1);
  assert.equal(result.emailRequired?.stopReason, "target_reached");
  assert.equal(result.emailRequired?.message, "1 van 1 e-mail-leads gevonden");
  assert.equal(result.candidates[0]?.status, "created");

  const lead = (await repository.list()).find((entry) => entry.businessName === name);
  assert.ok(lead, "lead aangemaakt");
  assert.equal(lead!.email, email);
  assert.ok((lead!.leadScore ?? 0) > 0, "bestaande scoring draaide bij creatie");
  assert.equal(lead!.leadStatus, "new");
  const noteText = (lead!.notes ?? []).join(" ");
  assert.match(noteText, /Contactverrijking/);
  assert.match(noteText, /second_source/);
  assert.match(noteText, new RegExp(email.replace(/[.@]/g, "\\$&")));
  assert.match(noteText, /https:\/\/zaak-\d+\.example\/contact/, "bron-URL in de audit-notitie");
});

test("stops at the requested number of email leads; the rest of the pool is not researched", async () => {
  const repository = getLeadRepository();
  const names = [uniqueName(), uniqueName(), uniqueName()];
  const pool = names.map((name, index) => temp(`er-cap-${index}`, name));
  const accepted = Object.fromEntries(names.map((name, index) => [name, `info@cap-${index}.example`]));

  const stub = stubProvider(accepted);
  const service = new LeadDiscoveryService({ google: googleWith(pool), contactEnrichment: stub.provider });
  const result = await service.discover({ ...baseRequest, limit: 2 }, { runId: "run-test" });

  assert.equal(result.emailRequired?.leadsCreated, 2);
  assert.equal(result.emailRequired?.targetLeads, 2);
  assert.equal(result.emailRequired?.stopReason, "target_reached");
  assert.equal(result.emailRequired?.candidatesResearched, 2, "derde kandidaat is niet meer onderzocht");
  assert.equal(stub.calls.length, 2, "geen provider-budget meer uitgegeven na het doel");
  assert.equal(result.createdLeads, 2);

  const after = [...(await repository.list())]; // kopie
  assert.ok(!after.some((lead) => lead.businessName === names[2]), "derde kandidaat is geen lead");
});

test("duplicates are skipped before the enrichment provider is consulted; existing leads stay untouched", async () => {
  const repository = getLeadRepository();
  const name = uniqueName();
  const candidate = temp("er-duplicate", name);

  const first = stubProvider({ [name]: "info@dupli.example" });
  const service = new LeadDiscoveryService({ google: googleWith([candidate]), contactEnrichment: first.provider });
  const firstResult = await service.discover({ ...baseRequest, limit: 1 }, { runId: "run-test" });
  assert.equal(firstResult.createdLeads, 1);

  const created = (await repository.list()).find((lead) => lead.businessName === name);
  assert.ok(created);

  const second = stubProvider({ [name]: "info@dupli.example" });
  const rerun = new LeadDiscoveryService({ google: googleWith([candidate]), contactEnrichment: second.provider });
  const secondResult = await rerun.discover({ ...baseRequest, limit: 1 }, { runId: "run-test" });

  assert.equal(secondResult.createdLeads, 0);
  assert.equal(secondResult.duplicatesSkipped, 1);
  assert.equal(secondResult.emailRequired?.candidatesResearched, 0, "duplicaat verbruikt geen verrijkingspoging");
  assert.equal(second.calls.length, 0, "provider niet geraadpleegd voor een duplicaat");

  const after = (await repository.list()).find((lead) => lead.businessName === name);
  assert.equal(after?.email, created?.email);
  assert.equal(after?.leadScore, created?.leadScore);
});

test("without a configured provider the run is honest-blocked and creates nothing", async () => {
  const repository = getLeadRepository();
  const before = [...(await repository.list())]; // kopie: de repository geeft de live array terug
  const candidate = temp("er-blocked", uniqueName());

  // Geen injectie: in de testcontext is er geen provider geconfigureerd
  // (NODE_TEST_CONTEXT) — productie zonder BRAVE_SEARCH_API_KEY gedraagt hetzelfde.
  const service = new LeadDiscoveryService({ google: googleWith([candidate]) });
  const result = await service.discover({ ...baseRequest, limit: 2 }, { runId: "run-test" });

  assert.equal(result.createdLeads, 0);
  assert.equal(result.emailRequired?.blocked, 1);
  assert.equal(result.emailRequired?.leadsCreated, 0);
  assert.equal(result.emailRequired?.stopReason, "blocked_external_configuration");
  assert.match(result.emailRequired?.message ?? "", /geblokkeerd/);
  assert.equal(result.candidates[0]?.status, "skipped");
  const after = [...(await repository.list())]; // kopie
  assert.equal(after.length, before.length, "niets aangemaakt, niets gemuteerd");
});

test("provider errors are counted, the candidate is skipped and the run continues", async () => {
  const repository = getLeadRepository();
  const brokenName = uniqueName();
  const goodName = uniqueName();
  const pool = [temp("er-error-1", brokenName), temp("er-error-2", goodName)];

  const stub = stubProvider({ [goodName]: "info@hersteld.example" }, { throwOn: [brokenName] });
  const service = new LeadDiscoveryService({ google: googleWith(pool), contactEnrichment: stub.provider });
  const result = await service.discover({ ...baseRequest, limit: 2 }, { runId: "run-test" });

  assert.equal(result.emailRequired?.errors, 1);
  assert.equal(result.emailRequired?.noEmailFound, 0);
  assert.equal(result.emailRequired?.leadsCreated, 1, "de run loopt door na een providerfout");
  assert.equal(result.createdLeads, 1);
  const statuses = result.candidates.map((entry) => entry.status);
  assert.deepEqual([...statuses].sort(), ["created", "skipped"]);
  const after = [...(await repository.list())]; // kopie
  assert.ok(!after.some((lead) => lead.businessName === brokenName), "kap kandidaat is geen lead");
  assert.ok(after.some((lead) => lead.businessName === goodName), "herstelde kandidaat is wel een lead");
});

test("mock source keeps the legacy behavior: candidates without email are still created and no emailRequired summary exists", async () => {
  const repository = getLeadRepository();
  const before = [...(await repository.list())]; // kopie: de repository geeft de live array terug

  const service = new LeadDiscoveryService();
  const result = await service.discover(
    { country: "NL", source: "mock", limit: 5 },
    { runId: "run-test" }
  );

  assert.equal(result.emailRequired, undefined, "email-required geldt uitsluitend voor de google-bron");
  assert.ok(result.createdLeads > 0, "mock-kandidaten worden nog steeds aangemaakt");
  const after = [...(await repository.list())]; // kopie
  const pietersen = after.find((lead) => lead.businessName === "Pietersen Loodgieters");
  assert.ok(pietersen, "mock-kandidaat zonder e-mail is als lead aangemaakt (legacy)");
  assert.equal(pietersen!.email, null, "er wordt nooit een e-mail verzonnen");
  assert.equal(after.length, before.length + result.createdLeads);
});

// ---------------------------------------------------------------------------
// OBSERVABILITY (2026-10-06): een falende official-websitecheck moet de exacte
// reden in de run-errors vastleggen, zonder het outcome-gedrag te veranderen.
// ---------------------------------------------------------------------------
import { OfficialWebsiteSearchError } from "../lib/discovery/official-website/anthropic-search";

test("REGRESSIE — falende official-websitecheck legt exacte reden vast in run-errors", async () => {
  const pool = [
    temp("wc-fail-1", "Schoorsteenveger Beta"),
    temp("wc-fail-2", "Schoorsteenveger Gamma"),
  ];
  const service = new GoogleNoWebsiteListedDiscoveryService({
    provider: {
      async searchPage() {
        return { candidates: pool, nextPageToken: null };
      },
    },
    officialWebsite: {
      async discover() {
        throw new OfficialWebsiteSearchError("REQUEST_FAILED", "HTTP 429 RateLimitError: rate_limit_error");
      },
    },
  });
  const result = await service.discover({ ...baseRequest, industry: "schoorsteenvegers" });
  assert.equal(result.preKvk?.officialWebsiteTechnicalErrors, 2, "beide kandidaten blijven technical_error");
  assert.equal(result.preKvk?.potentialNoWebsiteCandidates, 0, "niets stroomt door zonder bewijs");
  const checkError = result.errors.find((e) => e.startsWith("OFFICIAL_WEBSITE_CHECK_FAILED"));
  assert.ok(checkError, "foutreden staat in de run-errors");
  assert.match(checkError, /SEARCH_FAILED: REQUEST_FAILED: HTTP 429 RateLimitError/);
  assert.match(checkError, /x2/, "identieke fouten worden geteld, niet herhaald");
});

test("REGRESSIE — onbekende fout bij de websitecheck krijgt een generieke maar zichtbare reden", async () => {
  const pool = [temp("wc-fail-3", "Schoorsteenveger Delta")];
  const service = new GoogleNoWebsiteListedDiscoveryService({
    provider: {
      async searchPage() {
        return { candidates: pool, nextPageToken: null };
      },
    },
    officialWebsite: {
      async discover() {
        throw new Error("netwerk onverwacht");
      },
    },
  });
  const result = await service.discover({ ...baseRequest, industry: "schoorsteenvegers" });
  assert.equal(result.preKvk?.officialWebsiteTechnicalErrors, 1);
  const checkError = result.errors.find((e) => e.startsWith("OFFICIAL_WEBSITE_CHECK_FAILED"));
  assert.ok(checkError);
  assert.match(checkError, /SEARCH_FAILED: netwerk onverwacht/);
});
