import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GooglePlacesDiscoveryProvider,
  GoogleDiscoveryError,
} from "../lib/discovery/providers/google-places-provider";
import type { DiscoveryRequest } from "../lib/discovery/types";

test("GooglePlacesDiscoveryProvider properties are correctly set", () => {
  const provider = new GooglePlacesDiscoveryProvider({ apiKey: "test-key" });
  assert.equal(provider.id, "google");
  assert.equal(provider.name, "Google Places API (New)");
  assert.equal(provider.live, true);
});

test("searchPage sends minimal field mask, headers, and structured payload", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  const fakeFetcher: typeof fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;

    const responseBody = JSON.stringify({
      places: [
        {
          id: "place_123",
          displayName: { text: "Bakkerij Jansen" },
          addressComponents: [
            { longText: "Kerkstraat", shortText: "Kerkstraat", types: ["route"] },
            { longText: "12", shortText: "12", types: ["street_number"] },
            { longText: "A", shortText: "A", types: ["subpremise"] },
            { longText: "1234 AB", shortText: "1234 AB", types: ["postal_code"] },
            { longText: "Eindhoven", shortText: "Eindhoven", types: ["locality"] },
            { longText: "Nederland", shortText: "NL", types: ["country"] },
          ],
        },
      ],
      nextPageToken: "token_abc",
    });

    return new Response(responseBody, { status: 200 });
  };

  const provider = new GooglePlacesDiscoveryProvider({
    apiKey: "secret-api-key-123",
    fetcher: fakeFetcher,
  });

  const request: DiscoveryRequest = {
    country: "NL",
    industry: "Bakkerij",
    city: "Eindhoven",
    province: "Noord-Brabant",
    query: "ambachtelijk",
    limit: 10,
    source: "google",
  };

  const page = await provider.searchPage(request);

  assert.equal(capturedUrl, "https://places.googleapis.com/v1/places:searchText");
  assert.equal(capturedInit?.method, "POST");

  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers["X-Goog-Api-Key"], "secret-api-key-123");
  assert.equal(
    headers["X-Goog-FieldMask"],
    "places.id,places.displayName,places.addressComponents,nextPageToken"
  );
  assert.equal(headers["Content-Type"], "application/json");

  assert.equal(capturedInit?.cache, "no-store");
  assert.equal(capturedInit?.redirect, "error");

  const payload = JSON.parse(capturedInit?.body as string);
  assert.equal(
    payload.textQuery,
    "Bakkerij ambachtelijk Eindhoven Noord-Brabant Nederland"
  );
  assert.equal(payload.pageSize, 10);
  assert.equal(payload.regionCode, "NL");
  assert.equal(payload.languageCode, "nl");
  assert.equal(payload.pageToken, undefined);

  assert.equal(page.nextPageToken, "token_abc");
  assert.equal(page.candidates.length, 1);

  const candidate = page.candidates[0];
  assert.equal(candidate.kind, "temporary_google");
  assert.equal(candidate.placeId, "place_123");
  assert.equal(candidate.displayName, "Bakkerij Jansen");
  assert.deepEqual(candidate.address, {
    postalCode: "1234 AB",
    houseNumber: "12",
    addition: "A",
    street: "Kerkstraat",
    city: "Eindhoven",
    countryCode: "NL",
  });
});

test("pageSize is capped at 20 and pageToken is passed when provided", async () => {
  let capturedPayload: Record<string, unknown> = {};

  const fakeFetcher: typeof fetch = async (_url, init) => {
    capturedPayload = JSON.parse(init?.body as string);
    return new Response(JSON.stringify({ places: [] }), { status: 200 });
  };

  const provider = new GooglePlacesDiscoveryProvider({
    apiKey: "key_1",
    fetcher: fakeFetcher,
  });

  const request: DiscoveryRequest = {
    country: "NL",
    industry: "Loodgieter",
    limit: 50, // requested > 20
    source: "google",
  };

  await provider.searchPage(request, "page_token_xyz");

  assert.equal(capturedPayload.pageSize, 20); // capped at 20
  assert.equal(capturedPayload.pageToken, "page_token_xyz");
});

test("missing address components default to null without filling from query", async () => {
  const fakeFetcher: typeof fetch = async () => {
    const responseBody = JSON.stringify({
      places: [
        {
          id: "place_456",
          displayName: { text: "Kapper Piet" },
          addressComponents: [
            { longText: "Amsterdam", shortText: "Amsterdam", types: ["locality"] },
          ],
        },
      ],
    });
    return new Response(responseBody, { status: 200 });
  };

  const provider = new GooglePlacesDiscoveryProvider({
    apiKey: "key_1",
    fetcher: fakeFetcher,
  });

  const request: DiscoveryRequest = {
    country: "NL",
    industry: "Kapper",
    city: "Rotterdam", // Query city is Rotterdam
    limit: 10,
    source: "google",
  };

  const page = await provider.searchPage(request);
  const candidate = page.candidates[0];

  assert.equal(candidate.displayName, "Kapper Piet");
  assert.equal(candidate.address.city, "Amsterdam"); // from component
  assert.equal(candidate.address.houseNumber, null); // missing -> null
  assert.equal(candidate.address.addition, null); // missing -> null
  assert.equal(candidate.address.street, null); // missing -> null
  assert.equal(candidate.address.postalCode, null); // missing -> null
  assert.equal(candidate.address.countryCode, null); // missing -> null
});

test("filters out non-NL candidate address and rejects non-NL request country", async () => {
  const fakeFetcher: typeof fetch = async () => {
    const responseBody = JSON.stringify({
      places: [
        {
          id: "place_nl",
          displayName: { text: "NL Business" },
          addressComponents: [
            { longText: "NL", shortText: "NL", types: ["country"] },
          ],
        },
        {
          id: "place_be",
          displayName: { text: "BE Business" },
          addressComponents: [
            { longText: "België", shortText: "BE", types: ["country"] },
          ],
        },
      ],
    });
    return new Response(responseBody, { status: 200 });
  };

  const provider = new GooglePlacesDiscoveryProvider({
    apiKey: "key_1",
    fetcher: fakeFetcher,
  });

  const nlPage = await provider.searchPage({
    country: "NL",
    industry: "IT",
    limit: 10,
    source: "google",
  });

  // Non-NL candidate is filtered out
  assert.equal(nlPage.candidates.length, 1);
  assert.equal(nlPage.candidates[0].placeId, "place_nl");

  // Non-NL request country throws GOOGLE_INVALID_RESPONSE
  await assert.rejects(
    () =>
      provider.searchPage({
        country: "DE",
        industry: "IT",
        limit: 10,
        source: "google",
      }),
    (err: GoogleDiscoveryError) => {
      assert.equal(err.code, "GOOGLE_INVALID_RESPONSE");
      return true;
    }
  );
});

test("throws GOOGLE_NOT_CONFIGURED when API key is missing", async () => {
  const oldEnv = process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.GOOGLE_PLACES_API_KEY;

  try {
    const provider = new GooglePlacesDiscoveryProvider({ apiKey: "" });
    await assert.rejects(
      () =>
        provider.searchPage({
          country: "NL",
          industry: "Test",
          limit: 10,
          source: "google",
        }),
      (err: GoogleDiscoveryError) => {
        assert.equal(err.code, "GOOGLE_NOT_CONFIGURED");
        return true;
      }
    );
  } finally {
    process.env.GOOGLE_PLACES_API_KEY = oldEnv;
  }
});

test("redacts sensitive error details on API request failure", async () => {
  const fakeFetcher: typeof fetch = async () => {
    return new Response("Secret internal server detail raw body error key=supersecret", {
      status: 403,
    });
  };

  const provider = new GooglePlacesDiscoveryProvider({
    apiKey: "supersecret-key",
    fetcher: fakeFetcher,
  });

  await assert.rejects(
    () =>
      provider.searchPage({
        country: "NL",
        industry: "Schilder",
        limit: 10,
        source: "google",
      }),
    (err: GoogleDiscoveryError) => {
      assert.equal(err.code, "GOOGLE_REQUEST_FAILED");
      assert.equal(err.reason, "HTTP_403");
      // Assert no API key or raw error response text is exposed in message or reason
      assert.doesNotMatch(err.message, /supersecret/);
      assert.doesNotMatch(err.message, /Secret internal server detail/);
      assert.doesNotMatch(String(err.reason), /supersecret/);
      assert.doesNotMatch(String(err.reason), /Secret internal server detail/);
      return true;
    }
  );
});

test("throws GOOGLE_INVALID_RESPONSE when response body exceeds 256KB limit", async () => {
  const fakeFetcher: typeof fetch = async () => {
    // Generate a response body > 256KB
    const largeString = "a".repeat(260 * 1024);
    return new Response(largeString, { status: 200 });
  };

  const provider = new GooglePlacesDiscoveryProvider({
    apiKey: "key_1",
    fetcher: fakeFetcher,
  });

  await assert.rejects(
    () =>
      provider.searchPage({
        country: "NL",
        industry: "Garage",
        limit: 10,
        source: "google",
      }),
    (err: GoogleDiscoveryError) => {
      assert.equal(err.code, "GOOGLE_INVALID_RESPONSE");
      assert.equal(err.reason, "BODY_EXCEEDS_LIMIT");
      return true;
    }
  );
});

test("ensures candidates contain ONLY TemporaryGoogleCandidate fields and no extra metadata", async () => {
  const fakeFetcher: typeof fetch = async () => {
    const responseBody = JSON.stringify({
      places: [
        {
          id: "place_clean",
          displayName: { text: "Schone Zaak" },
          addressComponents: [
            { longText: "Hoofdstraat", shortText: "Hoofdstraat", types: ["route"] },
            { longText: "NL", shortText: "NL", types: ["country"] },
          ],
        },
      ],
    });
    return new Response(responseBody, { status: 200 });
  };

  const provider = new GooglePlacesDiscoveryProvider({
    apiKey: "key_1",
    fetcher: fakeFetcher,
  });

  const page = await provider.searchPage({
    country: "NL",
    industry: "Schoonmaak",
    limit: 10,
    source: "google",
  });

  const candidate = page.candidates[0] as unknown as Record<string, unknown>;
  const allowedKeys = ["kind", "placeId", "displayName", "address"];
  const actualKeys = Object.keys(candidate);

  assert.deepEqual(actualKeys.sort(), allowedKeys.sort());
  assert.equal(candidate.rating, undefined);
  assert.equal(candidate.phone, undefined);
  assert.equal(candidate.website, undefined);
  assert.equal(candidate.metadata, undefined);
});
