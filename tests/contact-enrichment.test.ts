import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideAcceptance,
  DIRECTORY_PLATFORM_DOMAINS,
  evaluateDocument,
  extractEmails,
  isDirectoryPlatformEmail,
  isPlatformSourceUrl,
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
import { attemptContactEnrichment, enrichCreatedLeads, websiteUpdateAfterEnrichment } from "../lib/discovery/contact-enrichment/service";
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
  return { email: null, sourceUrl: null, rule: null, websiteUrl: null, reason: "geen adres voldoet aan de verificatieregels", queries: [], pagesFetched: 0 };
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

test("own_page_slug (aangescherpt): social-profiel vraagt een kruiscontrole — naam in URL alléén is niet voldoende", () => {
  // Zonder enige kruiscontrole (geen telefoon, geen plaats, freemail): AFWIJZEN.
  const bare = evaluateDocument(target, {
    url: "https://www.facebook.com/twanjanssenschilderwerken/about",
    text: "Twan Janssen Schilderwerken. Mail ons: schilderwerktwan@gmail.com",
  });
  const bareDecision = decideAcceptance(target, "schilderwerktwan@gmail.com", bare);
  assert.equal(bareDecision.accepted, false, "vergelijkbare naam op social zonder kruiscontrole is niet voldoende");

  // Met de vestigingsplaats als anker op het officiële profiel: ACCEPTEREN.
  const withCity = evaluateDocument(target, {
    url: "https://www.facebook.com/twanjanssenschilderwerken/about",
    text: "Twan Janssen Schilderwerken, Eindhoven. Mail ons: schilderwerktwan@gmail.com",
  });
  const withCityDecision = decideAcceptance(target, "schilderwerktwan@gmail.com", withCity);
  assert.equal(withCityDecision.accepted, true);
  assert.equal(withCityDecision.rule, "own_page_slug");
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
      websiteUrl: null,
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

// ─── PLATFORM-BRON & GEMASKEERDE ADRESSEN (2026-10-06, audit-breed) ──────
// Een profielpagina op een platform (data-broker, gids) is nooit de eigen
// pagina van het bedrijf; gemaskeerde adressen zijn geen letterlijke adressen.

test("G — own_page_slug geldt niet op een platform-profielpagina (rocketreach)", () => {
  const holwerda: EnrichmentTarget = {
    businessName: "Holwerda",
    city: "Oosterbeek",
    phone: "+31 6 48926199",
  };
  const evidence = evaluateDocument(holwerda, {
    url: "https://rocketreach.co/amber-holwerda-email_2796533",
    text: "Amber Holwerda — e-mail: a***@cava.com, telefoon 06 48926199.",
  });
  assert.equal(evidence.length, 0, "gemaskeerd adres is al geen kandidaat");
  const decision = decideAcceptance(holwerda, "amber@cava.com", evidence);
  assert.equal(decision.accepted, false, "platform-profiel is geen eigen pagina");
});

test("H — platform-profiel met naam + lead-telefoon mag als BRON (phone_cross_check) voor een echt adres", () => {
  const evidence = evaluateDocument(pitCameleon, {
    url: "https://rocketreach.co/pit-cameleon-email_991",
    text: "Pit Cameleon, Breda — schildersbedrijf. Telefoon 06 27654956. Zakelijk: info@pitcameleon.nl.",
  });
  const decision = decideAcceptance(pitCameleon, "info@pitcameleon.nl", evidence);
  assert.equal(decision.accepted, true);
  assert.equal(decision.rule, "phone_cross_check");
});

test("gemaskeerde adressen (a***@domein) worden nooit als kandidaat gezien", () => {
  const evidence = evaluateDocument(pitCameleon, {
    url: "https://www.bedrijfslijst.nl/pit-cameleon",
    text: "Pit Cameleon, Breda, tel. 06 27654956. E-mail: p**@pitcameleon.nl.",
  });
  assert.equal(evidence.length, 0);
});

test("isPlatformSourceUrl herkent platformdomeinen (inclusief subdomeinloze bron-URL's)", () => {
  assert.equal(isPlatformSourceUrl("https://rocketreach.co/amber-holwerda-email_2796533"), true);
  assert.equal(isPlatformSourceUrl("https://www.oozo.nl/bedrijf/12345"), true);
  assert.equal(isPlatformSourceUrl("https://www.facebook.com/pitcameleon"), false, "social mag een eigen pagina zijn");
  assert.equal(isPlatformSourceUrl("https://www.pitcameleon.nl/contact"), false);
});

// ─── OWN_PAGE_SLUG AANSCHERPING (2026-10-06, goedgekeurd door Silvijn) ────
// Doel: liever 70 goede leads dan 100 met false positives. De bron moet
// daadwerkelijk aan het gevonden bedrijf gekoppeld kunnen worden; een
// overeenkomstige bedrijfsnaam in een URL is op zichzelf nooit voldoende.

const vandijk: EnrichmentTarget = {
  businessName: "Schildersbedrijf A.C van Dijk",
  city: "Apeldoorn",
  phone: "06 49784322",
};

test("A — magazine-/tagpagina met overeenkomende naam in de URL: REJECT", () => {
  // Vals positief uit de marathon van 6 oktober: focus@focusmagazine.nl werd
  // geaccepteerd via een tagpagina op het magazine-domein.
  const laurens: EnrichmentTarget = {
    businessName: "Laurens van Houten",
    city: "Leiden",
    phone: "06 15227213",
  };
  const evidence = evaluateDocument(laurens, {
    url: "https://focusmagazine.nl/tag/laurens-van-houten/",
    text: "Artikelen over Laurens van Houten, schilder uit Leiden. Mail de redactie: focus@focusmagazine.nl",
  });
  const decision = decideAcceptance(laurens, "focus@focusmagazine.nl", evidence);
  assert.equal(decision.accepted, false, "een magazine-tagpagina is nooit de eigen pagina van het bedrijf");
  assert.equal(decision.rule, null);
});

test("B — website van een concurrent (telefoon mismatch, generieke naam): REJECT", () => {
  // Vals positief: lead \"Tuinonderhoud\" kreeg info@catalpatuinen.nl via een
  // servicepagina (tuinonderhoud-breda) van een ander bedrijf.
  const tuinonderhoud: EnrichmentTarget = {
    businessName: "Tuinonderhoud",
    city: "Breda",
    phone: "06 28611933",
  };
  const evidence = evaluateDocument(tuinonderhoud, {
    url: "https://www.catalpatuinen.nl/tuinonderhoud-breda",
    text: "Tuinonderhoud Breda door Catalpa Tuinen. Tuinonderhoud in Breda en omgeving. Bel 0168-473939 of mail info@catalpatuinen.nl.",
  });
  const decision = decideAcceptance(tuinonderhoud, "info@catalpatuinen.nl", evidence);
  assert.equal(decision.accepted, false, "servicepagina van een ander bedrijf is geen eigen website");
  assert.equal(decision.rule, null);
});

test("B2 — eigen-domein e-mail op een oneigen website (telefoon mismatch): REJECT", () => {
  const hovenierGouda: EnrichmentTarget = {
    businessName: "Hovenier Gouda",
    city: "Gouda",
    phone: "0182 570 183",
  };
  const evidence = evaluateDocument(hovenierGouda, {
    url: "https://www.mstuintechniek.nl/hovenier-gouda/",
    text: "Hovenier Gouda gezocht? MS Tuintechniek verzorgt hovenierwerk in Gouda. Bel 06 10103820, mail info@mstuintechniek.nl.",
  });
  const decision = decideAcceptance(hovenierGouda, "info@mstuintechniek.nl", evidence);
  assert.equal(decision.accepted, false, "het e-maildomein hoort niet bij het kenmerkende deel van de leadnaam");
  assert.equal(decision.rule, null);
});

test("C — buitenlands bedrijf met dezelfde naam (vreemde ccTLD): REJECT", () => {
  // Vals positief: lead \"Beautiful Garden\" (Oosterhout) kreeg een Canadees adres.
  const garden: EnrichmentTarget = {
    businessName: "Beautiful Garden",
    city: "Oosterhout",
    phone: "06 54938947",
  };
  const evidence = evaluateDocument(garden, {
    url: "https://mybeautifulgarden.ca/",
    text: "Beautiful Garden — landscaping services. Contact: kevin@mybeautifulgarden.ca.",
  });
  const decision = decideAcceptance(garden, "kevin@mybeautifulgarden.ca", evidence);
  assert.equal(decision.accepted, false, "een .ca-domein voor een NL-lead vraagt een telefoon-kruischeck");
  assert.equal(decision.rule, null);
});

test("D — klusplatform-/directory-profiel is nooit een eigen pagina: REJECT", () => {
  // Vals positief: info@peterdeschilder.nl via een klusgo-platformprofiel.
  const peter: EnrichmentTarget = {
    businessName: "Peter de Schilder",
    city: "Maastricht",
    phone: "06 46750832",
  };
  const evidence = evaluateDocument(peter, {
    url: "https://klusgo.nl/peter-de-schilder",
    text: "Peter de Schilder — schildersbedrijf uit Maastricht. Zakelijk: info@peterdeschilder.nl.",
  });
  const decision = decideAcceptance(peter, "info@peterdeschilder.nl", evidence);
  assert.equal(decision.accepted, false, "own_page_slug geldt niet op een klusplatform-profiel");
  assert.equal(decision.rule, null);
});

test("E — officieel Facebook-bedrijfsprofiel + écht bedrijfs-e-maildres: ACCEPT", () => {
  // Het échte goede geval uit de marathon: eigen Facebook-pagina met
  // info@acvandijk.nl (e-maildomein hoort bij de bedrijfsnaam).
  const evidence = evaluateDocument(vandijk, {
    url: "https://www.facebook.com/p/Schildersbedrijf-AC-van-Dijk-100093495331513/",
    text: "Schildersbedrijf A.C van Dijk. Vraag een offerte via info@acvandijk.nl.",
  });
  const decision = decideAcceptance(vandijk, "info@acvandijk.nl", evidence);
  assert.equal(decision.accepted, true, "officieel profiel + bij de bedrijfsnaam horend e-maildomein");
  assert.equal(decision.rule, "own_page_slug");
});

test("F — officiële bedrijfswebsite + overeenkomende bedrijfsgegevens + eigen adres: ACCEPT", () => {
  const evidence = evaluateDocument(vandijk, {
    url: "https://www.acvandijk.nl/contact",
    text: "Schildersbedrijf A.C van Dijk — Apeldoorn. Telefoon 06 49784322. E-mail: info@acvandijk.nl.",
  });
  const decision = decideAcceptance(vandijk, "info@acvandijk.nl", evidence);
  assert.equal(decision.accepted, true, "eigen website + naam + plaats/telefoon + eigen e-maildomein");
  assert.equal(decision.rule, "own_page_slug");
});

test("G — directory als BRON met naam + lead-telefoon en écht bedrijfsadres: ACCEPT via phone_cross_check", () => {
  // Bestaande regels blijven gelden: een gids mag brondocument zijn zolang
  // het adres zelf níet op het gidsdomein staat.
  const evidence = evaluateDocument(vandijk, {
    url: "https://www.oozo.nl/bedrijf/ac-van-dijk",
    text: "Schildersbedrijf A.C van Dijk, Apeldoorn — tel. 06 49784322. Zakelijk e-mailadres: info@acvandijk.nl.",
  });
  const decision = decideAcceptance(vandijk, "info@acvandijk.nl", evidence);
  assert.equal(decision.accepted, true, "directory als bron mag; het adres is van het bedrijf zelf");
  assert.equal(decision.rule, "phone_cross_check");
});

test("H — e-mailadres op een directory-/platformdomein: REJECT (hard rule)", () => {
  const evidence = evaluateDocument(vandijk, {
    url: "https://www.oozo.nl/bedrijf/ac-van-dijk",
    text: "Schildersbedrijf A.C van Dijk, Apeldoorn — tel. 06 49784322. Contact: info@oozo.nl.",
  });
  const decision = decideAcceptance(vandijk, "info@oozo.nl", evidence);
  assert.equal(decision.accepted, false, "een platform-postvak is nooit het bedrijfsadres");
  assert.match(decision.reason, /directory/i);
});

test("REGRESSIE — klusgo.nl staat op de platformlijst (e-mail én bron)", () => {
  assert.equal(isDirectoryPlatformEmail("info@klusgo.nl"), true);
  assert.equal(isPlatformSourceUrl("https://klusgo.nl/peter-de-schilder"), true);
});

test("REGRESSIE — generieke namen (alleen branche-termen/plaats) vragen altijd een telefoon-kruischeck", () => {
  // "Schildersbedrijf Amstelveen" (branche + plaats) op een ander bedrijfsdomein
  // met de plaats vermeld: nog steeds REJECT zonder telefoon.
  const amstelveen: EnrichmentTarget = {
    businessName: "Schildersbedrijf Amstelveen",
    city: "Amstelveen",
    phone: "06 26218182",
  };
  const evidence = evaluateDocument(amstelveen, {
    url: "https://www.deema-schildersbedrijf.nl/schildersbedrijf-amstelveen/",
    text: "Schildersbedrijf Amstelveen nodig? Deema Schildersbedrijf werkt in Amstelveen. Bel 06 42672865 of mail info@deema-schildersbedrijf.nl.",
  });
  const decision = decideAcceptance(amstelveen, "info@deema-schildersbedrijf.nl", evidence);
  assert.equal(decision.accepted, false, "branche+plaats-namen zijn te generiek voor een domein-overeenkomst");
  assert.equal(decision.rule, null);
});

test("REGRESSIE — achternaam + eigen-domein adres zonder telefoon/plaats-anker op de pagina: REJECT", () => {
  // Holwerda-patroon (2026-10-06): holwerda.pro liet hessel@holwerda.pro zien,
  // maar de pagina noemde een andere telefoon en niet de vestigingsplaats.
  const holwerda: EnrichmentTarget = {
    businessName: "Holwerda",
    city: "Oosterbeek",
    phone: "06 48926199",
  };
  const evidence = evaluateDocument(holwerda, {
    url: "https://www.holwerda.pro/contact/",
    text: "Holwerda Safety Solutions — contact. e-mail: hessel@holwerda.pro. Telefonisch: 06-40962926.",
  });
  const decision = decideAcceptance(holwerda, "hessel@holwerda.pro", evidence);
  assert.equal(decision.accepted, false, "naam-overeenkomst alleen (zonder telefoon/plaats-anker) is niet voldoende");
  assert.equal(decision.rule, null);
});

test("REGRESSIE — buitenlandse ccTLD mét telefoon-kruischeck kan nog steeds slagen", () => {
  const garden: EnrichmentTarget = {
    businessName: "Beautiful Garden",
    city: "Oosterhout",
    phone: "06 54938947",
  };
  const evidence = evaluateDocument(garden, {
    url: "https://www.facebook.com/beautifulgarden",
    text: "Beautiful Garden — Oosterhout. Bel 06 54938947 of mail kevin@mybeautifulgarden.ca.",
  });
  const decision = decideAcceptance(garden, "kevin@mybeautifulgarden.ca", evidence);
  assert.equal(decision.accepted, true, "met de lead-telefoon op het officiële profiel is het adres geverifieerd");
  assert.equal(decision.rule, "own_page_slug");
});

// ===== Website-markering bij verrijking (Silvijn-goedkeuring 2026-10-06, optie 1) =====

test("WEBSITE 1 — aantoonbaar eigen live website → status has_website + redesign-notitie", async () => {
  const lead = await createTestLead({ businessName: "Verrijking Eigen Site B.V." });
  try {
    const provider = stubProvider({
      email: "info@verrijkingeigensite.nl",
      sourceUrl: "https://www.verrijkingeigensite.nl/contact",
      rule: "own_page_slug",
      websiteUrl: "https://www.verrijkingeigensite.nl/contact",
      reason: "",
      queries: [],
      pagesFetched: 1,
    });
    const attempt = await attemptContactEnrichment(lead, { provider });
    assert.equal(attempt.outcome, "email_found");
    const updated = await getLeadRepository().get(lead.id);
    assert.ok(updated);
    assert.equal(updated.websiteStatus, "has_website", "eigen website markeert de lead als 'website aanwezig'");
    assert.ok(updated.notes.some((n) => n.includes("mogelijke redesign/professionalisering")), "notitie noemt de redesign-hoek");
    assert.ok(updated.notes.some((n) => n.includes("eigen website aanwezig")), "notitie documenteert de statuswijziging");
    // Regel 2: de lead blijft outreach-eligible
    assert.equal(
      isEligibleForInitialOutreach(
        { leadStatus: updated.leadStatus, outreachStatus: updated.outreachStatus, email: updated.email },
        false,
        false
      ),
      true
    );
  } finally {
    await cleanupLead(lead.id);
  }
});

test("WEBSITE 2 — alleen social-profiel (site onder constructie/niet gezien) → status ongewijzigd", async () => {
  const lead = await createTestLead({ businessName: "Verrijking Social Only" });
  try {
    const provider = stubProvider({
      email: "verrijkingsocial@gmail.com",
      sourceUrl: "https://www.facebook.com/verrijking-social-only/about",
      rule: "own_page_slug",
      websiteUrl: null,
      reason: "",
      queries: [],
      pagesFetched: 1,
    });
    await attemptContactEnrichment(lead, { provider });
    const updated = await getLeadRepository().get(lead.id);
    assert.ok(updated);
    assert.equal(updated.websiteStatus, "no_website", "zonder bewezen eigen site blijft de status 'geen website'");
    assert.ok(!updated.notes.some((n) => n.includes("redesign")), "geen redesign-notitie zonder eigen site");
  } finally {
    await cleanupLead(lead.id);
  }
});

test("WEBSITE 3 — geen e-mail gevonden → status blijft no_website", async () => {
  const lead = await createTestLead({ businessName: "Verrijking Geen Mail" });
  try {
    await attemptContactEnrichment(lead, { provider: stubProvider(noEmailResult()) });
    const updated = await getLeadRepository().get(lead.id);
    assert.ok(updated);
    assert.equal(updated.email, null);
    assert.equal(updated.websiteStatus, "no_website", "zonder vondst verandert de website-status nooit");
  } finally {
    await cleanupLead(lead.id);
  }
});

test("WEBSITE 4 — directory-/platformpagina als bron → géén website-markering", () => {
  // Pius Floris-patroon: geaccepteerd via phone_cross_check op een gids-pagina.
  const pf: EnrichmentTarget = {
    businessName: "Pius Floris Boomverzorging Amsterdam",
    city: "Amsterdam",
    phone: "020 301 3015",
  };
  const evidence = evaluateDocument(pf, {
    url: "https://goudengids.nl/nl/bedrijf/Amsterdam/L118187280/Pius+Floris+Boomverzorging",
    text: "Pius Floris Boomverzorging Amsterdam. Telefoon: 020 301 3015. E-mail: amsterdam@piusfloris.nl",
  });
  const decision = decideAcceptance(pf, "amsterdam@piusfloris.nl", evidence);
  assert.equal(decision.accepted, true);
  assert.equal(decision.rule, "phone_cross_check");
  assert.equal(decision.websiteUrl ?? null, null, "een directory-bron markeert nooit een eigen website");
});

test("WEBSITE 5 — onbevestigde/verkeerde website (mail-subdomein, e-maildomein != paginadomein) → géén markering en geen acceptatie via eigen site", () => {
  // Meulenberg-patroon: mail.schildersbedrijfmeulenberg.nl is niet het
  // e-maildomein — een subdomein-pagina is geen bewijs van de eigen site.
  const meulenberg: EnrichmentTarget = {
    businessName: "Schildersbedrijf Meulenberg",
    city: "Heerlen",
    phone: "06 51492877",
  };
  const evidence = evaluateDocument(meulenberg, {
    url: "http://mail.schildersbedrijfmeulenberg.nl/contact.html",
    text: "Schildersbedrijf Meulenberg, 6414 BS Heerlen, 06-51492877. E-mail: info@schildersbedrijfmeulenberg.nl",
  });
  const decision = decideAcceptance(meulenberg, "info@schildersbedrijfmeulenberg.nl", evidence);
  // De mail.-pagina kan route B niet dragen: e-maildomein != paginadomein.
  if (decision.accepted) {
    assert.notEqual(decision.reason, "eigen bedrijfswebsite: mail.schildersbedrijfmeulenberg.nl");
    assert.equal(decision.websiteUrl ?? null, null, "onbevestigde pagina's worden nooit als eigen website gemarkeerd");
  } else {
    assert.equal(decision.websiteUrl ?? null, null);
  }
  // En de pure helper markeert alleen bij een bewezen URL
  assert.equal(websiteUpdateAfterEnrichment({ websiteStatus: "no_website" }, null), null);
  assert.equal(websiteUpdateAfterEnrichment({ websiteStatus: "has_website" }, "https://example.nl"), null, "bestaande status wordt niet opnieuw gemarkeerd");
});
