import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { WebsiteDiscoveryService } from "../lib/discovery/website-service";
import {
  WEBSITE_MAX_RESPONSE_BYTES,
  isPublicAddress,
  type ResolvedAddress,
  type WebsiteNetworkDependencies,
  type WebsiteRawResponse,
} from "../lib/discovery/website-network-safety";

const PUBLIC_V4: ResolvedAddress = { address: "8.8.8.8", family: 4 };
const PUBLIC_V6: ResolvedAddress = { address: "2606:4700:4700::1111", family: 6 };

function rawResponse(
  statusCode: number,
  body: string | Uint8Array | Array<string | Uint8Array>,
  headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" }
): WebsiteRawResponse {
  const chunks = Array.isArray(body) ? body : [body];
  return {
    statusCode,
    headers,
    body: Readable.from(chunks),
  };
}

function validHtml(name = "Publieke Testzaak"): string {
  return `<!doctype html><html><head><title>${name}</title><meta name="viewport" content="width=device-width"></head><body><h1>${name}</h1><p>${"Veilige publieke bedrijfsinformatie. ".repeat(12)}</p><a href="/contact">Contact</a></body></html>`;
}

function publicDependencies(
  request: NonNullable<WebsiteNetworkDependencies["request"]>
): WebsiteNetworkDependencies {
  return {
    resolve: async () => [PUBLIC_V4, PUBLIC_V6],
    request,
  };
}

test("IP classifier blocks localhost, private, carrier, link-local, documentation, multicast and reserved ranges", () => {
  for (const address of [
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254",
    "172.16.0.1", "192.0.0.1", "192.0.2.1", "192.168.1.1", "198.18.0.1",
    "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "ff02::1",
    "2001:db8::1", "2002::1",
  ]) assert.equal(isPublicAddress(address), false, address);

  assert.equal(isPublicAddress(PUBLIC_V4.address), true);
  assert.equal(isPublicAddress(PUBLIC_V6.address), true);
});

test("direct unsafe IPs and local hostnames are rejected before any request", async () => {
  for (const url of [
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://192.168.1.20/",
    "https://service.local/",
    "https://admin.internal/",
    "https://example.test/",
  ]) {
    let requests = 0;
    const result = await WebsiteDiscoveryService.checkWebsite(url, 100, {
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
      request: async () => {
        requests++;
        return rawResponse(200, validHtml());
      },
    });
    assert.equal(result.reachable, false, url);
    assert.equal(requests, 0, url);
  }
});

test("DNS answers are all validated and mixed public/private answers are rejected", async () => {
  let requests = 0;
  const result = await WebsiteDiscoveryService.checkWebsite("https://business.nl", 100, {
    resolve: async () => [PUBLIC_V4, { address: "10.1.2.3", family: 4 }],
    request: async () => {
      requests++;
      return rawResponse(200, validHtml());
    },
  });
  assert.equal(result.reachable, false);
  assert.equal(requests, 0);
});

test("validated DNS address is pinned into the request to prevent a second lookup", async () => {
  let resolutions = 0;
  let pinned: ResolvedAddress | null = null;
  const result = await WebsiteDiscoveryService.checkWebsite("https://business.nl", 100, {
    resolve: async () => {
      resolutions++;
      return [PUBLIC_V4];
    },
    request: async (_url, address) => {
      pinned = address;
      return rawResponse(200, validHtml());
    },
  });
  assert.equal(result.reachable, true);
  assert.equal(resolutions, 1);
  assert.deepEqual(pinned, PUBLIC_V4);
});

test("unsafe ports, credentials and malformed URLs are rejected", async () => {
  for (const url of [
    "http://business.nl:22/",
    "https://business.nl:8443/",
    "https://user:password@business.nl/",
    "http://",
    "https://[not-ip]/",
    "not a valid host / path",
  ]) {
    let requests = 0;
    const result = await WebsiteDiscoveryService.checkWebsite(url, 100, publicDependencies(async () => {
      requests++;
      return rawResponse(200, validHtml());
    }));
    assert.equal(result.reachable, false, url);
    assert.equal(requests, 0, url);
  }
});

test("redirects to unsafe destinations are rejected without requesting the destination", async () => {
  let requests = 0;
  const result = await WebsiteDiscoveryService.checkWebsite("https://business.nl", 100, publicDependencies(async () => {
    requests++;
    return rawResponse(302, "", { location: "http://169.254.169.254/latest/meta-data/" });
  }));
  assert.equal(result.reachable, false);
  assert.equal(requests, 1);
});

test("redirect chains are capped and every public destination is re-resolved", async () => {
  let requests = 0;
  let resolutions = 0;
  const result = await WebsiteDiscoveryService.checkWebsite("https://business.nl/0", 100, {
    resolve: async () => {
      resolutions++;
      return [PUBLIC_V4];
    },
    request: async (url) => {
      requests++;
      const n = Number(url.pathname.slice(1));
      return rawResponse(302, "", { location: `/${n + 1}` });
    },
  });
  assert.equal(result.reachable, false);
  assert.equal(requests, 4);
  assert.equal(resolutions, 4);
});

test("declared and streamed oversized responses are rejected", async () => {
  const declared = await WebsiteDiscoveryService.checkWebsite("https://business.nl", 100, publicDependencies(async () =>
    rawResponse(200, validHtml(), {
      "content-type": "text/html",
      "content-length": String(WEBSITE_MAX_RESPONSE_BYTES + 1),
    })
  ));
  assert.equal(declared.reachable, false);

  const streamed = await WebsiteDiscoveryService.checkWebsite("https://business.nl", 100, publicDependencies(async () =>
    rawResponse(200, [new Uint8Array(40_000), new Uint8Array(30_000)], { "content-type": "text/html" })
  ));
  assert.equal(streamed.reachable, false);
});

test("unexpected or missing content types are rejected", async () => {
  const headerSets: Array<Record<string, string>> = [
    { "content-type": "application/pdf" },
    { "content-type": "image/png" },
    {},
  ];
  for (const headers of headerSets) {
    const result = await WebsiteDiscoveryService.checkWebsite("https://business.nl", 100, publicDependencies(async () =>
      rawResponse(200, validHtml(), headers)
    ));
    assert.equal(result.reachable, false);
  }
});

test("valid public HTML preserves redirect and basic website checks", async () => {
  const seen: string[] = [];
  const result = await WebsiteDiscoveryService.checkWebsite("http://business.nl", 200, publicDependencies(async (url, pinned) => {
    seen.push(`${url.toString()}@${pinned.address}`);
    if (url.protocol === "http:") return rawResponse(301, "", { location: "https://www.business.nl/" });
    return rawResponse(200, validHtml(), { "content-type": "text/html; charset=UTF-8" });
  }));

  assert.equal(result.reachable, true);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.https, true);
  assert.equal(result.redirected, true);
  assert.equal(result.hasTitle, true);
  assert.equal(result.hasBasicHtml, true);
  assert.equal(result.hasViewport, true);
  assert.equal(result.hasContactHint, true);
  assert.equal(result.looksBroken, false);
  assert.equal(seen.length, 2);
});

test("timeout remains a safe unreachable result", async () => {
  const result = await WebsiteDiscoveryService.checkWebsite("https://business.nl", 10, publicDependencies(async () =>
    new Promise<WebsiteRawResponse>(() => {})
  ));
  assert.equal(result.reachable, false);
  assert.equal(result.httpStatus, null);
  assert.equal(result.looksBroken, true);
});

test("normalization and hostname comparison remain available", () => {
  assert.equal(WebsiteDiscoveryService.normalizeUrl("WWW.Example.NL/"), "https://www.example.nl");
  assert.equal(WebsiteDiscoveryService.isSameWebsite("https://www.example.nl/a", "http://example.nl/b"), true);
});
