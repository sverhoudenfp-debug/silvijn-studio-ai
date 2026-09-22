import { test } from "node:test";
import assert from "node:assert/strict";
import { KvkIdentityVerifier } from "../lib/discovery/identity/kvk-verifier";
import type { TemporaryGoogleCandidate } from "../lib/discovery/identity/types";

const candidate: TemporaryGoogleCandidate = { kind: "temporary_google", placeId: "official_contract", displayName: "Jansen & Zonen B.V.", address: { postalCode: "1012 AB", houseNumber: "10", addition: "A", street: "Dam", city: "Amsterdam", countryCode: "NL" } };

test("official KVK field names and nested address shape verify without undocumented search parameters", async () => {
  const requests: { url: URL; headers: Headers }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input.toString()); requests.push({ url, headers: new Headers(init?.headers) });
    if (url.pathname === "/api/v2/zoeken") return Response.json({ pagina: 1, resultatenPerPagina: 100, totaal: 1, resultaten: [{
      kvkNummer: "12345678", vestigingsnummer: "000012345678", naam: "Jansen & Zonen B.V.", type: "hoofdvestiging", actief: "Ja",
      adres: { type: "bezoekadres", binnenlandsAdres: { straatnaam: "Dam", huisnummer: 10, huisletter: "A", postcode: "1012AB", plaats: "Amsterdam" } },
    }] });
    if (url.pathname.endsWith("/vestigingsprofielen/000012345678")) return Response.json({
      kvkNummer: "12345678", vestigingsnummer: "000012345678", handelsnamen: [{ naam: "Jansen & Zonen B.V." }],
      formeleRegistratiedatum: { aanvangsdatum: "2020-01-01" }, materieleRegistratie: { aanvangsdatum: "2020-01-01" },
      adressen: [{ type: "bezoekadres", indAfgeschermd: "Nee", straatnaam: "Dam", huisnummer: 10, huisletter: "A", postcode: "1012AB", plaats: "Amsterdam" }],
      websites: ["https://jansen.example"], sbiActiviteiten: [{ sbiCode: "4334", sbiOmschrijving: "Schilderen", indHoofdactiviteit: "Ja" }], indNonMailing: "Nee",
    });
    if (url.pathname.endsWith("/basisprofielen/12345678")) return Response.json({
      kvkNummer: "12345678", naam: "Jansen & Zonen B.V.", handelsnamen: [{ naam: "Jansen & Zonen B.V." }], eigenaar: { rechtsvorm: "Eenmanszaak" },
    });
    return new Response("", { status: 404 });
  };
  const result = await new KvkIdentityVerifier({ apiKey: "never-sent-in-url", fetcher }).verify(candidate);
  assert.equal(result.status, "verified");
  assert.equal(requests.length, 3);
  const search = requests[0].url;
  assert.equal(search.searchParams.get("postcode"), "1012AB"); assert.equal(search.searchParams.get("huisnummer"), "10"); assert.equal(search.searchParams.get("huisletter"), "A");
  assert.equal(search.searchParams.has("handelsnaam"), false); assert.equal(search.searchParams.has("huisnummerToevoeging"), false);
  assert.equal(search.searchParams.get("pagina"), "1"); assert.equal(search.searchParams.get("resultatenPerPagina"), "100");
  assert.deepEqual(search.searchParams.getAll("type"), ["hoofdvestiging", "nevenvestiging"]); assert.equal(search.searchParams.get("inclusiefInactieveRegistraties"), "false");
  assert.equal(requests.every(r => r.headers.get("apikey") === "never-sent-in-url" && !r.url.href.includes("never-sent")), true);
  if (result.status === "verified") {
    assert.equal(result.identity.businessName, "Jansen & Zonen B.V."); assert.equal(result.identity.address.addition, "A");
    assert.deepEqual(result.identity.websites, ["https://jansen.example"]); assert.deepEqual(result.identity.activities, [{ code: "4334", description: "Schilderen", isMain: true }]);
  }
});

test("name and city fallback uses official naam parameter", async () => {
  const urls: URL[] = [];
  const fetcher: typeof fetch = async (input) => { const url = new URL(input.toString()); urls.push(url); return Response.json({ pagina: 1, resultatenPerPagina: 100, totaal: 0, resultaten: [] }); };
  const sparse = { ...candidate, address: { ...candidate.address, postalCode: null, houseNumber: null, addition: null } };
  const result = await new KvkIdentityVerifier({ apiKey: "test", fetcher }).verify(sparse);
  assert.equal(result.status, "unmatched"); assert.equal(urls[0].searchParams.get("naam"), candidate.displayName); assert.equal(urls[0].searchParams.get("plaats"), "Amsterdam");
  assert.equal(urls[0].searchParams.has("handelsnaam"), false);
});

test("missing or unknown active status is never accepted", async () => {
  for (const actief of [undefined, "Onbekend"]) {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(input.toString());
      if (url.pathname === "/api/v2/zoeken") return Response.json({ totaal: 1, resultaten: [{ kvkNummer: "12345678", vestigingsnummer: "000012345678", naam: candidate.displayName, type: "hoofdvestiging", ...(actief ? { actief } : {}), adres: { binnenlandsAdres: { postcode: "1012AB", huisnummer: 10, huisletter: "A" } } }] });
      throw new Error("profiles must not be requested");
    };
    assert.deepEqual(await new KvkIdentityVerifier({ apiKey: "test", fetcher }).verify(candidate), { status: "unmatched", reason: "INACTIVE" });
  }
});
