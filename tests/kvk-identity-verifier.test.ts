import { test } from "node:test";
import assert from "node:assert/strict";
import { KvkIdentityVerifier } from "../lib/discovery/identity/kvk-verifier";
import type { TemporaryGoogleCandidate } from "../lib/discovery/identity/types";

function createMockFetcher(
  handler: (url: string, init?: RequestInit) => { status?: number; data?: unknown; text?: string; headers?: Record<string, string> }
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === "string" ? input : input.toString();
    const res = handler(urlStr, init);
    const statusCode = res.status ?? 200;
    const bodyText = res.text ?? (res.data !== undefined ? JSON.stringify(res.data) : "");
    const headers = new Headers(res.headers ?? { "content-type": "application/json" });

    return new Response(bodyText, {
      status: statusCode,
      headers,
    });
  }) as typeof fetch;
}

const sampleCandidate: TemporaryGoogleCandidate = {
  kind: "temporary_google",
  placeId: "place_abc123",
  displayName: "Jansen & Zonen B.V.",
  websiteUrl: null,
  websiteListingStatus: "no_website_listed",
  address: {
    postalCode: "1012 AB",
    houseNumber: "10",
    addition: "A",
    street: "Dam",
    city: "Amsterdam",
    countryCode: "NL",
  },
};

test("returns KVK_NOT_CONFIGURED when API key is missing or empty", async () => {
  const verifier = new KvkIdentityVerifier({ apiKey: "" });
  const result = await verifier.verify(sampleCandidate);
  assert.deepEqual(result, {
    status: "technical_error",
    reason: "KVK_NOT_CONFIGURED",
  });
});

test("returns NOT_NL when candidate country code is not NL", async () => {
  const verifier = new KvkIdentityVerifier({ apiKey: "test_key" });
  const result = await verifier.verify({
    ...sampleCandidate,
    address: { ...sampleCandidate.address, countryCode: "BE" },
  });
  assert.deepEqual(result, {
    status: "unmatched",
    reason: "NOT_NL",
  });
});

test("positive verification: exact active trade name and visiting address match", async () => {
  const mockFetcher = createMockFetcher((url) => {
    if (url.includes("/api/v2/zoeken")) {
      return {
        data: {
          totaal: 1,
          resultaten: [
            {
              kvkNummer: "12345678",
              vestigingsnummer: "000012345678",
              handelsnaam: "Jansen & Zonen B.V.",
              tradeNames: ["Jansen & Zonen B.V."],
              type: "hoofdvestiging",
              actief: "ja",
              adres: {
                straatnaam: "Dam",
                huisnummer: "10",
                huisnummerToevoeging: "A",
                postcode: "1012 AB",
                plaats: "Amsterdam",
                land: "Nederland",
                type: "bezoekadres",
              },
            },
          ],
        },
      };
    }
    if (url.includes("/api/v1/vestigingsprofielen/000012345678")) {
      return {
        data: {
          kvkNummer: "12345678",
          vestigingsnummer: "000012345678",
          eersteHandelsnaam: "Jansen & Zonen B.V.",
          handelsnamen: ["Jansen & Zonen B.V."],
          actief: true,
          bezoekadres: {
            straatnaam: "Dam",
            huisnummer: "10",
            huisnummerToevoeging: "A",
            postcode: "1012AB",
            plaats: "Amsterdam",
          },
          sbiActiviteiten: [
            { sbiCode: "6201", sbiOmschrijving: "Ontwikkelen van software", indHoofdactiviteit: "ja" },
          ],
          webadressen: ["https://jansen.nl"],
          _embedded: {
            basisprofiel: {
              kvkNummer: "12345678",
              statutaireNaam: "Jansen & Zonen B.V.",
              rechtsvorm: { omschrijving: "Besloten Vennootschap" },
              indNonMailing: "nee",
            },
          },
        },
      };
    }
    return { status: 404 };
  });

  const verifier = new KvkIdentityVerifier({ apiKey: "test_key", fetcher: mockFetcher });
  const result = await verifier.verify(sampleCandidate);

  assert.equal(result.status, "verified");
  if (result.status === "verified") {
    assert.equal(result.identity.kind, "verified_kvk");
    assert.equal(result.identity.kvkNumber, "12345678");
    assert.equal(result.identity.establishmentNumber, "000012345678");
    assert.equal(result.identity.businessName, "Jansen & Zonen B.V.");
    assert.deepEqual(result.identity.tradeNames, ["Jansen & Zonen B.V."]);
    assert.equal(result.identity.address.postalCode, "1012AB");
    assert.equal(result.identity.address.houseNumber, "10");
    assert.equal(result.identity.address.addition, "A");
    assert.equal(result.identity.address.country, "NL");
    assert.equal(result.identity.legalForm, "Besloten Vennootschap");
    assert.equal(result.identity.nonMailing, false);
    assert.deepEqual(result.identity.websites, ["https://jansen.nl"]);
    assert.equal(result.identity.provenance.basisProfile, "https://api.kvk.nl/api/v1/basisprofielen/12345678");
    assert.equal(result.identity.provenance.establishmentProfile, "https://api.kvk.nl/api/v1/vestigingsprofielen/000012345678");
    assert.equal(result.identity.provenance.matchRule, "active_trade_name_and_visit_address_v1");
  }
});

test("ambiguous: multiple viable branches for same query", async () => {
  const mockFetcher = createMockFetcher((url) => {
    if (url.includes("/api/v2/zoeken")) {
      return {
        data: {
          totaal: 2,
          resultaten: [
            {
              kvkNummer: "12345678",
              vestigingsnummer: "000012345678",
              handelsnaam: "Jansen & Zonen B.V.",
              type: "hoofdvestiging",
              actief: "ja",
              adres: { postcode: "1012AB", huisnummer: "10", huisnummerToevoeging: "A" },
            },
            {
              kvkNummer: "12345678",
              vestigingsnummer: "000087654321",
              handelsnaam: "Jansen & Zonen B.V.",
              type: "nevenvestiging",
              actief: "ja",
              adres: { postcode: "1012AB", huisnummer: "10", huisnummerToevoeging: "A" },
            },
          ],
        },
      };
    }
    return { status: 404 };
  });

  const verifier = new KvkIdentityVerifier({ apiKey: "test_key", fetcher: mockFetcher });
  const result = await verifier.verify(sampleCandidate);

  assert.deepEqual(result, {
    status: "ambiguous",
    reason: "MULTIPLE_MATCHES",
  });
});

test("ambiguous: insufficient evidence when address and city are missing", async () => {
  const verifier = new KvkIdentityVerifier({ apiKey: "test_key" });
  const result = await verifier.verify({
    kind: "temporary_google",
    placeId: "p1",
    displayName: "Jansen B.V.",
    websiteUrl: null,
    websiteListingStatus: "no_website_listed",
    address: {
      postalCode: null,
      houseNumber: null,
      addition: null,
      street: null,
      city: null,
      countryCode: "NL",
    },
  });

  assert.deepEqual(result, {
    status: "ambiguous",
    reason: "INSUFFICIENT_EVIDENCE",
  });
});

test("ambiguous: search results truncated over maxSearchResults cap", async () => {
  const mockFetcher = createMockFetcher(() => ({
    data: {
      totaal: 150,
      resultaten: Array.from({ length: 100 }, (_, i) => ({
        kvkNummer: `1000000${i}`,
        vestigingsnummer: `00001000000${i}`,
        handelsnaam: "Jansen B.V.",
        type: "hoofdvestiging",
        actief: "ja",
        adres: { postcode: "1012AB", huisnummer: "10", huisnummerToevoeging: "A" },
      })),
    },
  }));

  const verifier = new KvkIdentityVerifier({
    apiKey: "test_key",
    fetcher: mockFetcher,
    maxSearchResults: 50,
  });

  const result = await verifier.verify(sampleCandidate);
  assert.deepEqual(result, {
    status: "ambiguous",
    reason: "SEARCH_LIMIT",
  });
});

test("unmatched: no match when search returns no candidates or addresses differ", async () => {
  const mockFetcher = createMockFetcher(() => ({
    data: { totaal: 0, resultaten: [] },
  }));

  const verifier = new KvkIdentityVerifier({ apiKey: "test_key", fetcher: mockFetcher });
  const result = await verifier.verify(sampleCandidate);

  assert.deepEqual(result, {
    status: "unmatched",
    reason: "NO_MATCH",
  });
});

test("unmatched: house addition mismatch (strict no fuzzy)", async () => {
  const mockFetcher = createMockFetcher(() => ({
    data: {
      totaal: 1,
      resultaten: [
        {
          kvkNummer: "12345678",
          vestigingsnummer: "000012345678",
          handelsnaam: "Jansen & Zonen B.V.",
          type: "hoofdvestiging",
          actief: "ja",
          adres: {
            postcode: "1012 AB",
            huisnummer: "10",
            huisnummerToevoeging: "B",
          },
        },
      ],
    },
  }));

  const verifier = new KvkIdentityVerifier({ apiKey: "test_key", fetcher: mockFetcher });
  const result = await verifier.verify(sampleCandidate);

  assert.deepEqual(result, {
    status: "unmatched",
    reason: "NO_MATCH",
  });
});

test("unmatched: closed / inactive profile", async () => {
  const mockFetcher = createMockFetcher(() => ({
    data: {
      totaal: 1,
      resultaten: [
        {
          kvkNummer: "12345678",
          vestigingsnummer: "000012345678",
          handelsnaam: "Jansen & Zonen B.V.",
          type: "hoofdvestiging",
          actief: "nee",
          einddatum: "2022-01-01",
          adres: {
            postcode: "1012 AB",
            huisnummer: "10",
            huisnummerToevoeging: "A",
          },
        },
      ],
    },
  }));

  const verifier = new KvkIdentityVerifier({ apiKey: "test_key", fetcher: mockFetcher });
  const result = await verifier.verify(sampleCandidate);

  assert.deepEqual(result, {
    status: "unmatched",
    reason: "INACTIVE",
  });
});

test("unmatched: hidden visiting address (indAfgeschermd ja)", async () => {
  const mockFetcher = createMockFetcher(() => ({
    data: {
      totaal: 1,
      resultaten: [
        {
          kvkNummer: "12345678",
          vestigingsnummer: "000012345678",
          handelsnaam: "Jansen & Zonen B.V.",
          type: "hoofdvestiging",
          actief: "ja",
          indAfgeschermd: "ja",
          adres: {
            postcode: "1012 AB",
            huisnummer: "10",
            huisnummerToevoeging: "A",
            indAfgeschermd: "ja",
          },
        },
      ],
    },
  }));

  const verifier = new KvkIdentityVerifier({ apiKey: "test_key", fetcher: mockFetcher });
  const result = await verifier.verify(sampleCandidate);

  assert.deepEqual(result, {
    status: "unmatched",
    reason: "NO_MATCH",
  });
});

test("unmatched: correspondence address is ignored for visiting address match", async () => {
  const mockFetcher = createMockFetcher(() => ({
    data: {
      totaal: 1,
      resultaten: [
        {
          kvkNummer: "12345678",
          vestigingsnummer: "000012345678",
          handelsnaam: "Jansen & Zonen B.V.",
          type: "hoofdvestiging",
          actief: "ja",
          adres: {
            type: "correspondentieadres",
            postcode: "1012 AB",
            huisnummer: "10",
            huisnummerToevoeging: "A",
          },
        },
      ],
    },
  }));

  const verifier = new KvkIdentityVerifier({ apiKey: "test_key", fetcher: mockFetcher });
  const result = await verifier.verify(sampleCandidate);

  assert.deepEqual(result, {
    status: "unmatched",
    reason: "NO_MATCH",
  });
});

test("technical_error: KVK_INVALID_RESPONSE on profile identity mismatch", async () => {
  const mockFetcher = createMockFetcher((url) => {
    if (url.includes("/api/v2/zoeken")) {
      return {
        data: {
          totaal: 1,
          resultaten: [
            {
              kvkNummer: "12345678",
              vestigingsnummer: "000012345678",
              handelsnaam: "Jansen & Zonen B.V.",
              type: "hoofdvestiging",
              actief: "ja",
              adres: { postcode: "1012 AB", huisnummer: "10", huisnummerToevoeging: "A" },
            },
          ],
        },
      };
    }
    if (url.includes("/api/v1/vestigingsprofielen/000012345678")) {
      return {
        data: {
          kvkNummer: "88888888", // Mismatched KVK number!
          vestigingsnummer: "000012345678",
          eersteHandelsnaam: "Jansen & Zonen B.V.",
          actief: true,
          bezoekadres: { postcode: "1012AB", huisnummer: "10", huisnummerToevoeging: "A" },
          _embedded: {
            basisprofiel: {
              kvkNummer: "88888888", // Mismatched KVK number!
            },
          },
        },
      };
    }
    return { status: 404 };
  });

  const verifier = new KvkIdentityVerifier({ apiKey: "test_key", fetcher: mockFetcher });
  const result = await verifier.verify(sampleCandidate);

  assert.deepEqual(result, {
    status: "technical_error",
    reason: "KVK_INVALID_RESPONSE",
  });
});

test("technical_error: KVK_REQUEST_FAILED on HTTP 500 error", async () => {
  const mockFetcher = createMockFetcher(() => ({
    status: 500,
  }));

  const verifier = new KvkIdentityVerifier({ apiKey: "test_key", fetcher: mockFetcher });
  const result = await verifier.verify(sampleCandidate);

  assert.deepEqual(result, {
    status: "technical_error",
    reason: "KVK_REQUEST_FAILED",
  });
});

test("name normalization: normalizes diacritics/case/punctuation, preserves BV legal form", async () => {
  const mockFetcher = createMockFetcher((url) => {
    if (url.includes("/api/v2/zoeken")) {
      return {
        data: {
          totaal: 1,
          resultaten: [
            {
              kvkNummer: "12345678",
              vestigingsnummer: "000012345678",
              handelsnaam: "Cafe t Hoekje BV",
              type: "hoofdvestiging",
              actief: "ja",
              adres: { postcode: "1012 AB", huisnummer: "10", huisnummerToevoeging: "A" },
            },
          ],
        },
      };
    }
    if (url.includes("/api/v1/vestigingsprofielen/000012345678")) {
      return {
        data: {
          kvkNummer: "12345678",
          vestigingsnummer: "000012345678",
          eersteHandelsnaam: "Café 't Hoekje B.V.",
          actief: true,
          bezoekadres: { postcode: "1012AB", huisnummer: "10", huisnummerToevoeging: "A" },
          _embedded: { basisprofiel: { kvkNummer: "12345678" } },
        },
      };
    }
    return { status: 404 };
  });

  const verifier = new KvkIdentityVerifier({ apiKey: "test_key", fetcher: mockFetcher });
  const result = await verifier.verify({
    ...sampleCandidate,
    displayName: "Café 't  Hoekje B.V.",
  });

  assert.equal(result.status, "verified");
});

test("name normalization: does NOT strip BV holding or match fuzzy", async () => {
  const mockFetcher = createMockFetcher(() => ({
    data: {
      totaal: 1,
      resultaten: [
        {
          kvkNummer: "12345678",
          vestigingsnummer: "000012345678",
          handelsnaam: "Jansen Holding B.V.",
          type: "hoofdvestiging",
          actief: "ja",
          adres: { postcode: "1012 AB", huisnummer: "10", huisnummerToevoeging: "A" },
        },
      ],
    },
  }));

  const verifier = new KvkIdentityVerifier({ apiKey: "test_key", fetcher: mockFetcher });
  const result = await verifier.verify({
    ...sampleCandidate,
    displayName: "Jansen",
  });

  assert.deepEqual(result, {
    status: "unmatched",
    reason: "NO_MATCH",
  });
});
