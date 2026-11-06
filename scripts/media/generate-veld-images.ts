/**
 * W9 — echte beelden voor Veld & Vorm via de productiepipeline (FLUX.2 [pro]).
 *
 * Eén samenhangende fotografische stijl, geen herkenbare personen, geen
 * verzonnen klantprojecten. Schrijft geoptimaliseerde JPEG's + meta.json met
 * licentie, prompt, seed en alt-tekst. Logt nooit de API-key.
 *
 *   npx tsx scripts/media/generate-veld-images.ts [--only hero]
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
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

type SlotKey = "hero" | "about" | "services_1" | "services_2" | "services_3" | "services_4" | "gallery_1" | "gallery_2";

/** Beeldplan: één stijl, per slot een eigen onderwerp en alt-tekst. */
const PLAN: { key: SlotKey; slot: ImageRequest["slot"]; aspect: "wide" | "landscape" | "square"; alt: string; focus: string }[] = [
  { key: "hero", slot: "hero", aspect: "wide", alt: "Sfeerbeeld van een natuurlijk aangelegde tuin met vaste planten en een terras", focus: "wide establishing garden view, layered planting, natural stone terrace, late afternoon light" },
  { key: "about", slot: "about", aspect: "landscape", alt: "Detail van beplanting en materiaalgebruik in een onderhouden tuin", focus: "close detail of planting texture, gravel and weathered brick edging, soft daylight" },
  { key: "services_1", slot: "services", aspect: "landscape", alt: "Tuinontwerp op papier naast materialen en beplantingsschetsen", focus: "garden design sketches on a workbench with plant samples, no people, warm daylight" },
  { key: "services_2", slot: "services", aspect: "landscape", alt: "Aanleg van een tuinpad met bestrating en borders", focus: "garden construction in progress, paving and border preparation, tools, natural light" },
  { key: "services_3", slot: "services", aspect: "landscape", alt: "Beplantingsborder met vaste planten en siergrassen", focus: "planting border with perennials and grasses, layered depth, soft afternoon light" },
  { key: "services_4", slot: "services", aspect: "landscape", alt: "Onderhoud van een tuin: gesnoeide hagen en een net pad", focus: "seasonal garden maintenance, trimmed hedge and clean gravel path, calm daylight" },
  { key: "gallery_1", slot: "gallery", aspect: "landscape", alt: "Terras met natuurlijke steen en beplanting langs de rand", focus: "terrace detail with natural stone and edge planting, no people, warm light" },
  { key: "gallery_2", slot: "gallery", aspect: "landscape", alt: "Borders met seizoensbeplanting langs een tuinpad", focus: "border planting along a garden path, seasonal colour, no people, soft light" },
];

const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex > -1 ? process.argv[onlyIndex + 1] : null;

const OUT = join(process.cwd(), "visual-output/images");
const metaPath = join(OUT, "meta.json");
const meta: Record<string, unknown> = existsSync(metaPath)
  ? (JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>)
  : {};

async function optimize(bytes: Buffer): Promise<{ bytes: Buffer; width: number; height: number }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharp = (await import("sharp")).default;
    const image = sharp(bytes);
    const info = await image.metadata();
    const target = 1600;
    const resized = (info.width ?? 0) > target ? image.resize({ width: target }) : image;
    const out = await resized.jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    return { bytes: out.data, width: out.info.width, height: out.info.height };
  } catch {
    const fallback = await import("node:module");
    void fallback;
    return { bytes, width: 1024, height: 576 };
  }
}

(async () => {
  const config = providerConfigFromEnv(process.env);
  const source = falSource(config);
  if (!source.isAvailable()) {
    console.error("FAL_KEY ontbreekt: geen beelden gegenereerd.");
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });
  for (const entry of PLAN) {
    if (only && entry.key !== only) continue;
    const request: ImageRequest = {
      slot: entry.slot,
      industry: "hoveniersbedrijf en tuinontwerp",
      city: "Utrecht",
      mood: ["natural", "ambachtelijk", "hoogwaardig", "rustig daglicht", entry.focus],
      aspect: entry.aspect,
      seed: `veld-en-vorm-w9-${entry.key}`,
      alt: entry.alt,
    } as unknown as ImageRequest;
    const started = Date.now();
    const candidates = await source.find(request, realFetcher);
    if (candidates.length === 0) {
      console.log(entry.key, "geen kandidaat");
      continue;
    }
    const candidate = candidates[0];
    const download = await fetch(candidate.url);
    const original = Buffer.from(await download.arrayBuffer());
    const optimized = await optimize(original);
    const file = `${entry.key}.jpg`;
    writeFileSync(join(OUT, file), optimized.bytes);
    meta[entry.key] = {
      file,
      width: optimized.width,
      height: optimized.height,
      title: entry.alt,
      landing: candidate.license.evidenceUrl,
      license: "commercial",
      provider: candidate.license.provider,
      licenseName: candidate.license.licenseName,
      prompt: candidate.description,
      seed: `veld-en-vorm-w9-${entry.key}`,
      bytes: optimized.bytes.length,
      generatedAt: new Date().toISOString(),
    };
    console.log(
      entry.key,
      "|", optimized.width + "x" + optimized.height,
      "|", Math.round(optimized.bytes.length / 1024) + " kB",
      "|", ((Date.now() - started) / 1000).toFixed(1) + "s"
    );
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  console.log("meta geschreven:", metaPath, "| beelden:", Object.keys(meta).length);
})();
