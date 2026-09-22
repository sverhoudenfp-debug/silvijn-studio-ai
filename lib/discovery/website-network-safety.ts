import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

export const WEBSITE_MAX_RESPONSE_BYTES = 64_000;
export const WEBSITE_MAX_REDIRECTS = 3;
const ALLOWED_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const BLOCKED_HOST_SUFFIXES = [
  "localhost",
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".test",
  ".invalid",
  ".example",
  ".onion",
];

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface WebsiteRawResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: AsyncIterable<Uint8Array | string> & { destroy?: (error?: Error) => void };
}

export interface WebsiteNetworkDependencies {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  request?: (
    url: URL,
    pinnedAddress: ResolvedAddress,
    timeoutMs: number
  ) => Promise<WebsiteRawResponse>;
}

export interface SafeWebsiteResponse {
  statusCode: number;
  finalUrl: URL;
  redirected: boolean;
  body: string;
}

function ipv4Number(address: string): number | null {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function ipv4InCidr(value: number, base: string, prefix: number): boolean {
  const baseValue = ipv4Number(base);
  if (baseValue === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

const BLOCKED_IPV4_CIDRS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function parseIpv6(address: string): bigint | null {
  let input = address.toLowerCase().split("%")[0];
  if (input.startsWith("[") && input.endsWith("]")) input = input.slice(1, -1);

  const expandIpv4 = (parts: string[]): string[] | null => {
    if (!parts.some((part) => part.includes("."))) return parts;
    const last = parts.at(-1);
    if (!last || !last.includes(".")) return null;
    const value = ipv4Number(last);
    if (value === null) return null;
    return [...parts.slice(0, -1), ((value >>> 16) & 0xffff).toString(16), (value & 0xffff).toString(16)];
  };

  const halves = input.split("::");
  if (halves.length > 2) return null;
  let left = halves[0] ? halves[0].split(":") : [];
  let right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  left = expandIpv4(left) ?? [];
  right = expandIpv4(right) ?? [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const parts = halves.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.reduce((value, part) => (value << BigInt(16)) | BigInt(parseInt(part, 16)), BigInt(0));
}

function ipv6InCidr(value: bigint, base: string, prefix: number): boolean {
  const baseValue = parseIpv6(base);
  if (baseValue === null) return false;
  const shift = BigInt(128 - prefix);
  return (value >> shift) === (baseValue >> shift);
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address.replace(/^\[|\]$/g, ""));
  if (family === 4) {
    const value = ipv4Number(address);
    return value !== null && !BLOCKED_IPV4_CIDRS.some(([base, prefix]) => ipv4InCidr(value, base, prefix));
  }
  if (family === 6) {
    const value = parseIpv6(address);
    if (value === null || !ipv6InCidr(value, "2000::", 3)) return false;
    return ![
      ["2001::", 32],
      ["2001:10::", 28],
      ["2001:20::", 28],
      ["2001:2::", 48],
      ["2001:db8::", 32],
      ["2002::", 16],
      ["3fff::", 20],
    ].some(([base, prefix]) => ipv6InCidr(value, String(base), Number(prefix)));
  }
  return false;
}

function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

export function isSafeWebsiteUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if ((url.protocol === "https:" && port !== "443") || (url.protocol === "http:" && port !== "80")) return false;

  const hostname = normalizedHostname(url);
  if (!hostname || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(suffix))) return false;
  if (isIP(hostname)) return isPublicAddress(hostname);
  if (!hostname.includes(".")) return false;
  return /^[a-z0-9.-]+$/.test(hostname) && !hostname.includes("..") && !hostname.startsWith(".");
}

async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  const result = await dnsLookup(hostname, { all: true, verbatim: true });
  return result.flatMap((entry) =>
    entry.family === 4 || entry.family === 6
      ? [{ address: entry.address, family: entry.family }]
      : []
  );
}

async function defaultRequest(
  url: URL,
  pinnedAddress: ResolvedAddress,
  timeoutMs: number
): Promise<WebsiteRawResponse> {
  return new Promise((resolve, reject) => {
    const lookup: LookupFunction = (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) {
        callback(null, [{ address: pinnedAddress.address, family: pinnedAddress.family }]);
      } else {
        callback(null, pinnedAddress.address, pinnedAddress.family);
      }
    };
    const options: RequestOptions = {
      method: "GET",
      lookup,
      agent: false,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
        "User-Agent": "SilvijnStudioDiscoveryBot/1.0 (basis-websitecheck)",
      },
    };
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, options, (response) => {
      resolve({
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        body: response,
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("WEBSITE_REQUEST_TIMEOUT")));
    request.once("error", reject);
    request.end();
  });
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function destroyBody(body: WebsiteRawResponse["body"], error?: Error): void {
  try {
    body.destroy?.(error);
  } catch {}
}

async function readBoundedHtml(response: WebsiteRawResponse): Promise<string> {
  const rawLength = firstHeader(response.headers["content-length"]);
  if (rawLength) {
    const contentLength = Number(rawLength);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > WEBSITE_MAX_RESPONSE_BYTES) {
      destroyBody(response.body);
      throw new Error("WEBSITE_RESPONSE_TOO_LARGE");
    }
  }

  const rawType = firstHeader(response.headers["content-type"]);
  const contentType = rawType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    destroyBody(response.body);
    throw new Error("WEBSITE_UNEXPECTED_CONTENT_TYPE");
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk);
    total += bytes.byteLength;
    if (total > WEBSITE_MAX_RESPONSE_BYTES) {
      destroyBody(response.body);
      throw new Error("WEBSITE_RESPONSE_TOO_LARGE");
    }
    chunks.push(bytes);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(combined);
}

function remainingMs(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("WEBSITE_REQUEST_TIMEOUT");
  return remaining;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("WEBSITE_REQUEST_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveAndValidate(
  url: URL,
  resolver: NonNullable<WebsiteNetworkDependencies["resolve"]>,
  timeoutMs: number
): Promise<ResolvedAddress> {
  const hostname = normalizedHostname(url);
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error("WEBSITE_UNSAFE_ADDRESS");
    return { address: hostname, family: isIP(hostname) as 4 | 6 };
  }

  const addresses = await withTimeout(resolver(hostname), timeoutMs);
  if (addresses.length === 0 || addresses.length > 16) throw new Error("WEBSITE_UNSAFE_ADDRESS");
  if (addresses.some((entry) =>
    (entry.family !== 4 && entry.family !== 6) ||
    isIP(entry.address) !== entry.family ||
    !isPublicAddress(entry.address)
  )) {
    throw new Error("WEBSITE_UNSAFE_ADDRESS");
  }
  return addresses[0];
}

export async function fetchSafeWebsite(
  initialUrl: URL,
  timeoutMs: number,
  dependencies: WebsiteNetworkDependencies = {}
): Promise<SafeWebsiteResponse> {
  const resolver = dependencies.resolve ?? defaultResolve;
  const requester = dependencies.request ?? defaultRequest;
  const deadline = Date.now() + Math.max(1, timeoutMs);
  let current = initialUrl;
  let redirected = false;

  for (let redirectCount = 0; redirectCount <= WEBSITE_MAX_REDIRECTS; redirectCount++) {
    if (!isSafeWebsiteUrl(current)) throw new Error("WEBSITE_UNSAFE_URL");
    const pinned = await resolveAndValidate(current, resolver, remainingMs(deadline));
    const response = await withTimeout(
      requester(current, pinned, remainingMs(deadline)),
      remainingMs(deadline)
    );

    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = firstHeader(response.headers.location);
      destroyBody(response.body);
      if (!location) throw new Error("WEBSITE_INVALID_REDIRECT");
      if (redirectCount >= WEBSITE_MAX_REDIRECTS) throw new Error("WEBSITE_TOO_MANY_REDIRECTS");
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new Error("WEBSITE_INVALID_REDIRECT");
      }
      if (!isSafeWebsiteUrl(next)) throw new Error("WEBSITE_UNSAFE_REDIRECT");
      current = next;
      redirected = true;
      continue;
    }

    let body: string;
    try {
      body = await withTimeout(readBoundedHtml(response), remainingMs(deadline));
    } catch (error) {
      destroyBody(response.body, error instanceof Error ? error : undefined);
      throw error;
    }
    return { statusCode: response.statusCode, finalUrl: current, redirected, body };
  }

  throw new Error("WEBSITE_TOO_MANY_REDIRECTS");
}
