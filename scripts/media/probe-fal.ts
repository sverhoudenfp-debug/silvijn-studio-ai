/**
 * W9-probe: één testgeneratie via de productiepipeline (FLUX.2 [pro] / fal.ai).
 * Logt nooit de key. Schrijft het beeld naar visual-output/images/probe/.
 *
 *   npx tsx scripts/media/probe-fal.ts --slot hero
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  falSource,
  providerConfigFromEnv,
  type Fetcher,
  type ImageRequest,
} from "../../lib/websites/media/image-source";

const realFetcher: Fetcher = async (url, init) => {
  const response = await fetch(url, init as RequestInit);
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json(),
    text: () => response.text(),
    arrayBuffer: () => response.arrayBuffer(),
  } as never;
};

const slotIndex = process.argv.indexOf("--slot");
const slot = (slotIndex > -1 ? process.argv[slotIndex + 1] : "hero") as ImageRequest["slot"];

const config = providerConfigFromEnv(process.env);
const source = falSource(config);
console.log("provider:", source.label, "| key aanwezig:", source.isAvailable());

const request: ImageRequest = {
  slot,
  industry: "hoveniersbedrijf en tuinontwerp",
  city: "Utrecht",
  mood: ["natural", "ambachtelijk", "hoogwaardig"],
  aspect: slot === "hero" ? "wide" : "landscape",
  seed: `veld-en-vorm-${slot}`,
} as unknown as ImageRequest;

(async () => {
  const started = Date.now();
  const candidates = await source.find(request, realFetcher);
  if (candidates.length === 0) {
    console.log("geen kandidaten terug");
    return;
  }
  const candidate = candidates[0];
  console.log("kandidaat:", candidate.width + "x" + candidate.height, "|", candidate.license.provider);
  const response = await fetch(candidate.url);
  const bytes = Buffer.from(await response.arrayBuffer());
  const dir = join(process.cwd(), "visual-output/images/probe");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slot}.jpg`);
  writeFileSync(file, bytes);
  console.log("opgeslagen:", file, Math.round(bytes.length / 1024) + " kB", "|", ((Date.now() - started) / 1000).toFixed(1) + "s");
  console.log("prompt:", candidate.description.slice(0, 220));
})();
