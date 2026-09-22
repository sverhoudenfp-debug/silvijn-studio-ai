import type {
  TemporaryGoogleCandidate,
  VerifiedKvkIdentity,
  KvkVerificationResult,
  KvkVerifier,
} from "./types";


type KvkScalar = string | number | boolean | null;
interface KvkApiRecord extends Record<string, unknown> {
  kvkNummer?: KvkScalar; kvknumber?: KvkScalar; kvk_nummer?: KvkScalar;
  vestigingsnummer?: KvkScalar; establishmentNumber?: KvkScalar; vestigingsNummer?: KvkScalar;
  naam?: unknown; handelsnaam?: unknown; eersteHandelsnaam?: unknown; statutaireNaam?: unknown;
  type?: unknown; vestigingstype?: unknown; typeVestiging?: unknown; actief?: unknown; active?: unknown;
  indAfgeschermd?: unknown; afgeschermd?: unknown; einddatum?: unknown; datumEinde?: unknown; formeelEinddatum?: unknown;
  handelsnamen?: unknown[]; tradeNames?: unknown[]; adressen?: KvkApiRecord[];
  bezoekadres?: KvkApiRecord; adres?: KvkApiRecord; address?: KvkApiRecord;
  binnenlandsAdres?: KvkApiRecord; adresType?: unknown; straatnaam?: unknown; street?: unknown; straat?: unknown;
  huisnummer?: unknown; houseNumber?: unknown; huisnummerToevoeging?: unknown; huisletter?: unknown;
  toevoegingAdres?: unknown; addition?: unknown; toevoeging?: unknown; postcode?: unknown; postalCode?: unknown;
  plaats?: unknown; city?: unknown; land?: unknown; country?: unknown;
  formeleRegistratiedatum?: KvkApiRecord; formeleRegistratie?: KvkApiRecord; materieleRegistratie?: KvkApiRecord; materieleHistorie?: KvkApiRecord;
  sbiActiviteiten?: KvkApiRecord[]; activiteiten?: KvkApiRecord[]; websites?: unknown[]; webadressen?: unknown[]; urls?: unknown[];
  indNonMailing?: unknown; nonMailing?: unknown; rechtsvorm?: unknown; eigenaar?: KvkApiRecord;
  _embedded?: { basisprofiel?: KvkApiRecord }; embedded?: { basisprofiel?: KvkApiRecord }; basisprofiel?: KvkApiRecord;
  sbiCode?: unknown; code?: unknown; sbiOmschrijving?: unknown; omschrijving?: unknown; description?: unknown; indHoofdactiviteit?: unknown; isMain?: unknown;
  url?: unknown;
}
interface KvkSearchResponse extends KvkApiRecord { totaal?: unknown; totalResults?: unknown; total?: unknown; aantal?: unknown; resultaten?: unknown[]; results?: unknown[]; kandidaten?: unknown[]; }
function record(value: unknown): KvkApiRecord | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as KvkApiRecord : null; }
function text(...inputs: unknown[]): string | undefined { return inputs.find((v): v is string => typeof v === "string"); }
function scalar(...inputs: unknown[]): string | number | undefined { return inputs.find((v): v is string | number => typeof v === "string" || typeof v === "number"); }
function flag(...inputs: unknown[]): string | boolean | undefined { return inputs.find((v): v is string | boolean => typeof v === "string" || typeof v === "boolean"); }

export interface KvkVerifierOptions {
  apiKey?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxSearchResults?: number;
}

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_SEARCH_RESULTS = 100;
const MAX_BYTE_LIMIT = 256 * 1024; // 256 KB limit

interface KvkSearchItem {
  kvkNummer: string;
  vestigingsnummer: string;
  handelsnaam?: string;
  tradeNames?: string[];
  type?: string;
  actief?: boolean | string;
  indAfgeschermd?: boolean | string;
  einddatum?: string | null;
  adres?: {
    type?: string;
    adresType?: string;
    straatnaam?: string;
    huisnummer?: string | number;
    huisnummerToevoeging?: string | null;
    postcode?: string;
    plaats?: string;
    land?: string;
    indAfgeschermd?: boolean | string;
  };
}

export class KvkIdentityVerifier implements KvkVerifier {
  private readonly apiKey: string | undefined;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxSearchResults: number;

  constructor(options: KvkVerifierOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.KVK_API_KEY;
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxSearchResults = options.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS;
  }

  async verify(candidate: TemporaryGoogleCandidate): Promise<KvkVerificationResult> {
    // 1. Check KVK API key configuration
    if (!this.apiKey || this.apiKey.trim() === "") {
      return { status: "technical_error", reason: "KVK_NOT_CONFIGURED" };
    }

    try {
      // 2. Check Candidate Country Code
      const countryCode = candidate.address?.countryCode?.trim().toUpperCase();
      if (countryCode && countryCode !== "NL") {
        return { status: "unmatched", reason: "NOT_NL" };
      }

      // 3. Search KVK via v2/zoeken endpoint
      const searchResult = await this.executeSearch(candidate);
      if ("errorStatus" in searchResult) {
        return searchResult.errorStatus;
      }

      const { items, truncated, missingEvidence } = searchResult;

      if (truncated) {
        return { status: "ambiguous", reason: "SEARCH_LIMIT" };
      }

      if (items.length === 0) {
        if (missingEvidence || this.isInsufficientEvidenceInput(candidate)) {
          return { status: "ambiguous", reason: "INSUFFICIENT_EVIDENCE" };
        }
        return { status: "unmatched", reason: "NO_MATCH" };
      }

      // 4. Evaluate Search Results for Viable Matches
      const evaluation = this.evaluateSearchResults(candidate, items);
      if (evaluation.kind === "ambiguous") {
        return { status: "ambiguous", reason: evaluation.reason };
      }
      if (evaluation.kind === "unmatched") {
        return { status: "unmatched", reason: evaluation.reason };
      }

      const matchedBranch = evaluation.branch;
      if (!/^\d{8}$/.test(matchedBranch.kvkNummer) || !/^\d{12}$/.test(matchedBranch.vestigingsnummer)) {
        return { status: "technical_error", reason: "KVK_INVALID_RESPONSE" };
      }

      // 5. Fetch Full Basisprofiel & Vestigingsprofiel
      const profilesResult = await this.fetchProfiles(
        matchedBranch.kvkNummer,
        matchedBranch.vestigingsnummer
      );

      if ("errorStatus" in profilesResult) {
        return profilesResult.errorStatus;
      }

      const { basis, vestiging } = profilesResult;

      // 6. Profile vs Search Cross-Validation
      const profileKvk = String(basis.kvkNummer || vestiging.kvkNummer || "").padStart(8, "0");
      const profileBranch = String(vestiging.vestigingsnummer || "").padStart(12, "0");
      const matchedKvk = matchedBranch.kvkNummer.padStart(8, "0");
      const matchedBranchNum = matchedBranch.vestigingsnummer.padStart(12, "0");

      if (profileKvk !== matchedKvk || profileBranch !== matchedBranchNum) {
        return { status: "technical_error", reason: "KVK_INVALID_RESPONSE" };
      }

      // 7. Active Status and Visiting Address Check on Detailed Profile
      if (!this.isProfileActive(basis, vestiging)) {
        return { status: "unmatched", reason: "INACTIVE" };
      }

      const detailVisitAddress = this.extractVisitingAddressFromVestiging(vestiging);
      const hidden = detailVisitAddress && (detailVisitAddress.indAfgeschermd === true ||
        (typeof detailVisitAddress.indAfgeschermd === "string" && detailVisitAddress.indAfgeschermd.toLowerCase() === "ja"));
      if (!detailVisitAddress || hidden) return { status: "unmatched", reason: "NO_MATCH" };

      if (!this.matchAddress(candidate.address, detailVisitAddress)) {
        return { status: "unmatched", reason: "NO_MATCH" };
      }

      // 8. Construct VerifiedKvkIdentity
      const identity = this.buildVerifiedIdentity(
        matchedBranch.kvkNummer,
        matchedBranch.vestigingsnummer,
        basis,
        vestiging
      );

      return { status: "verified", identity };
    } catch {
      return { status: "technical_error", reason: "KVK_REQUEST_FAILED" };
    }
  }

  private isInsufficientEvidenceInput(candidate: TemporaryGoogleCandidate): boolean {
    const hasName = Boolean(candidate.displayName && candidate.displayName.trim());
    const hasPostalCode = Boolean(candidate.address?.postalCode && candidate.address.postalCode.trim());
    const hasHouseNumber = Boolean(candidate.address?.houseNumber && candidate.address.houseNumber.trim());
    const hasCity = Boolean(candidate.address?.city && candidate.address.city.trim());

    if (!hasName) return true;
    if (!hasPostalCode || !hasHouseNumber) {
      if (!hasCity) return true;
    }
    return false;
  }

  private async executeSearch(candidate: TemporaryGoogleCandidate): Promise<
    | { items: KvkSearchItem[]; truncated: boolean; missingEvidence?: boolean }
    | { errorStatus: KvkVerificationResult }
  > {
    const postalCode = candidate.address?.postalCode ? this.normalizePostalCode(candidate.address.postalCode) : "";
    const houseNumber = candidate.address?.houseNumber ? candidate.address.houseNumber.trim() : "";
    const addition = candidate.address?.addition ? candidate.address.addition.trim() : "";
    const displayName = candidate.displayName ? candidate.displayName.trim() : "";
    const city = candidate.address?.city ? candidate.address.city.trim() : "";

    let items: KvkSearchItem[] = [];
    let truncated = false;

    if (postalCode && houseNumber) {
      const searchRes = await this.querySearchEndpoint({
        postcode: postalCode,
        huisnummer: houseNumber,
        ...(addition && /^[A-Za-z]$/.test(addition) ? { huisletter: addition } : {}),
      });

      if ("errorStatus" in searchRes) return searchRes;
      items = searchRes.items;
      truncated = searchRes.truncated;

      if (items.length > 0 || truncated) {
        return { items, truncated };
      }
    }

    // Fallback search: handelsnaam + plaats
    if (displayName && city) {
      const fallbackRes = await this.querySearchEndpoint({
        naam: displayName,
        plaats: city,
      });

      if ("errorStatus" in fallbackRes) return fallbackRes;
      return fallbackRes;
    }

    return { items: [], truncated: false, missingEvidence: true };
  }

  private async querySearchEndpoint(queryParams: Record<string, string>): Promise<
    | { items: KvkSearchItem[]; truncated: boolean }
    | { errorStatus: KvkVerificationResult }
  > {
    let page = 1;
    const items: KvkSearchItem[] = [];
    const pageSize = Math.min(this.maxSearchResults, 100);

    while (true) {
      const params = new URLSearchParams({
        ...queryParams,
        pagina: String(page),
        resultatenPerPagina: String(pageSize),
      });

      params.append("type", "hoofdvestiging");
      params.append("type", "nevenvestiging");
      params.set("inclusiefInactieveRegistraties", "false");
      const url = `https://api.kvk.nl/api/v2/zoeken?${params.toString()}`;
      const res = await this.fetchJson<KvkSearchResponse>(url);

      if (!res.ok) return { errorStatus: res.errorStatus };

      const data = res.data;
      if (!data || typeof data !== "object") {
        return { errorStatus: { status: "technical_error", reason: "KVK_INVALID_RESPONSE" } };
      }

      const totalResults = Number(data.totaal ?? data.totalResults ?? data.total ?? data.aantal ?? 0);
      const rawResults = Array.isArray(data.resultaten)
        ? data.resultaten
        : Array.isArray(data.results)
        ? data.results
        : Array.isArray(data.kandidaten)
        ? data.kandidaten
        : [];

      if (totalResults > this.maxSearchResults) {
        return { items: [], truncated: true };
      }

      for (const item of rawResults) {
        const parsed = this.parseSearchItem(item);
        if (parsed) items.push(parsed);
      }

      if (items.length > this.maxSearchResults) {
        return { items: [], truncated: true };
      }

      if (rawResults.length === 0 || items.length >= totalResults || rawResults.length < pageSize) {
        break;
      }

      page++;
      if (page > 10) break;
    }

    return { items, truncated: false };
  }

  private parseSearchItem(input: unknown): KvkSearchItem | null {
    const item = record(input);
    if (!item) return null;

    const kvkNummer = String(item.kvkNummer || item.kvknumber || item.kvk_nummer || "").trim();
    const vestigingsnummer = String(
      item.vestigingsnummer || item.establishmentNumber || item.vestigingsNummer || ""
    ).trim();

    if (!/^\d{8}$/.test(kvkNummer) || !/^\d{12}$/.test(vestigingsnummer)) return null;

    const rawTradeNames: string[] = [];
    if (typeof item.naam === "string") rawTradeNames.push(item.naam);
    if (typeof item.handelsnaam === "string") rawTradeNames.push(item.handelsnaam);
    if (Array.isArray(item.tradeNames)) {
      rawTradeNames.push(...item.tradeNames.filter((t: unknown) => typeof t === "string"));
    }
    if (Array.isArray(item.handelsnamen)) {
      for (const hn of item.handelsnamen) {
        if (typeof hn === "string") rawTradeNames.push(hn);
        else {
          const named = record(hn); const name = named ? text(named.naam, named.handelsnaam) : undefined;
          if (name) rawTradeNames.push(name);
        }
      }
    }

    const type = String(item.type || item.vestigingstype || item.typeVestiging || "").toLowerCase();
    const actief = flag(item.actief, item.active);
    const indAfgeschermd = flag(item.indAfgeschermd, item.afgeschermd);

    const rawAdresContainer = record(item.bezoekadres) ?? record(item.adres) ?? record(item.address) ?? {};
    const rawAdres = record(rawAdresContainer.binnenlandsAdres) ?? rawAdresContainer;

    return {
      kvkNummer,
      vestigingsnummer,
      handelsnaam: typeof item.naam === "string" ? item.naam : typeof item.handelsnaam === "string" ? item.handelsnaam : rawTradeNames[0] || "",
      tradeNames: Array.from(new Set(rawTradeNames.map((s) => s.trim()).filter(Boolean))),
      type,
      actief,
      indAfgeschermd,
      einddatum: text(item.einddatum, item.datumEinde) ?? null,
      adres: {
        type: text(rawAdres.type, rawAdres.adresType),
        straatnaam: text(rawAdres.straatnaam, rawAdres.street, rawAdres.straat),
        huisnummer: scalar(rawAdres.huisnummer, rawAdres.houseNumber),
        huisnummerToevoeging: text(rawAdres.huisnummerToevoeging, rawAdres.huisletter, rawAdres.toevoegingAdres, rawAdres.addition, rawAdres.toevoeging) ?? null,
        postcode: text(rawAdres.postcode, rawAdres.postalCode),
        plaats: text(rawAdres.plaats, rawAdres.city),
        land: text(rawAdres.land, rawAdres.country),
        indAfgeschermd: flag(rawAdres.indAfgeschermd),
      },
    };
  }

  private evaluateSearchResults(
    candidate: TemporaryGoogleCandidate,
    items: KvkSearchItem[]
  ):
    | { kind: "verified"; branch: KvkSearchItem }
    | { kind: "ambiguous"; reason: "MULTIPLE_MATCHES" | "INSUFFICIENT_EVIDENCE" }
    | { kind: "unmatched"; reason: "NO_MATCH" | "INACTIVE" } {
    let inactiveMatchFound = false;
    const viableMatches: KvkSearchItem[] = [];

    for (const item of items) {
      // 1. Type must be hoofdvestiging or nevenvestiging
      const isHoofd = item.type === "hoofdvestiging";
      const isNeven = item.type === "nevenvestiging";
      if (!isHoofd && !isNeven) continue;

      // 2. Active branch check
      const activeValue = typeof item.actief === "string" ? item.actief.toLowerCase() : item.actief;
      const isActive = (activeValue === true || activeValue === "ja" || activeValue === "yes") && !item.einddatum;

      // 3. Trade name check
      const candidateName = candidate.displayName || "";
      const tradeNames = item.tradeNames && item.tradeNames.length > 0
        ? item.tradeNames
        : item.handelsnaam
        ? [item.handelsnaam]
        : [];

      const nameMatched = this.matchTradeName(candidateName, tradeNames);
      if (!nameMatched) continue;

      // 4. Visiting address check
      const visitAddress = item.adres;
      if (!visitAddress) continue;

      const isAddressHidden =
        item.indAfgeschermd === true ||
        item.indAfgeschermd === "ja" ||
        item.indAfgeschermd === "Ja" ||
        visitAddress.indAfgeschermd === true ||
        visitAddress.indAfgeschermd === "ja" ||
        visitAddress.indAfgeschermd === "Ja";

      if (isAddressHidden) continue;

      const isCorr =
        visitAddress.type === "correspondentieadres" ||
        visitAddress.adresType === "correspondentieadres";
      if (isCorr) continue;

      const addressMatched = this.matchAddress(candidate.address, visitAddress);
      if (!addressMatched) continue;

      if (!isActive) {
        inactiveMatchFound = true;
        continue;
      }

      viableMatches.push(item);
    }

    if (viableMatches.length === 1) {
      return { kind: "verified", branch: viableMatches[0] };
    }

    if (viableMatches.length > 1) {
      return { kind: "ambiguous", reason: "MULTIPLE_MATCHES" };
    }

    if (inactiveMatchFound) {
      return { kind: "unmatched", reason: "INACTIVE" };
    }

    return { kind: "unmatched", reason: "NO_MATCH" };
  }

  private matchTradeName(candidateName: string, kvkTradeNames: string[]): boolean {
    const normCandidate = this.normalizeName(candidateName);
    if (!normCandidate) return false;

    for (const tn of kvkTradeNames) {
      const normKvk = this.normalizeName(tn);
      if (normKvk === normCandidate) return true;
    }
    return false;
  }

  private normalizeName(name: string): string {
    if (!name) return "";
    return name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private matchAddress(
    candidateAddr: TemporaryGoogleCandidate["address"],
    kvkAddr: {
      postcode?: string;
      huisnummer?: string | number;
      huisnummerToevoeging?: string | null;
      indAfgeschermd?: boolean | string;
    }
  ): boolean {
    if (
      kvkAddr.indAfgeschermd === true ||
      kvkAddr.indAfgeschermd === "ja" ||
      kvkAddr.indAfgeschermd === "Ja"
    ) {
      return false;
    }

    const candPc = candidateAddr?.postalCode ? this.normalizePostalCode(candidateAddr.postalCode) : "";
    const kvkPc = kvkAddr?.postcode ? this.normalizePostalCode(kvkAddr.postcode) : "";
    if (candPc !== kvkPc) return false;

    const candHn = candidateAddr?.houseNumber ? this.normalizeHouseNumber(candidateAddr.houseNumber) : "";
    const kvkHn = kvkAddr?.huisnummer !== undefined && kvkAddr?.huisnummer !== null
      ? this.normalizeHouseNumber(kvkAddr.huisnummer)
      : "";
    if (candHn !== kvkHn) return false;

    const candAdd = candidateAddr?.addition ? this.normalizeAddition(candidateAddr.addition) : "";
    const kvkAdd = kvkAddr?.huisnummerToevoeging ? this.normalizeAddition(kvkAddr.huisnummerToevoeging) : "";
    if (candAdd !== kvkAdd) return false;

    return true;
  }

  private normalizePostalCode(pc: string): string {
    return pc.replace(/\s+/g, "").toUpperCase();
  }

  private normalizeHouseNumber(hn: string | number): string {
    return String(hn).trim();
  }

  private normalizeAddition(add: string): string {
    return add.trim().toLowerCase().replace(/[\s\.-]+/g, "");
  }

  private async fetchProfiles(
    kvkNummer: string,
    vestigingsnummer: string
  ): Promise<
    | { basis: KvkApiRecord; vestiging: KvkApiRecord }
    | { errorStatus: KvkVerificationResult }
  > {
    const vestigingUrl = `https://api.kvk.nl/api/v1/vestigingsprofielen/${vestigingsnummer}`;
    const vestigingRes = await this.fetchJson<KvkApiRecord>(vestigingUrl);
    if (!vestigingRes.ok) return vestigingRes;

    const vestiging = vestigingRes.data;
    if (!vestiging || typeof vestiging !== "object") {
      return { errorStatus: { status: "technical_error", reason: "KVK_INVALID_RESPONSE" } };
    }

    let basis = vestiging._embedded?.basisprofiel || vestiging.embedded?.basisprofiel || vestiging.basisprofiel;

    if (!basis) {
      const basisUrl = `https://api.kvk.nl/api/v1/basisprofielen/${kvkNummer}`;
      const basisRes = await this.fetchJson<KvkApiRecord>(basisUrl);
      if (!basisRes.ok) return basisRes;
      basis = basisRes.data;
    }

    if (!basis || typeof basis !== "object") {
      return { errorStatus: { status: "technical_error", reason: "KVK_INVALID_RESPONSE" } };
    }

    return { basis, vestiging };
  }

  private isProfileActive(basis: KvkApiRecord, vestiging: KvkApiRecord): boolean {
    const hasEnded = (record: KvkApiRecord): boolean => Boolean(
      record?.einddatum || record?.datumEinde || record?.formeelEinddatum ||
      record?.formeleRegistratiedatum?.einddatum || record?.formeleRegistratie?.einddatum ||
      record?.materieleRegistratie?.einddatum || record?.materieleHistorie?.einddatum
    );
    const activeValue = typeof vestiging.actief === "string" ? vestiging.actief.toLowerCase() : vestiging.actief;
    if (activeValue === false || activeValue === "nee" || activeValue === "no") return false;
    return !hasEnded(vestiging) && !hasEnded(basis);
  }

  private extractVisitingAddressFromVestiging(vestiging: KvkApiRecord): {
    postcode?: string;
    huisnummer?: string | number;
    huisnummerToevoeging?: string | null;
    indAfgeschermd?: boolean | string;
    straatnaam?: string;
    plaats?: string;
  } | null {
    const rawAdres = record(vestiging.bezoekadres) ?? record(vestiging.adres) ?? record(vestiging.address);
    if (rawAdres) {
      return {
        postcode: text(rawAdres.postcode, rawAdres.postalCode),
        huisnummer: scalar(rawAdres.huisnummer, rawAdres.houseNumber),
        huisnummerToevoeging: text(rawAdres.huisnummerToevoeging, rawAdres.huisletter, rawAdres.toevoegingAdres, rawAdres.addition, rawAdres.toevoeging) ?? null,
        indAfgeschermd: flag(rawAdres.indAfgeschermd),
        straatnaam: text(rawAdres.straatnaam, rawAdres.street, rawAdres.straat),
        plaats: text(rawAdres.plaats, rawAdres.city),
      };
    }

    if (Array.isArray(vestiging.adressen)) {
      const visit = vestiging.adressen.find(
        (a: KvkApiRecord) =>
          a.type === "bezoekadres" ||
          a.adresType === "bezoekadres" ||
          (!a.type && !a.adresType)
      );
      if (visit) {
        return {
          postcode: text(visit.postcode, visit.postalCode),
          huisnummer: scalar(visit.huisnummer, visit.houseNumber),
          huisnummerToevoeging: text(visit.huisnummerToevoeging, visit.huisletter, visit.toevoegingAdres, visit.addition, visit.toevoeging) ?? null,
          indAfgeschermd: flag(visit.indAfgeschermd),
          straatnaam: text(visit.straatnaam, visit.street, visit.straat),
          plaats: text(visit.plaats, visit.city),
        };
      }
    }

    return null;
  }

  private buildVerifiedIdentity(
    kvkNummer: string,
    vestigingsnummer: string,
    basis: KvkApiRecord,
    vestiging: KvkApiRecord
  ): VerifiedKvkIdentity {
    const rawTradeNames: string[] = [];
    const collectNames = (items: unknown) => {
      if (!Array.isArray(items)) return;
      for (const hn of items) {
        if (typeof hn === "string") rawTradeNames.push(hn);
        else if (hn && typeof hn === "object" && typeof (hn as KvkApiRecord).naam === "string") rawTradeNames.push((hn as KvkApiRecord).naam as string);
        else if (hn && typeof hn === "object" && typeof (hn as KvkApiRecord).handelsnaam === "string") rawTradeNames.push((hn as KvkApiRecord).handelsnaam as string);
      }
    };
    if (typeof vestiging.eersteHandelsnaam === "string") rawTradeNames.push(vestiging.eersteHandelsnaam);
    if (typeof vestiging.statutaireNaam === "string") rawTradeNames.push(vestiging.statutaireNaam);
    if (typeof vestiging.handelsnaam === "string") rawTradeNames.push(vestiging.handelsnaam);
    if (typeof basis.statutaireNaam === "string") rawTradeNames.push(basis.statutaireNaam);
    if (typeof basis.naam === "string") rawTradeNames.push(basis.naam);

    collectNames(vestiging.handelsnamen);
    collectNames(basis.handelsnamen);

    const tradeNames = Array.from(new Set(rawTradeNames.map((s) => s.trim()).filter(Boolean)));
    const businessName = text(vestiging.eersteHandelsnaam, vestiging.handelsnaam, basis.statutaireNaam, basis.naam, tradeNames[0]) ?? "";

    const visitAddr = this.extractVisitingAddressFromVestiging(vestiging);
    const street = visitAddr?.straatnaam || "";
    const houseNumber = visitAddr?.huisnummer !== undefined ? String(visitAddr.huisnummer) : "";
    const addition = visitAddr?.huisnummerToevoeging ? String(visitAddr.huisnummerToevoeging) : null;
    const postalCode = visitAddr?.postcode ? this.normalizePostalCode(visitAddr.postcode) : "";
    const city = visitAddr?.plaats || "";

    const activities: { code: string; description: string; isMain: boolean }[] = [];
    const rawSbi = vestiging.sbiActiviteiten || vestiging.activiteiten || basis.sbiActiviteiten || [];
    if (Array.isArray(rawSbi)) {
      for (const act of rawSbi) {
        if (!act || typeof act !== "object") continue;
        const code = String(act.sbiCode || act.code || "").trim();
        const description = String(act.sbiOmschrijving || act.omschrijving || act.description || "").trim();
        const isMain = act.indHoofdactiviteit === true || (typeof act.indHoofdactiviteit === "string" && act.indHoofdactiviteit.toLowerCase() === "ja") || act.isMain === true;
        if (code || description) {
          activities.push({ code, description, isMain });
        }
      }
    }

    const rawWebsites: string[] = [];
    const siteSources = [vestiging.webadressen, vestiging.websites, vestiging.urls, basis.webadressen, basis.websites];
    for (const src of siteSources) {
      if (Array.isArray(src)) {
        for (const w of src) {
          if (typeof w === "string" && w.trim()) rawWebsites.push(w.trim());
          else { const site = record(w); if (site && typeof site.url === "string" && site.url.trim()) rawWebsites.push(site.url.trim()); }
        }
      }
    }
    const websites = Array.from(new Set(rawWebsites));

    const rawNonMailing = basis.indNonMailing ?? basis.nonMailing ?? vestiging.indNonMailing ?? vestiging.nonMailing;
    let nonMailing: boolean | null = null;
    if (rawNonMailing === true || (typeof rawNonMailing === "string" && rawNonMailing.toLowerCase() === "ja")) nonMailing = true;
    else if (rawNonMailing === false || (typeof rawNonMailing === "string" && rawNonMailing.toLowerCase() === "nee")) nonMailing = false;

    let legalForm: string | null = null;
    const rawLegalForm = basis.rechtsvorm ?? basis.eigenaar?.rechtsvorm;
    if (typeof rawLegalForm === "string") legalForm = rawLegalForm;
    else { const form = record(rawLegalForm); if (form && typeof form.omschrijving === "string") legalForm = form.omschrijving; }

    return {
      kind: "verified_kvk",
      kvkNumber: String(kvkNummer),
      establishmentNumber: String(vestigingsnummer),
      businessName,
      tradeNames,
      address: {
        street,
        houseNumber,
        addition,
        postalCode,
        city,
        country: "NL",
      },
      activities,
      websites,
      nonMailing,
      legalForm,
      provenance: {
        source: "kvk",
        fetchedAt: new Date().toISOString(),
        basisProfile: `https://api.kvk.nl/api/v1/basisprofielen/${kvkNummer}`,
        establishmentProfile: `https://api.kvk.nl/api/v1/vestigingsprofielen/${vestigingsnummer}`,
        matchRule: "active_trade_name_and_visit_address_v1",
      },
    };
  }

  private async fetchJson<T>(
    url: string
  ): Promise<{ ok: true; data: T } | { ok: false; errorStatus: KvkVerificationResult }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(url, {
        method: "GET",
        headers: {
          apikey: this.apiKey!,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          ok: false,
          errorStatus: { status: "technical_error", reason: "KVK_REQUEST_FAILED" },
        };
      }

      const data = await this.safeParseJson(response);
      return { ok: true, data: data as T };
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "KVK_INVALID_RESPONSE") {
        return {
          ok: false,
          errorStatus: { status: "technical_error", reason: "KVK_INVALID_RESPONSE" },
        };
      }
      return {
        ok: false,
        errorStatus: { status: "technical_error", reason: "KVK_REQUEST_FAILED" },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async safeParseJson(response: Response): Promise<unknown> {
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_BYTE_LIMIT) {
      throw new Error("KVK_INVALID_RESPONSE");
    }

    try {
      if (response.body && typeof response.body.getReader === "function") {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            if (totalBytes > MAX_BYTE_LIMIT) {
              try {
                await reader.cancel();
              } catch {}
              throw new Error("KVK_INVALID_RESPONSE");
            }
            chunks.push(value);
          }
        }

        const buffer = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          buffer.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const text = new TextDecoder().decode(buffer);
        return JSON.parse(text);
      } else {
        const text = await response.text();
        if (new TextEncoder().encode(text).length > MAX_BYTE_LIMIT) {
          throw new Error("KVK_INVALID_RESPONSE");
        }
        return JSON.parse(text);
      }
    } catch {
      throw new Error("KVK_INVALID_RESPONSE");
    }
  }
}
