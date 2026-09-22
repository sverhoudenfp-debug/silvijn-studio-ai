import type { DiscoveryRequest } from "../types";
import type { GoogleDiscoveryPage, TemporaryGoogleCandidate } from "../identity/types";
import { z } from "zod";

export type GoogleDiscoveryErrorCode =
  | "GOOGLE_NOT_CONFIGURED"
  | "GOOGLE_REQUEST_FAILED"
  | "GOOGLE_INVALID_RESPONSE";

export class GoogleDiscoveryError extends Error {
  readonly code: GoogleDiscoveryErrorCode;
  readonly reason?: string;

  constructor(code: GoogleDiscoveryErrorCode, message: string, reason?: string) {
    super(message);
    this.name = "GoogleDiscoveryError";
    this.code = code;
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const googleAddressComponentSchema = z.object({
  longText: z.string().optional(),
  shortText: z.string().optional(),
  types: z.array(z.string()).optional(),
});

const googlePlaceSchema = z.object({
  id: z.string().min(1),
  displayName: z.object({
    text: z.string().min(1),
    languageCode: z.string().optional(),
  }),
  addressComponents: z.array(googleAddressComponentSchema).optional(),
  websiteUri: z.string().nullable().optional(),
  nationalPhoneNumber: z.string().nullable().optional(),
  rating: z.number().min(0).max(5).nullable().optional(),
  userRatingCount: z.number().int().min(0).nullable().optional(),
});

const googlePlacesResponseSchema = z.object({
  places: z.array(googlePlaceSchema).optional(),
  nextPageToken: z.string().nullable().optional(),
});

export interface GooglePlacesProviderOptions {
  apiKey?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

const GOOGLE_PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const REQUIRED_FIELD_MASK = "places.id,places.displayName,places.addressComponents,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount,nextPageToken";
const MAX_RESPONSE_BODY_SIZE = 256 * 1024; // 256 KB

export class GooglePlacesDiscoveryProvider {
  readonly id = "google" as const;
  readonly name = "Google Places API (New)";
  readonly live = true;

  private readonly apiKey?: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options?: GooglePlacesProviderOptions) {
    this.apiKey = options?.apiKey ?? process.env.GOOGLE_PLACES_API_KEY;
    this.fetcher = options?.fetcher ?? fetch;
    this.timeoutMs = options?.timeoutMs ?? 10000;
  }

  async searchPage(
    request: DiscoveryRequest,
    pageToken?: string | null
  ): Promise<GoogleDiscoveryPage> {
    if (!this.apiKey || this.apiKey.trim() === "") {
      throw new GoogleDiscoveryError(
        "GOOGLE_NOT_CONFIGURED",
        "Google Places API key is not configured"
      );
    }

    if (request.country && request.country.trim().toUpperCase() !== "NL") {
      throw new GoogleDiscoveryError(
        "GOOGLE_INVALID_RESPONSE",
        "Only NL country code is supported by GooglePlacesDiscoveryProvider"
      );
    }

    const queryParts: string[] = [];
    if (request.industry?.trim()) queryParts.push(request.industry.trim());
    if (request.query?.trim()) queryParts.push(request.query.trim());
    if (request.city?.trim()) queryParts.push(request.city.trim());
    if (request.province?.trim()) queryParts.push(request.province.trim());
    queryParts.push("Nederland");

    const textQuery = queryParts.join(" ").trim();
    const pageSize = Math.max(1, Math.min(request.limit || 20, 20));

    const payload: Record<string, unknown> = {
      textQuery,
      pageSize,
      regionCode: "NL",
      languageCode: "nl",
    };

    if (pageToken && pageToken.trim() !== "") {
      payload.pageToken = pageToken.trim();
    }

    let response: Response;
    try {
      response = await this.fetcher(GOOGLE_PLACES_TEXT_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": REQUIRED_FIELD_MASK,
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err instanceof GoogleDiscoveryError) {
        throw err;
      }
      throw new GoogleDiscoveryError(
        "GOOGLE_REQUEST_FAILED",
        "Network or fetch request failed",
        "FETCH_FAILED"
      );
    }

    if (!response.ok) {
      throw new GoogleDiscoveryError(
        "GOOGLE_REQUEST_FAILED",
        `Google Places API returned status ${response.status}`,
        `HTTP_${response.status}`
      );
    }

    let bodyText: string;
    try {
      bodyText = await this.readBoundedBody(response);
    } catch (err) {
      if (err instanceof GoogleDiscoveryError) {
        throw err;
      }
      throw new GoogleDiscoveryError(
        "GOOGLE_INVALID_RESPONSE",
        "Failed to read response body",
        "BODY_READ_FAILED"
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(bodyText);
    } catch {
      throw new GoogleDiscoveryError(
        "GOOGLE_INVALID_RESPONSE",
        "Response body is not valid JSON",
        "INVALID_JSON"
      );
    }

    const parseResult = googlePlacesResponseSchema.safeParse(parsedJson);
    if (!parseResult.success) {
      throw new GoogleDiscoveryError(
        "GOOGLE_INVALID_RESPONSE",
        "Response does not match required schema",
        "SCHEMA_VALIDATION_FAILED"
      );
    }

    const places = parseResult.data.places ?? [];
    const candidates: TemporaryGoogleCandidate[] = [];

    for (const place of places) {
      const candidate = this.mapPlaceToCandidate(place);
      if (candidate) {
        candidates.push(candidate);
      }
    }

    return {
      candidates,
      nextPageToken: parseResult.data.nextPageToken ?? null,
    };
  }

  private async readBoundedBody(response: Response): Promise<string> {
    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalLength = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalLength += value.byteLength;
          if (totalLength > MAX_RESPONSE_BODY_SIZE) {
            try {
              await reader.cancel();
            } catch {}
            throw new GoogleDiscoveryError(
              "GOOGLE_INVALID_RESPONSE",
              "Response body exceeds 256KB limit",
              "BODY_EXCEEDS_LIMIT"
            );
          }
          chunks.push(value);
        }
      }

      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder("utf-8").decode(combined);
    } else {
      const text = await response.text();
      const byteLen = Buffer.byteLength(text, "utf-8");
      if (byteLen > MAX_RESPONSE_BODY_SIZE) {
        throw new GoogleDiscoveryError(
          "GOOGLE_INVALID_RESPONSE",
          "Response body exceeds 256KB limit",
          "BODY_EXCEEDS_LIMIT"
        );
      }
      return text;
    }
  }

  private usableWebsiteUrl(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(trimmed);
      if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || !parsed.hostname) return null;
      return parsed.toString();
    } catch {
      return null;
    }
  }

  private mapPlaceToCandidate(
    place: z.infer<typeof googlePlaceSchema>
  ): TemporaryGoogleCandidate | null {
    if (!place.id || !place.displayName?.text?.trim()) {
      return null;
    }

    let houseNumber: string | null = null;
    let addition: string | null = null;
    let street: string | null = null;
    let postalCode: string | null = null;
    let city: string | null = null;
    let province: string | null = null;
    let countryCode: string | null = null;

    if (place.addressComponents && Array.isArray(place.addressComponents)) {
      for (const comp of place.addressComponents) {
        const types = comp.types ?? [];
        const shortVal = comp.shortText?.trim();
        const longVal = comp.longText?.trim();

        if (types.includes("street_number")) {
          houseNumber = shortVal || longVal || null;
        } else if (types.includes("subpremise")) {
          addition = shortVal || longVal || null;
        } else if (types.includes("route")) {
          street = longVal || shortVal || null;
        } else if (types.includes("postal_code")) {
          postalCode = shortVal || longVal || null;
        } else if (types.includes("locality") || types.includes("postal_town")) {
          if (!city) {
            city = longVal || shortVal || null;
          }
        } else if (types.includes("administrative_area_level_1")) {
          province = longVal || shortVal || null;
        } else if (types.includes("country")) {
          countryCode = shortVal || longVal || null;
        }
      }
    }

    // Filter non-NL candidates if country code is present and not NL
    if (countryCode && countryCode.toUpperCase() !== "NL") {
      return null;
    }

    const websiteUrl = this.usableWebsiteUrl(place.websiteUri);

    return {
      kind: "temporary_google",
      placeId: place.id,
      displayName: place.displayName.text.trim(),
      websiteUrl,
      websiteListingStatus: websiteUrl ? "website_listed" : "no_website_listed",
      address: {
        postalCode,
        houseNumber,
        addition,
        street,
        city,
        province,
        countryCode,
      },
      phone: place.nationalPhoneNumber?.trim() || null,
      rating: typeof place.rating === "number" ? place.rating : null,
      reviewCount: typeof place.userRatingCount === "number" ? place.userRatingCount : null,
    };
  }
}
