import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type Anthropic from "@anthropic-ai/sdk";
import type { TemporaryGoogleCandidate } from "../lib/discovery/identity/types";
import { AnthropicOfficialWebsiteSearch, type WebsiteSearchSource } from "../lib/discovery/official-website/anthropic-search";
import { OfficialWebsiteDiscoveryService } from "../lib/discovery/official-website/service";
import { WebsiteDiscoveryService, type WebsiteInspectionResult } from "../lib/discovery/website-service";

function candidate(overrides?: Partial<TemporaryGoogleCandidate>): TemporaryGoogleCandidate {
  return {
    kind: "temporary_google",
    placeId: "temporary-only",
    displayName: "Jansen Schilderwerken B.V.",
    websiteUrl: null,
    websiteListingStatus: "no_website_listed",
    address: {
      street: "Kerkstraat",
      houseNumber: "12",
      addition: null,
      postalCode: "3512 AB",
      city: "Utrecht",
      countryCode: "NL",
    },
    ...overrides,
  };
}

function inspection(input?: Partial<WebsiteInspectionResult>): WebsiteInspectionResult {
  return {
    check: {
      reachable: true,
      httpStatus: 200,
      https: true,
      redirected: false,
      hasTitle: true,
      hasBasicHtml: true,
      hasViewport: true,
      hasContactHint: true,
      looksBroken: false,
    },
    finalUrl: "https://jansenschilderwerken.nl/",
    title: "Jansen Schilderwerken",
    visibleText: "Jansen Schilderwerken, Kerkstraat 12, 3512 AB Utrecht. Neem contact met ons op.",
    structuredOrganizations: [{
      name: "Jansen Schilderwerken B.V.",
      address: "Kerkstraat 12",
      city: "Utrecht",
      postalCode: "3512 AB",
      telephone: "030 1234567",
      email: "info@jansenschilderwerken.nl",
      url: "https://jansenschilderwerken.nl/",
    }],
    emails: ["info@jansenschilderwerken.nl"],
    phones: ["030 1234567"],
    ...input,
  };
}

function searchSource(urls: string[], calls: { count: number }): WebsiteSearchSource {
  return {
    async search() {
      calls.count++;
      return { urls };
    },
  };
}


test("hardened WebsiteDiscoveryService extracts bounded visible and structured organization evidence", async () => {
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Jansen Schilderwerken B.V.",
    telephone: "030 1234567",
    email: "info@jansenschilderwerken.nl",
    url: "https://jansenschilderwerken.nl/",
    address: {
      "@type": "PostalAddress",
      streetAddress: "Kerkstraat 12",
      postalCode: "3512 AB",
      addressLocality: "Utrecht",
    },
  });
  const html = `<!doctype html><html><head><title>Jansen Schilderwerken</title><meta name="viewport" content="width=device-width"><script type="application/ld+json">${jsonLd}</script></head><body><h1>Jansen Schilderwerken</h1><p>${"Vakschilder in Utrecht. ".repeat(15)}</p></body></html>`;
  const result = await WebsiteDiscoveryService.inspectWebsite("https://jansenschilderwerken.nl", 500, {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    request: async () => ({
      statusCode: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: Readable.from([html]),
    }),
  });

  assert.equal(result.check.reachable, true);
  assert.equal(result.title, "Jansen Schilderwerken");
  assert.doesNotMatch(result.visibleText, /schema\.org/);
  assert.deepEqual(result.structuredOrganizations, [{
    name: "Jansen Schilderwerken B.V.",
    address: "Kerkstraat 12",
    city: "Utrecht",
    postalCode: "3512 AB",
    telephone: "030 1234567",
    email: "info@jansenschilderwerken.nl",
    url: "https://jansenschilderwerken.nl/",
  }]);
});

test("official website is verified only from independent name and location evidence", async () => {
  const calls = { count: 0 };
  const inspected: string[] = [];
  const service = new OfficialWebsiteDiscoveryService({
    search: searchSource(["https://jansenschilderwerken.nl/contact"], calls),
    inspect: async (url) => {
      inspected.push(url);
      return inspection();
    },
  });

  const result = await service.discover(candidate());
  assert.deepEqual(result, {
    status: "official_website_verified",
    websiteUrl: "https://jansenschilderwerken.nl/",
    evidence: { name: "structured_data", location: "postal_code" },
  });
  assert.equal(calls.count, 1);
  assert.deepEqual(inspected, ["https://jansenschilderwerken.nl"]);
});

test("directory, social and marketplace results are excluded before safe inspection", async () => {
  const calls = { count: 0 };
  const inspected: string[] = [];
  const service = new OfficialWebsiteDiscoveryService({
    search: searchSource([
      "https://facebook.com/jansenschilderwerken",
      "https://telefoonboek.nl/bedrijven/jansen",
      "https://marktplaats.nl/v/diensten/jansen",
      "https://unknown-directory.nl/profile/jansen",
      "https://possible-site.nl/over-ons",
    ], calls),
    inspect: async (url) => {
      inspected.push(url);
      return inspection({
        finalUrl: url,
        title: "Andere onderneming",
        visibleText: "Geen overeenkomst met de tijdelijke kandidaat. ".repeat(10),
        structuredOrganizations: [],
      });
    },
  });

  assert.deepEqual(await service.discover(candidate()), { status: "not_found", inspectedCandidates: 1 });
  assert.deepEqual(inspected, ["https://possible-site.nl"]);
  assert.equal(calls.count, 1);
});

test("an eligible result redirecting to a social profile is excluded after safe fetch", async () => {
  const calls = { count: 0 };
  const service = new OfficialWebsiteDiscoveryService({
    search: searchSource(["https://redirector.nl"], calls),
    inspect: async () => inspection({ finalUrl: "https://facebook.com/jansenschilderwerken" }),
  });

  assert.deepEqual(await service.discover(candidate()), { status: "not_found", inspectedCandidates: 1 });
});

test("name plus city without strong address evidence remains ambiguous", async () => {
  const calls = { count: 0 };
  const service = new OfficialWebsiteDiscoveryService({
    search: searchSource(["https://jansen-schilders.nl"], calls),
    inspect: async () => inspection({
      finalUrl: "https://jansen-schilders.nl/",
      title: "Jansen Schilderwerken Utrecht",
      visibleText: "Jansen Schilderwerken helpt klanten in Utrecht. ".repeat(8),
      structuredOrganizations: [],
    }),
  });

  assert.deepEqual(await service.discover(candidate()), { status: "ambiguous", inspectedCandidates: 1 });
});

test("search results without suitable independent evidence return bounded not_found", async () => {
  const calls = { count: 0 };
  const service = new OfficialWebsiteDiscoveryService({
    search: searchSource(["https://ander-bedrijf.nl", "https://onbereikbaar.nl"], calls),
    inspect: async (url) => url.includes("onbereikbaar")
      ? inspection({
          check: { ...inspection().check, reachable: false, looksBroken: true },
          finalUrl: null,
          title: null,
          visibleText: "",
          structuredOrganizations: [],
        })
      : inspection({
          finalUrl: url,
          title: "Pietersen Bouw",
          visibleText: "Pietersen Bouw, Rotterdam. ".repeat(10),
          structuredOrganizations: [],
        }),
  });

  assert.deepEqual(await service.discover(candidate()), { status: "not_found", inspectedCandidates: 2 });
});

test("search API failure returns technical_error and performs no inspection", async () => {
  let inspections = 0;
  const service = new OfficialWebsiteDiscoveryService({
    search: { async search() { throw new Error("provider payload must not escape"); } },
    inspect: async () => {
      inspections++;
      return inspection();
    },
  });

  assert.deepEqual(await service.discover(candidate()), { status: "technical_error", reason: "SEARCH_FAILED" });
  assert.equal(inspections, 0);
});

test("one search call and at most five unique eligible hosts are inspected", async () => {
  const calls = { count: 0 };
  const inspected: string[] = [];
  const urls = Array.from({ length: 9 }, (_, index) => `https://candidate-${index + 1}.nl/page`);
  const service = new OfficialWebsiteDiscoveryService({
    search: searchSource(urls, calls),
    inspect: async (url) => {
      inspected.push(url);
      return inspection({
        finalUrl: url,
        title: "Niet Jansen",
        visibleText: "Een andere organisatie zonder relevante locatie. ".repeat(10),
        structuredOrganizations: [],
      });
    },
  });

  assert.deepEqual(await service.discover(candidate()), { status: "not_found", inspectedCandidates: 5 });
  assert.equal(calls.count, 1);
  assert.equal(inspected.length, 5);
});

test("Anthropic URL source uses exactly one Dutch localized web search and extracts typed result URLs", async () => {
  let apiCalls = 0;
  const requestBodies: Record<string, unknown>[] = [];
  const fakeClient = {
    messages: {
      async create(body: Record<string, unknown>) {
        apiCalls++;
        requestBodies.push(body);
        return {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5",
          stop_reason: "end_turn",
          stop_sequence: null,
          content: [
            { type: "server_tool_use", id: "tool_1", name: "web_search", input: {}, caller: { type: "direct" } },
            {
              type: "web_search_tool_result",
              tool_use_id: "tool_1",
              caller: { type: "direct" },
              content: [
                { type: "web_search_result", url: "https://official.example", title: "Official", encrypted_content: "x", page_age: null },
                { type: "web_search_result", url: "https://directory.example", title: "Directory", encrypted_content: "y", page_age: null },
              ],
            },
            { type: "text", text: "Geen conclusie zonder verificatie.", citations: null },
          ],
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 },
          },
        };
      },
    },
  } as unknown as Pick<Anthropic, "messages">;

  const source = new AnthropicOfficialWebsiteSearch({
    apiKey: "test-key",
    model: "claude-sonnet-5",
    timeoutMs: 1_000,
    client: fakeClient,
  });
  assert.deepEqual(await source.search(candidate()), {
    urls: ["https://official.example", "https://directory.example"],
  });
  assert.equal(apiCalls, 1);
  const tools = requestBodies[0].tools as Array<Record<string, unknown>>;
  assert.equal(tools[0].type, "web_search_20250305");
  assert.equal(tools[0].max_uses, 1);
  assert.deepEqual(tools[0].user_location, {
    type: "approximate",
    city: "Utrecht",
    region: undefined,
    country: "NL",
    timezone: "Europe/Amsterdam",
  });
  const messages = requestBodies[0].messages as Array<{ content: string }>;
  assert.match(messages[0].content, /Jansen Schilderwerken B\.V\./);
  assert.match(messages[0].content, /3512 AB/);
  assert.match(messages[0].content, /Utrecht/);
});

test("invalid listed candidate triggers no search, persistence or downstream behavior", async () => {
  let searches = 0;
  const service = new OfficialWebsiteDiscoveryService({
    search: { async search() { searches++; return { urls: [] }; } },
    inspect: async () => inspection(),
  });
  const result = await service.discover(candidate({
    websiteListingStatus: "website_listed",
    websiteUrl: "https://already-listed.nl",
  }));
  assert.deepEqual(result, { status: "technical_error", reason: "INVALID_INPUT" });
  assert.equal(searches, 0);

  const source = fs.readFileSync(path.join(process.cwd(), "lib/discovery/official-website/service.ts"), "utf8");
  const imports = source.split("\n").filter((line) => line.startsWith("import") || line.trim().startsWith("from ")).join("\n");
  assert.doesNotMatch(imports, /repositor|scor|outreach|kvk|lead/i);
  assert.doesNotMatch(source, /\.(?:create|persist|score|send|transition)\s*\(/i);
  const searchSource = fs.readFileSync(path.join(process.cwd(), "lib/discovery/official-website/anthropic-search.ts"), "utf8");
  const searchImports = searchSource.split("\n").filter((line) => line.startsWith("import") || line.trim().startsWith("from ")).join("\n");
  assert.doesNotMatch(searchImports, /AnthropicProvider/);
  assert.doesNotMatch(searchSource, /\.generateText\s*\(/);
});
