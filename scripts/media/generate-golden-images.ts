/**
 * FASE 3b — echte beelden voor de gouden fixture via de productiepipeline.
 *
 * Gebruikt exact dezelfde code als de app (providerConfigFromEnv,
 * defaultImageSources, resolveSlotImage), inclusief de poorten. Schrijft de
 * uitkomst naar visual-output/images/ zodat de meetlat ze meeneemt.
 *
 *   npx tsx scripts/media/generate-golden-images.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  defaultImageSources,
  providerConfigFromEnv,
  resolveSlotImageWithTrail,
  type Fetcher,
  type ImageRequest,
} from "../../lib/websites/media/image-source";

const OUT = join(process.cwd(), "visual-output/images");

/** .env-bestanden laden zonder dotenv: KEY=waarde, commentaar negeren. */
function loadEnvFiles() {
  for (const path of [join(process.cwd(), ".env.local"), "/app/.agents/.env"]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const value = match[2].replace(/^["']|["']$/g, "");
      if (value && !process.env[match[1]]) process.env[match[1]] = value;
    }
  }
}

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

/**
 * De acht beelden van de hovenierssite. Volgorde is beleid: hero en about zijn
 * dragend, de vier dienstkaarten krijgen elk een eigen detailbeeld en de
 * galerij krijgt twee projectbeelden. Geen enkel slot wordt twee keer gevuld
 * met dezelfde foto.
 */
const slots = [
  { key: "hero", slot: "hero", aspect: "wide", target: 1600, alt: "Tuin met vaste beplanting en grindpad" },
  { key: "about", slot: "about", aspect: "landscape", target: 1100, alt: "Werkplaats met gereedschap en materialen" },
  { key: "services_1", slot: "services", aspect: "landscape", target: 900, alt: "Beplantingsplan met vaste planten" },
  { key: "services_2", slot: "services", aspect: "landscape", target: 900, alt: "Aanleg van een terras met natuursteen" },
  { key: "services_3", slot: "services", aspect: "landscape", target: 900, alt: "Onderhoud van een haag en gazon" },
  { key: "services_4", slot: "services", aspect: "landscape", target: 900, alt: "Snoeien van vaste beplanting" },
  { key: "gallery_1", slot: "gallery", aspect: "square", target: 900, alt: "Afgeronde tuin in late zomer" },
  { key: "gallery_2", slot: "gallery", aspect: "square", target: 900, alt: "Detail van een gazonrand langs grind" },
] as const;

/** $0,03 voor de eerste MP, $0,015 per extra MP (FLUX.2 [pro], fal.ai). */
function costFor(width: number, height: number) {
  const mp = (width * height) / 1_000_000;
  return 0.03 + Math.max(0, mp - 1) * 0.015;
}

async function main() {
  loadEnvFiles();
  mkdirSync(OUT, { recursive: true });

  const config = providerConfigFromEnv(process.env);
  if (!config.falKey) throw new Error("FAL_KEY ontbreekt (zet hem in .agents/.env of .env.local)");

  const sources = defaultImageSources(config);
  const metaPath = join(OUT, "meta.json");
  const meta = existsSync(metaPath) ? (JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>) : {};

  const only = (process.env.MEDIA_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  let totalCost = 0;
  for (const entry of slots) {
    if (only.length && !only.includes(entry.key)) continue;
    const request: ImageRequest = {
      slot: entry.slot,
      industry: "hoveniersbedrijf",
      city: "Utrecht",
      mood: ["natural", "ambachtelijk", "rustig"],
      aspect: entry.aspect,
      alt: entry.alt,
      seed: `golden-hovenier-${entry.key}-v1`,
    };

    const { image: resolved, trail } = await resolveSlotImageWithTrail(request, { sources, fetcher: realFetcher });
    if (!resolved) {
      console.log(`${entry.slot}: GEWEIGERD of geen bron`);
      for (const line of trail) console.log(`  ${line}`);
      continue;
    }
    console.log(`${entry.slot}: ${resolved.sourceId} | ${resolved.candidate.width}x${resolved.candidate.height}`);
    for (const line of trail) console.log(`  ${line}`);
    if (process.env.MEDIA_REQUIRE_GENERATED === "1" && resolved.sourceId !== "generated") {
      console.log(`  overgeslagen: alleen gegenereerde beelden gevraagd`);
      continue;
    }

    const imageResponse = await fetch(resolved.candidate.url);
    if (!imageResponse.ok) throw new Error(`download mislukt: HTTP ${imageResponse.status}`);
    const raw = Buffer.from(await imageResponse.arrayBuffer());

    const target = entry.target;
    const tmp = join(OUT, `.${entry.key}-raw`);
    writeFileSync(tmp, raw);
    const file = `${entry.key}.webp`;
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", tmp, "-vf", `scale='min(${target},iw)':-2`, "-quality", "82", join(OUT, file)]);

    const output = join(OUT, file);
    const probe = JSON.parse(
      execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", output]).toString(),
    ) as { streams: Array<{ width: number; height: number }> };

    meta[entry.key] = {
      file,
      width: probe.streams[0].width,
      height: probe.streams[0].height,
      title: entry.alt,
      creator: resolved.candidate.license.provider,
      license: "commercial",
      licenseName: resolved.candidate.license.licenseName,
      source: resolved.sourceId,
      landing: resolved.candidate.license.evidenceUrl,
      prompt: resolved.candidate.description,
      seed: request.seed,
      generated: resolved.sourceId === "generated",
    };
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    const cost = costFor(resolved.candidate.width, resolved.candidate.height);
    if (resolved.sourceId === "generated") totalCost += cost;
    console.log(`  → ${file} ${probe.streams[0].width}x${probe.streams[0].height} (${Math.round(raw.length / 1024)} KB bron, $${cost.toFixed(3)})`);
  }
  console.log(`klaar — geschatte kosten deze run: $${totalCost.toFixed(3)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
