import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideAcceptance,
  DIRECTORY_PLATFORM_DOMAINS,
  evaluateDocument,
  extractEmails,
  isDirectoryPlatformEmail,
  isRejectedLocalPart,
  rankAcceptedCandidates,
  type AcceptanceRule,
  type EnrichmentTarget,
  type SourceDocument,
} from "../lib/leads/contact-enrichment";
import {
  braveResponseToDocuments,
  buildQueries,
  isContactEnrichmentConfigured,
  type ContactEnrichmentProvider,
  type EmailSearchResult,
} from "../lib/discovery/contact-enrichment/provider";
import { attemptContactEnrichment, enrichCreatedLeads } from "../lib/discovery/contact-enrichment/service";
import { getLeadRepository, type LeadCreateInput } from "../lib/repositories/lead-repository";
import { contactChannelFor, needsManualContact } from "../lib/outreach/contactability";
import { isEligibleForInitialOutreach } from "../lib/outreach/orchestrator";
import { OutreachService, OutreachContactError } from "../lib/outreach/service";
import type { Lead } from "../lib/types";

/**
 * Contactverrijking (2026-10-01). Veilige testdata uitsluitend — geen
 * Supabase, geen netwerk, geen echte Google API. De provider is een stub;
 * de verificatieregels zijn puur.
 */

// VEILIGHEID: alleen de mock-omgeving; productie-DB nooit raken. De
// testcontext-configcheck weigert sowieso externe API's (NODE_TEST_CONTEXT).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
delete process.env.BRAVE_SEARCH_API_KEY;

function noEmailResult(): EmailSearchResult {
  return { email: null, sourceUrl: null, rule: null, reason: "geen adres voldoet aan de verificatieregels", queries: [], pagesFetched: 0 };
}

function stubProvider(result: EmailSearchResult): ContactEnrichmentProvider {
  return {
    id: "test-stub",
    live: false,
    attempt: async () => result,
  };
}

const target: EnrichmentTarget = {
  businessName: "Twan Janssen Schilderwerken",
  city: "Eindhoven",
  phone: "+31 40 123 4567",
};

async function createTestLead(input: Partial<LeadCreateInput> = {}): Promise<Lead> {
  const repository = getLeadRepository();
  const lead = await repository.create({
    businessName: "Verrijking Testbedrijf Eindhoven",
    industry: "Schilders",
    city: "Eindhoven",
    province: "Noord-Brabant",
    country: "NL",
    phone: "+31 40 123 4567",
    email: null,
    website: null,
    websiteStatus: "no_website",
    source: "google",
    notes: [],
    ...input,
  });
  return lead;
}

async function cleanupLead(leadId: string): Promise<void> {
  const { leads } = await import("../lib/mock-data");
  const index = leads.findIndex((l) => l.id === leadId);
  if (index >= 0) leads.splice(index, 1);
}

test("extractEmails vindt alleen adressen die letterlijk in de tekst staan — er wordt nooit iets verzonnen", () => {
  assert.deepEqual(extractEmails("Bel ons via info@twanjanssen.nl of 040-1234567"), ["info@twanjanssen.nl"]);
  assert.deepEqual(extractEmails("geen adressen hier, alleen telefoon 040 123 4567"), []);
  assert.deepEqual(extractEmails("Mail a@b.nl en nog eens A@B.NL (klein, uniek)"), ["a@b.nl"]);
});

test("wegwerp- en generieke accounts worden altijd geweigerd", () => {
  assert.equal(isRejectedLocalPart("noreply@voorbeeld.nl"), true);
  assert.equal(isRejectedLocalPart("webmaster@example.com"), true);
  assert.equal(isRejectedLocalPart("privacy@example.com"), true);
  assert.equal(isRejectedLocalPart("info@voorbeeld.nl"), false, "info@ is legitiem zakelijk");
});

test("TEST 3 — ongeldig/onzeker e-mailadres wordt niet gebruikt", () => {
  // (a) adres op een pagina zonder bedrijfsnaam of telefoon: te onzeker
  const unrelated = evaluateDocument(target, {
    url: "https://grotegids.nl/bedrijven-eindhoven",
    text: "Schildersbedrijven in Eindhoven: kijk op de site van de gids. Mail info@grotegids.nl voor vermeldingen.",
  });
  const unrelatedDecision = decideAcceptance(
    target,
    "info@grotegids.nl",
    unrelated
  );
  assert.equal(unrelatedDecision.accepted, false, "adres zonder bedrijfsnaam-verband is niet bruikbaar");

  // (b) freemail-adres bij de naam, maar zonder telefoon- of tweede bron
  const unverified = evaluateDocument(target, {
    url: "https://eenvermelding.nl/schilderwerken-eindhoven",
    text: "Twan Janssen Schilderwerken uit Eindhoven. Bereikbaar via twanjaanssen@gmail.com voor offertes.",
  });
  const freemailDecision = decideAcceptance(target, "twanjaanssen@gmail.com", unverified);
  assert.equal(freemailDecision.accepted, false, "freemail zonder kruischeck blijft ongebruikt");
  assert.match(freemailDecision.reason, /voldoende zekerheid/i);

  // (c) noreply/adres van de bron zelf wordt gefilterd
  const withNoreply = evaluateDocument(target, {
    url: "https://facebook.com/twanjanssenschilderwerken",
    text: "Twan Janssen Schilderwerken, Eindhoven. noreply@facebook.com voor systeemmail.",
  });
  assert.equal(withNoreply.length, 0, "noreply-adres is weggefilterd");
});

test("telefoon-kruischeck accepteert een adres dat naast naam én lead-telefoonnummer staat", () => {
  const evidence = evaluateDocument(target, {
    url: "https://bedriegids.nl/twan-janssen",
    text: "Twan Janssen Schilderwerken — Eindhoven, tel. 040 123 4567. E-mail: info@twanjanssen.nl",
  });
  const decision = decideAcceptance(target, "info@twanjanssen.nl", evidence);
  assert.equal(decision.accepted, true);
  assert.equal(decision.rule, "phone_cross_check");
});

test("eigen pagina (URL bevat de bedrijfsnaam) accepteert het daar vermelde adres", () => {
  const evidence = evaluateDocument(target, {
    url: "https://www.facebook.com/twanjanssenschilderwerken/about",
    text: "Twan Janssen Schilderwerken. Mail ons: schilderwerktwan@gmail.com",
  });
  const decision = decideAcceptance(target, "schilderwerktwan@gmail.com", evidence);
  assert.equal(decision.accepted, true);
  assert.equal(decision.rule, "own_page_slug");
});

test("twee onafhankelijke bronnen met hetzelfde adres vormen voldoende zekerheid", () => {
  const docs: SourceDocument[] = [
    {
      url: "https://gids-a.nl/twan",
      text: "Twan Janssen Schilderwerken — e-mail: werkwijzetwan@gmail.com",
    },
    {
      url: "https://gids-b.org/schilders/eindhoven",
      text: "Twan Janssen Schilderwerken, Eindhoven. Contact: werkwijzetwan@gmail.com",
    },
  ];
  const evidence = docs.flatMap((doc) => evaluateDocument(target, doc)).filter((e) => e.email === "werkwijzetwan@gmail.com");
  const decision = decideAcceptance(target, "werkwijzetwan@gmail.com", evidence);
  assert.equal(decision.accepted, true);
  assert.equal(decision.rule, "second_source");
});

test("rangschikking: eigen domein vóór freemail, sterkste regel eerst", () => {
  const ranked = rankAcceptedCandidates([
    { email: "werkwijzetwan@gmail.com", rule: "second_source" },
    { email: "info@twanjanssen.nl", rule: "phone_cross_check" },
    { email: "hallo@twanjanssen.nl", rule: "own_page_slug" },
  ]);
  assert.equal(ranked[0].email, "hallo@twanjanssen.nl", "eigen pagina + eigen domein wint");
  assert.equal(ranked[1].email, "info@twanjanssen.nl");
  assert.equal(ranked[2].email, "werkwijzetwan@gmail.com", "freemail pas als laatste");
});

test("TEST 1 — lead met gevonden e-mail wordt outreach-eligible en de mutatie is auditeerbaar", async () => {
  const lead = await createTestLead();
  try {
    const provider = stubProvider({
      email: "info@verrijkingtest.nl",
      sourceUrl: "https://www.facebook.com/verrijkingtestbedrijf/about",
      rule: "own_page_slug",
      reason: "",
      queries: ['"Verrijking Testbedrijf" email'],
      pagesFetched: 0,
    });
    const attempt = await attemptContactEnrichment(lead, { provider });
    assert.equal(attempt.outcome, "email_found");
    assert.equal(attempt.email, "info@verrijkingtest.nl");

    const updated = await getLeadRepository().get(lead.id);
    assert.ok(updated);
    assert.equal(updated.email, "info@verrijkingtest.nl", "e-mail staat op de lead");
    assert.ok(updated.notes.some((n) => n.includes("Contactverrijking") && n.includes("info@verrijkingtest.nl") && n.includes("regel: own_page_slug")), "bron + regel staan in de notitie");

    // Outreach-eligibiliteit (groen): kanaal + orchestrator-regel
    assert.equal(contactChannelFor(updated), "email");
    assert.equal(
      isEligibleForInitialOutreach(
        { leadStatus: updated.leadStatus, outreachStatus: updated.outreachStatus, email: updated.email },
        false,
        false
      ),
      true,
      "met e-mail is de lead outreach-eligible"
    );
  } finally {
    await cleanupLead(lead.id);
  }
});

test("TEST 2 — lead zonder e-mail blijft handmatig contact; generatie wordt geweigerd met duidelijke fout", async () => {
  const lead = await createTestLead();
  try {
    const attempt = await attemptContactEnrichment(lead, { provider: stubProvider(noEmailResult()) });
    assert.equal(attempt.outcome, "no_email_found");

    const updated = await getLeadRepository().get(lead.id);
    assert.ok(updated);
    assert.equal(updated.email, null, "er is nooit een adres verzonnen");
    assert.ok(updated.notes.some((n) => n.includes("Contactverrijking") && n.includes("geen openbaar zakelijk e-mailadres")), "de poging is eerlijk vastgelegd");

    // Geel: handmatig contact, geen automatische e-mail-outreach
    assert.equal(contactChannelFor(updated), "phone_only");
    assert.equal(needsManualContact({ leadStatus: updated.leadStatus, outreachStatus: updated.outreachStatus, email: updated.email, phone: updated.phone }), true);
    assert.equal(
      isEligibleForInitialOutreach(
        { leadStatus: updated.leadStatus, outreachStatus: updated.outreachStatus, email: updated.email },
        false,
        false
      ),
      false,
      "automatische outreach slaat de lead over"
    );

    // De per-lead knop weigert netjes met een getypeerde fout vóór enige AI-kost
    await assert.rejects(
      () => new OutreachService().generateDraftForLead(lead.id),
      (error: unknown) => error instanceof OutreachContactError && error.name === "OUTREACH_REQUIRES_EMAIL" && /40 123 4567/.test(error.message)
    );
  } finally {
    await cleanupLead(lead.id);
  }
});

test("Brave-response wordt puur omgezet naar brondocumenten (geen netwerk nodig)", () => {
  const documents = braveResponseToDocuments({
    web: {
      results: [
        {
          title: "Twan Janssen Schilderwerken",
          url: "https://facebook.com/twanjanssenschilderwerken",
          description: "Schilderwerken in Eindhoven",
          extra_snippets: ["Bel 040 123 4567", "Mail info@twanjanssen.nl"],
        },
        { title: "geen url", url: null, description: "wordt overgeslagen" },
        { title: "ftp", url: "ftp://example.com", description: "fout protocol overgeslagen" },
      ],
    },
  });
  assert.equal(documents.length, 1, "alleen geldige http(s)-resultaten");
  assert.match(documents[0].url, /facebook\.com/);
  assert.match(documents[0].text, /info@twanjanssen\.nl/, "extra snippets landen in de brontekst");
  assert.deepEqual(braveResponseToDocuments({}), [], "lege response geeft geen documenten");
  assert.deepEqual(braveResponseToDocuments({ web: { results: "geen-array" } }), [], "onverwachte vorm geeft geen documenten");
});

test("zoekopdrachten zijn gericht, begrensd en bevatten nooit een e-mailconjectuur", () => {
  const queries = buildQueries(target);
  assert.equal(queries.length, 2);
  assert.ok(queries[0].includes('"Twan Janssen Schilderwerken"'), "exacte naam tussen aanhalingstekens");
  assert.ok(queries.every((q) => !q.includes("@")), "nooit zelf een adres in de query gokken");
});

test("zonder Brave-configuratie is verrijking blocked: geen mutatie, geen netwerk, eerlijke telling", async () => {
  delete process.env.BRAVE_SEARCH_API_KEY;
  assert.equal(isContactEnrichmentConfigured(), false);

  const lead = await createTestLead();
  try {
    const before = (await getLeadRepository().list()).length;
    const summary = await enrichCreatedLeads([lead]);
    assert.equal(summary.blocked, 1);
    assert.equal(summary.attempted, 0);
    assert.equal(summary.emailFound, 0);

    const updated = await getLeadRepository().get(lead.id);
    assert.ok(updated);
    assert.equal(updated.email, null, "geen adres, geen notitie: er is alleen geteld");
    assert.equal(updated.notes.length, 0);
    assert.equal((await getLeadRepository().list()).length, before, "TEST 4 — verrijking maakt nooit leads aan of dubbel");
  } finally {
    await cleanupLead(lead.id);
  }
});

test("enrichCreatedLeads begrenst per run en telt niet-geprobeerde leads eerlijk", async () => {
  const leads: Lead[] = [];
  try {
    for (let i = 0; i < 5; i += 1) {
      leads.push(
        await createTestLead({ businessName: `Verrijking Testbedrijf ${i + 1} Eindhoven` })
      );
    }
    const summary = await enrichCreatedLeads(leads, { provider: stubProvider(noEmailResult()), max: 2 });
    assert.equal(summary.attempted, 2);
    assert.equal(summary.notAttempted, 3);
    assert.equal(summary.noEmailFound, 2);
  } finally {
    for (const lead of leads) await cleanupLead(lead.id);
  }
});

test("providerfout breekt de lead niet en verzinnt niets (provider_error-telling)", async () => {
  const lead = await createTestLead();
  try {
    const failingProvider: ContactEnrichmentProvider = {
      id: "test-stub-failing",
      live: true,
      attempt: async () => {
        throw new Error("quota overschreden");
      },
    };
    const attempt = await attemptContactEnrichment(lead, { provider: failingProvider });
    assert.equal(attempt.outcome, "provider_error");
    const updated = await getLeadRepository().get(lead.id);
    assert.ok(updated);
    assert.equal(updated.email, null);
  } finally {
    await cleanupLead(lead.id);
  }
});

test("uitrol van de rangschikking is deterministisch (zelfde input → zelfde volgorde )", () => {
  const accepted: { email: string; rule: AcceptanceRule }[] = [
    { email: "b@zz.nl", rule: "phone_cross_check" },
    { email: "a@zz.nl", rule: "phone_cross_check" },
    { email: "a@gmail.com", rule: "own_page_slug" },
  ];
  const first = rankAcceptedCandidates(accepted);
  const second = rankAcceptedCandidates([...accepted].reverse());
  assert.deepEqual(
    first.map((c) => c.email),
    second.map((c) => c.email)
  );
});


// ─── DIRECTORY-/PLATFORM-E-MAIL (2026-10-06) ─────────────────────────────
// HARD RULE: een e-mailadres op een directory-/platformdomein is nooit het
// zakelijke adres van het bedrijf, op geen enkele acceptatieroute. De gids
// mag wél als bron dienen voor verificatie van een écht bedrijfsadres.

const pitCameleon: EnrichmentTarget = {
  businessName: "Pit Cameleon",
  city: "Breda",
  phone: "+31 6 27654956",
};

test("A — OOZO-profiel met info@oozo.nl wordt ALTIJD afgewezen", () => {
  const evidence = evaluateDocument(pitCameleon, {
    url: "https://www.oozo.nl/bedrijf/pit-cameleon-breda",
    text: "Pit Cameleon — Schilders in Breda. Profiel op OOZO. Vragen over deze vermelding? Mail info@oozo.nl of bel 06 27654956.",
  });
  // Zonder de hard rule zou own_page_slug (URL bevat de bedrijfsnaam) én
  // phone_cross_check (naam + lead-telefoon op de pagina) dit accepteren.
  const decision = decideAcceptance(pitCameleon, "info@oozo.nl", evidence);
  assert.equal(decision.accepted, false);
  assert.equal(decision.rule, null);
  assert.match(decision.reason, /directory/i);
});

test("B — DeGemeenteGids-profiel met info@degemeentegids.nl wordt ALTIJD afgewezen", () => {
  const ponsteen: EnrichmentTarget = {
    businessName: "Schildersbedrijf Ponsteen",
    city: "Arnhem",
    phone: "+31 6 51910754",
  };
  const evidence = evaluateDocument(ponsteen, {
    url: "https://degemeentegids.nl/bedrijf/schildersbedrijf-ponsteen",
    text: "Schildersbedrijf Ponsteen, Arnhem. Telefoon 06 51910754. Vermeldingen via info@degemeentegids.nl.",
  });
  const decision = decideAcceptance(ponsteen, "info@degemeentegids.nl", evidence);
  assert.equal(decision.accepted, false);
  assert.equal(decision.rule, null);
  assert.match(decision.reason, /directory/i);
});

test("C — OOZO-profiel mag als BRON dienen voor een écht bedrijfsadres (telefoon-kruischeck)", () => {
  const evidence = evaluateDocument(pitCameleon, {
    url: "https://www.oozo.nl/bedrijf/84120",
    text: "Pit Cameleon, schilder in Breda. Telefoon: 06 27654956. E-mail: info@pitcameleon.nl. Adres: Havenstraat 1, 4811 KL Breda.",
  });
  const decision = decideAcceptance(pitCameleon, "info@pitcameleon.nl", evidence);
  assert.equal(decision.accepted, true);
  assert.equal(decision.rule, "phone_cross_check");
});

test("D — tweede bron bevestigt een écht bedrijfsadres: second_source blijft werken", () => {
  const docs: SourceDocument[] = [
    {
      url: "https://klusoverzicht-breda.nl/bedrijven/77341",
      text: "Pit Cameleon is een schildersbedrijf in Breda. Mail info@pitcameleon.nl voor een offerte.",
    },
    {
      url: "https://www.verfgids-noord-brabant.nl/profielen/2255",
      text: "Pit Cameleon (Breda). Contact: info@pitcameleon.nl — schilderwerk en behang.",
    },
  ];
  const evidence = docs.flatMap((doc) => evaluateDocument(pitCameleon, doc));
  const decision = decideAcceptance(pitCameleon, "info@pitcameleon.nl", evidence);
  assert.equal(decision.accepted, true);
  assert.equal(decision.rule, "second_source");
});

test("E — social-profiel met platform-e-mailadres wordt afgewezen", () => {
  const evidence = evaluateDocument(pitCameleon, {
    url: "https://www.facebook.com/pitcameleon",
    text: "Pit Cameleon op Facebook. Geschreven door onze partner OOZO. Bereik ons via info@oozo.nl of 06 27654956.",
  });
  const decision = decideAcceptance(pitCameleon, "info@oozo.nl", evidence);
  assert.equal(decision.accepted, false);
  assert.match(decision.reason, /directory/i);
});

test("F — social-profiel met écht bedrijfsadres blijft de bestaande regels volgen (own_page_slug)", () => {
  const evidence = evaluateDocument(pitCameleon, {
    url: "https://www.facebook.com/pitcameleon",
    text: "Pit Cameleon, schilders in Breda. Stuur je offerte-aanvraag naar info@pitcameleon.nl.",
  });
  const decision = decideAcceptance(pitCameleon, "info@pitcameleon.nl", evidence);
  assert.equal(decision.accepted, true);
  assert.equal(decision.rule, "own_page_slug");
});

test("isDirectoryPlatformEmail herkent alle bekende directory-/platformdomeinen", () => {
  for (const domain of DIRECTORY_PLATFORM_DOMAINS) {
    assert.equal(isDirectoryPlatformEmail(`info@${domain}`), true, domain);
    assert.equal(isDirectoryPlatformEmail(`contact@${domain}`), true, domain);
  }
  assert.equal(isDirectoryPlatformEmail("info@pitcameleon.nl"), false, "gewoon bedrijfsdomein");
  assert.equal(isDirectoryPlatformEmail("info@oozo-bedrijf.nl"), false, "gelijkend maar eigen domein");
  assert.equal(isDirectoryPlatformEmail("erik@oozo-loodgieters.nl"), false);
});

test("second_source-route: ook twee onafhankelijke bronnen met hetzelfde directory-adres worden afgewezen", () => {
  const docs: SourceDocument[] = [
    {
      url: "https://www.oozo.nl/bedrijf/pit-cameleon",
      text: "Pit Cameleon, Breda. Neem contact op via info@oozo.nl.",
    },
    {
      url: "https://klussenplatform-brabant.nl/profiel/pit-cameleon",
      text: "Pit Cameleon (Breda) — profiel aangemaakt via onze partner. E-mail info@oozo.nl voor vragen over dit profiel.",
    },
  ];
  const evidence = docs.flatMap((doc) => evaluateDocument(pitCameleon, doc));
  const decision = decideAcceptance(pitCameleon, "info@oozo.nl", evidence);
  assert.equal(decision.accepted, false, "twee bronnen of niet: een platform-postvak is nooit het bedrijfsadres");
  assert.match(decision.reason, /directory/i);
});
