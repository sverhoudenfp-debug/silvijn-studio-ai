import { test } from "node:test";
import assert from "node:assert/strict";

import {
  acceptCandidate,
  buildImagePrompt,
  defaultImageSources,
  falSource,
  mentionsPeople,
  openverseSource,
  pixabaySource,
  providerConfigFromEnv,
  resolveSlotImage,
  resolveSlotImageWithTrail,
  scoreCandidate,
  seedToInt,
  type Fetcher,
  type ImageCandidate,
  type ImageRequest,
  type ImageSource,
} from "../lib/websites/media/image-source";

/**
 * FASE 3 — BEELDPIPELINE.
 *
 * Deze tests bewaken de poorten, niet de esthetiek: een bron zonder
 * commercieel recht komt er niet door, een gezicht zonder toestemming komt er
 * niet door, en zonder bron blijft het antwoord "geen beeld" in plaats van
 * een verzonnen foto.
 */

const request: ImageRequest = {
  slot: "hero",
  industry: "hovenier",
  city: "Utrecht",
  mood: ["natural", "ambachtelijk"],
  aspect: "wide",
  alt: "Tuin met vaste beplanting",
  seed: "golden-hovenier",
};

function candidate(overrides: Partial<ImageCandidate> = {}): ImageCandidate {
  return {
    sourceImageId: "1",
    url: "https://example.test/a.jpg",
    width: 2400,
    height: 1350,
    description: "garden path with clipped hedges",
    tags: ["garden", "hedge"],
    hasRecognizablePeople: false,
    license: {
      provider: "test",
      sourceId: "pixabay",
      licenseName: "test-licentie",
      commercialUse: true,
      attributionRequired: false,
      attributionText: null,
      evidenceUrl: "https://example.test/licentie",
    },
    ...overrides,
  };
}

function source(id: ImageSource["id"], candidates: readonly ImageCandidate[], available = true): ImageSource {
  return {
    id,
    label: id,
    isAvailable: () => available,
    find: async () => candidates,
  };
}

const noFetch: Fetcher = async () => {
  throw new Error("deze test mag het netwerk niet op");
};

test("poort: een licentie zonder commercieel recht wordt geweigerd", () => {
  const verdict = acceptCandidate(candidate({ license: { ...candidate().license, commercialUse: false, licenseName: "CC BY-NC" } }), request);
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /commercieel recht/);
});

test("poort: attributieplicht zonder naamsvermelding wordt geweigerd", () => {
  const verdict = acceptCandidate(candidate({ license: { ...candidate().license, attributionRequired: true, attributionText: null } }), request);
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /attributie/);
});

test("poort: herkenbaar persoon in team/over-ons/realisaties vereist toestemming", () => {
  const aboutRequest: ImageRequest = { ...request, slot: "about" };
  const withPerson = candidate({ hasRecognizablePeople: true, description: "team portrait", tags: ["team"] });
  assert.equal(acceptCandidate(withPerson, aboutRequest).accepted, false);
  assert.match(acceptCandidate(withPerson, aboutRequest).reason, /toestemming/);
  // Met aantoonbare toestemming mag het veld open.
  assert.equal(acceptCandidate(withPerson, { ...aboutRequest, consentConfirmed: true }).accepted, true);
});

test("poort: ook de hero blijft mensvrij zonder toestemming", () => {
  const withWorker = candidate({ description: "gardener at work", tags: ["worker"] });
  assert.equal(acceptCandidate(withWorker, request).accepted, false);
});

test("poort: persoonsherkenning werkt op woordgrenzen, niet op losse letters", () => {
  assert.equal(mentionsPeople("garden maintenance"), false);
  assert.equal(mentionsPeople("team of gardeners"), true);
  assert.equal(mentionsPeople("woman pruning"), true);
  // 'men' mag niet afgaan op 'maintenance' of 'women' op 'womenswear' achtige woorden
  assert.equal(mentionsPeople("ornamental grasses"), false);
});

test("resolver: kiest de eerste bron die een geldige kandidaat levert", async () => {
  const result = await resolveSlotImage(request, {
    sources: [
      source("generated", [], false),
      source("pixabay", [candidate({ sourceImageId: "b" }), candidate({ sourceImageId: "a" })]),
    ],
    fetcher: noFetch,
  });
  assert.ok(result);
  assert.equal(result.sourceId, "pixabay");
  assert.equal(result.candidate.sourceImageId, "a", "deterministisch op id, niet op API-volgorde");
  assert.ok(result.trail.some((line) => line.includes("niet beschikbaar")));
});

test("resolver: valt door naar de volgende bron bij een API-fout", async () => {
  const failing: ImageSource = { id: "generated", label: "fal", isAvailable: () => true, find: async () => { throw new Error("fal HTTP 402"); } };
  const result = await resolveSlotImage(request, {
    sources: [failing, source("pixabay", [candidate()])],
    fetcher: noFetch,
  });
  assert.ok(result);
  assert.equal(result.sourceId, "pixabay");
  assert.ok(result.trail.some((line) => line.includes("fal HTTP 402")));
});

test("resolver: geen bron betekent geen beeld (placeholder-pad blijft)", async () => {
  const result = await resolveSlotImage(request, {
    sources: [source("generated", [candidate({ hasRecognizablePeople: true })])],
    fetcher: noFetch,
  });
  assert.equal(result, null);
});

test("resolver: dezelfde opdracht geeft dezelfde keuze", async () => {
  const sources = [source("pixabay" as const, [candidate({ sourceImageId: "x" }), candidate({ sourceImageId: "y" }), candidate({ sourceImageId: "z" })])];
  const first = await resolveSlotImage(request, { sources, fetcher: noFetch });
  const second = await resolveSlotImage(request, { sources, fetcher: noFetch });
  assert.equal(first?.candidate.sourceImageId, second?.candidate.sourceImageId);
});

test("prompt: beschrijft een lege scène en stuurt op fotografie, niet op 'geen mensen'", () => {
  const prompt = buildImagePrompt(request);
  assert.match(prompt, /hovenier/);
  assert.match(prompt, /Utrecht/);
  assert.match(prompt, /Unpopulated scene/);
  assert.match(prompt, /24mm/);
  // FLUX.2 kent geen negative prompt: een kale "no people"-opdracht werkt averechts.
  assert.doesNotMatch(prompt, /^no people/i);
  assert.doesNotMatch(prompt, /negative prompt/i);
});

test("score: liggend en groot wint van een vierkant-uitsnede", () => {
  const wide = scoreCandidate(candidate({ width: 2400, height: 1200 }), request);
  const square = scoreCandidate(candidate({ width: 1200, height: 1200 }), request);
  assert.ok(wide > square);
});

test("config: ontbrekende sleutels betekenen 'bron niet beschikbaar', niet 'bron stuk'", () => {
  const config = providerConfigFromEnv({});
  assert.equal(config.falKey, null);
  const sources = defaultImageSources(config);
  assert.deepEqual(sources.map((s) => s.isAvailable()), [false, false, true], "Openverse werkt zonder eigen sleutel");
  assert.equal(falSource(config).isAvailable(), false);
  assert.equal(pixabaySource(config).isAvailable(), false);
  assert.equal(openverseSource(config).isAvailable(), true);
});

test("fal: gebruikt de FLUX.2-endpoint met API-key en levert commerciële licentie metadata", async () => {
  const config = providerConfigFromEnv({ FAL_KEY: "test-key" });
  const seen: { url?: string; init?: { headers?: Record<string, string>; body?: string } } = {};
  const fetcher: Fetcher = async (url, init) => {
    seen.url = url;
    seen.init = init;
    return { ok: true, status: 200, json: async () => ({ images: [{ url: "https://fal.test/out.jpg", width: 1344, height: 768 }] }) };
  };
  const found = await falSource(config).find(request, fetcher);
  assert.equal(found.length, 1);
  assert.equal(seen?.url, "https://fal.run/fal-ai/flux-2-pro");
  assert.match(seen?.init?.headers?.authorization ?? "", /^Key test-key$/);
  assert.ok(found[0].license.commercialUse);
  assert.equal(found[0].license.attributionRequired, false);
  assert.equal(found[0].hasRecognizablePeople, false);
  // Seed is deterministisch, dus een herhaling levert hetzelfde id.
  assert.equal(found[0].sourceImageId, `flux2-${seedToInt(request.seed)}`);
});

test("pixabay: filtert personen al bij de bron en cachet per query", async () => {
  const config = providerConfigFromEnv({ PIXABAY_API_KEY: "p" });
  const cache = new Map<string, readonly ImageCandidate[]>();
  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ hits: [
        { id: 2, tags: "garden, team, portrait", largeImageURL: "https://pix.test/2.jpg", imageWidth: 2000, imageHeight: 1300 },
        { id: 1, tags: "garden, hedge, path", largeImageURL: "https://pix.test/1.jpg", imageWidth: 2000, imageHeight: 1300 },
      ] }),
    };
  };
  const first = await pixabaySource(config, cache).find(request, fetcher);
  assert.equal(first.find((c) => c.sourceImageId === "2")?.hasRecognizablePeople, true);
  assert.equal(first.find((c) => c.sourceImageId === "1")?.hasRecognizablePeople, false);
  await pixabaySource(config, cache).find(request, fetcher);
  assert.equal(calls, 1, "tweede keer komt uit de cache (24u-regel van Pixabay)");
});

test("openverse: alleen CC0 komt erdoor, CC BY en NC worden niet eens kandidaat", async () => {
  const config = providerConfigFromEnv({});
  const fetcher: Fetcher = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ results: [
      { id: "a", license: "cc0", title: "garden", url: "https://ov.test/a.jpg", width: 2000, height: 1200, tags: [{ name: "garden" }] },
      { id: "b", license: "by", title: "garden", url: "https://ov.test/b.jpg", width: 2000, height: 1200 },
      { id: "c", license: "by-nc", title: "garden", url: "https://ov.test/c.jpg", width: 2000, height: 1200 },
    ] }),
  });
  const found = await openverseSource(config).find(request, fetcher);
  assert.deepEqual(found.map((c) => c.sourceImageId), ["a"]);
});

test("resolver: het spoor blijft zichtbaar als een bron faalt (saldo, sleutel, rate limit)", async () => {
  const config = providerConfigFromEnv({ FAL_KEY: "test-key" });
  const bron = { ...falSource(config), find: async () => { throw new Error("fal HTTP 403 — User is locked. Reason: TOP_UP."); } };
  const verzoek = {
    slot: "hero" as const,
    industry: "hoveniersbedrijf",
    city: "Utrecht",
    mood: ["natural"],
    aspect: "wide" as const,
    alt: null,
    seed: "test-seed",
  };
  const uitkomst = await resolveSlotImageWithTrail(verzoek, { sources: [bron], fetcher: async () => { throw new Error("geen netwerk in tests"); } });
  assert.equal(uitkomst.image, null);
  assert.match(uitkomst.trail.join(" | "), /fal HTTP 403/);
  assert.match(uitkomst.trail.join(" | "), /TOP_UP/);
});

test("resolver: resolveSlotImage geeft nog steeds alleen het beeld terug", async () => {
  const config = providerConfigFromEnv({ FAL_KEY: "test-key" });
  const bron = { ...falSource(config), find: async () => { throw new Error("fal HTTP 403"); } };
  const uitkomst = await resolveSlotImage(
    { slot: "hero", industry: "hoveniersbedrijf", city: null, mood: [], aspect: "wide", alt: null, seed: "s" },
    { sources: [bron], fetcher: async () => { throw new Error("geen netwerk in tests"); } },
  );
  assert.equal(uitkomst, null);
});
