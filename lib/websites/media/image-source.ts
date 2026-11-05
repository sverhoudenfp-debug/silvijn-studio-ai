/**
 * BEELDPIPELINE — provider-onafhankelijk (fase 3).
 *
 * Doel: één smalle interface waar elke beeldbron achter past. De generator
 * vraagt nooit "haal een foto bij X"; hij vraagt "vul dit slot met een
 * bruikbaar, juridisch schoon beeld". Welke bron dat doet is configuratie.
 *
 * HARD REGELS
 * - Geen bron, dan geen beeld: het bestaande abstracte placeholder-pad blijft
 *   de eerlijke fallback. Nooit een verzonnen foto simuleren.
 * - Licentie is een poort, geen notitie. Een kandidaat zonder bevestigd
 *   commercieel recht komt er niet door, ook niet als hij mooi is.
 * - Herkenbare personen standaard uit voor team/over-ons/realisaties. Alleen
 *   met aantoonbare toestemming (consentConfirmed) mag dat veld open.
 * - Determination: dezelfde opdracht + dezelfde seed → dezelfde keuze.
 */

import type { MediaSlotKey } from "../theme-zip/media-slots";

/* ------------------------------------------------------------------ types */

export type ImageSourceId = "generated" | "pixabay" | "openverse_cc0";

export interface ImageLicense {
  /** Bron zoals hij in de administratie moet staan. */
  provider: string;
  sourceId: ImageSourceId;
  /** Naam van de licentie zoals de bron hem noemt. */
  licenseName: string;
  /** Commercieel gebruik in een klantwebsite toegestaan? */
  commercialUse: boolean;
  attributionRequired: boolean;
  /** Verplichte of gevraagde naamsvermelding, exact zoals op te nemen. */
  attributionText: string | null;
  /** Bewijsstuk: bronpagina of model-endpoint. */
  evidenceUrl: string;
}

export interface ImageCandidate {
  /** Stabiele id binnen de bron (voor dedupe en audit). */
  sourceImageId: string;
  url: string;
  width: number;
  height: number;
  /** Beschrijving of prompt; gebruikt voor alt-tekst en scenebewaking. */
  description: string;
  /** Vrije tags van de bron (stock). Leeg bij gegenereerd beeld. */
  tags: readonly string[];
  /** Door de maker/bron aangegeven: staan er herkenbare personen op? */
  hasRecognizablePeople: boolean;
  license: ImageLicense;
}

export interface ImageRequest {
  slot: MediaSlotKey;
  /** Branche en plaats uit de opdracht; nooit verzonnen feiten. */
  industry: string;
  city: string | null;
  /** Gewenste sfeer uit het design plan (bijv. "natural", "ambachtelijk"). */
  mood: readonly string[];
  aspect: "wide" | "landscape" | "square";
  /** Alt-tekst-basis uit de AI-planning; null = decoratief. */
  alt: string | null;
  /** Seed: dezelfde opdracht houdt dezelfde keuze. */
  seed: string;
  /** Alleen true bij aantoonbare toestemming (portretrecht). */
  consentConfirmed?: boolean;
}

export interface ImageSource {
  readonly id: ImageSourceId;
  readonly label: string;
  /** Is deze bron op dit moment bruikbaar (sleutel aanwezig, quota)? */
  isAvailable(): boolean;
  /** Kandidaten ophalen. Mag falen; de resolver valt dan door. */
  find(request: ImageRequest, fetcher: Fetcher): Promise<readonly ImageCandidate[]>;
}

/** Injecteerbaar, zodat tests nooit het netwerk op hoeven. */
export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/* ------------------------------------------------------- scenebewaking */

/**
 * Woorden die op een herkenbaar persoon wijzen. Bij stockfoto's is dit de
 * goedkoopste betrouwbare zeef: tags zijn door de uploader gezet en dekken
 * portret, team en "mensen aan het werk" vrijwel altijd.
 */
const PERSON_TERMS = [
  "person", "people", "persoon", "personen", "mensen", "man", "men", "woman", "women",
  "vrouw", "kind", "kinderen", "child", "children", "portrait", "portret", "face", "gezicht",
  "team", "collega", "colleagues", "employee", "medewerker", "worker", "werknemer",
  "family", "gezin", "couple", "stel", "customer", "klant", "model", "selfie", "human",
];

/** Sloten waar een gezicht een toestemmingsvraag is, niet een smaakkwestie. */
const CONSENT_SENSITIVE_SLOTS: readonly MediaSlotKey[] = ["about", "gallery", "services"];

export function mentionsPeople(text: string): boolean {
  const haystack = ` ${text.toLowerCase()} `;
  return PERSON_TERMS.some((term) => new RegExp(`[^a-z]${term}[^a-z]`, "i").test(haystack));
}

/**
 * De kernpoort. Een kandidaat komt er alleen door als hij juridisch schoon is
 * én past bij het slot.
 */
export function acceptCandidate(candidate: ImageCandidate, request: ImageRequest): { accepted: boolean; reason: string } {
  if (!candidate.license.commercialUse) {
    return { accepted: false, reason: `licentie zonder commercieel recht (${candidate.license.licenseName})` };
  }
  if (candidate.license.attributionRequired && !candidate.license.attributionText) {
    return { accepted: false, reason: "attributie verplicht maar geen naamsvermelding aangeleverd" };
  }
  const peopleInImage = candidate.hasRecognizablePeople || mentionsPeople(candidate.description) || candidate.tags.some(mentionsPeople);
  if (peopleInImage && CONSENT_SENSITIVE_SLOTS.includes(request.slot) && !request.consentConfirmed) {
    return { accepted: false, reason: "herkenbaar persoon zonder aantoonbare toestemming" };
  }
  if (peopleInImage && request.slot === "hero" && !request.consentConfirmed) {
    // Ook in de hero geen gezichten: het merk is de tuin, niet een model.
    return { accepted: false, reason: "hero met herkenbaar persoon zonder toestemming" };
  }
  return { accepted: true, reason: "ok" };
}

/* ------------------------------------------------------------ promptbouw */

/**
 * Scènebeschrijving per slot. Bewust POSITIEF geformuleerd: FLUX.2 kent geen
 * negative prompt, dus "geen mensen" werkt averechts. We beschrijven een lege,
 * doorleefde scène.
 */
export function buildImagePrompt(request: ImageRequest): string {
  const scene: Record<MediaSlotKey, string> = {
    hero: "wide establishing view of the finished work in its setting, foreground detail leading into the composition, late afternoon light",
    about: "quiet workshop and material detail, tools resting where the work happens, daylight through a window",
    services: "close study of materials and craft: texture, edge, joint and finish, shallow depth of field",
    gallery: "finished project photographed from a considered angle, seasonal planting, calm and uncluttered",
  };
  const aspect: Record<ImageRequest["aspect"], string> = {
    wide: "21:9 crop, shot on 24mm",
    landscape: "3:2 crop, shot on 35mm",
    square: "1:1 crop, shot on 50mm",
  };
  const mood = request.mood.length ? `, mood: ${request.mood.slice(0, 3).join(", ")}` : "";
  return [
    `Editorial architectural photography for a ${request.industry} business${request.city ? ` in ${request.city}` : ""}.`,
    scene[request.slot] + ".",
    "Unpopulated scene: no people, no faces, empty of figures.",
    "Natural daylight, true-to-life colour, fine grain, no text, no logos, no watermark.",
    aspect[request.aspect] + mood + ".",
  ].join(" ");
}

/* -------------------------------------------------------------- resolver */

export interface ResolvedImage {
  candidate: ImageCandidate;
  sourceId: ImageSourceId;
  /** Welke bronnen zijn geprobeerd en waarom ze afvielen (audit). */
  trail: readonly string[];
}

export interface ResolveOptions {
  sources: readonly ImageSource[];
  fetcher: Fetcher;
  /** Volgorde is beleid: kwaliteit eerst, gratis stock als aanvulling. */
  maxCandidatesPerSource?: number;
}

/**
 * Probeert de bronnen in de gegeven volgorde. Binnen een bron wordt
 * deterministisch gekozen (sorteren op sourceImageId, dan de seed-hash), niet
 * op volgorde van de API: anders verscheelt het beeld per request.
 */
export async function resolveSlotImage(request: ImageRequest, options: ResolveOptions): Promise<ResolvedImage | null> {
  const trail: string[] = [];
  const limit = options.maxCandidatesPerSource ?? 12;

  for (const source of options.sources) {
    if (!source.isAvailable()) {
      trail.push(`${source.id}: niet beschikbaar`);
      continue;
    }
    let candidates: readonly ImageCandidate[];
    try {
      candidates = await source.find(request, options.fetcher);
    } catch (error) {
      trail.push(`${source.id}: fout (${error instanceof Error ? error.message : "onbekend"})`);
      continue;
    }
    if (!candidates.length) {
      trail.push(`${source.id}: geen resultaat`);
      continue;
    }
    const ranked = [...candidates]
      .sort((a, b) => a.sourceImageId.localeCompare(b.sourceImageId))
      .sort((a, b) => scoreCandidate(b, request) - scoreCandidate(a, request))
      .slice(0, limit);
    for (const candidate of ranked) {
      const verdict = acceptCandidate(candidate, request);
      if (!verdict.accepted) {
        trail.push(`${source.id}/${candidate.sourceImageId}: afgewezen (${verdict.reason})`);
        continue;
      }
      trail.push(`${source.id}/${candidate.sourceImageId}: gekozen`);
      return { candidate, sourceId: source.id, trail };
    }
    trail.push(`${source.id}: alle kandidaten afgewezen`);
  }
  return null;
}

/** Kleine, uitlegbare voorkeur: liggend, groot genoeg, zonder mensen. */
export function scoreCandidate(candidate: ImageCandidate, request: ImageRequest): number {
  let score = 0;
  const ratio = candidate.width / Math.max(1, candidate.height);
  if (request.aspect === "wide" && ratio >= 1.6) score += 3;
  if (request.aspect === "landscape" && ratio >= 1.25 && ratio < 1.6) score += 3;
  if (request.aspect === "square" && ratio > 0.9 && ratio < 1.15) score += 3;
  if (candidate.width >= 1600) score += 2;
  if (candidate.hasRecognizablePeople) score -= 4;
  if (request.city && `${candidate.description} ${candidate.tags.join(" ")}`.toLowerCase().includes(request.city.toLowerCase())) score += 1;
  return score;
}

/* -------------------------------------------------------------- bronnen */

export interface ProviderConfig {
  falKey: string | null;
  pixabayKey: string | null;
  openverseToken: string | null;
}

export function providerConfigFromEnv(env: Record<string, string | undefined>): ProviderConfig {
  return {
    falKey: env.FAL_KEY?.trim() || null,
    pixabayKey: env.PIXABAY_API_KEY?.trim() || null,
    openverseToken: env.OPENVERSE_TOKEN?.trim() || null,
  };
}

const FAL_ENDPOINT = "https://fal.run/fal-ai/flux-2-pro";

/**
 * fal.ai — FLUX.2 [pro]. Gekozen om fotorealisme bij architectuur, interieur en
 * materiaal, en omdat de endpoint een gewone API-key gebruikt (geen OAuth).
 * Commercieel gebruik is op de modelpagina expliciet toegestaan.
 */
export function falSource(config: ProviderConfig): ImageSource {
  return {
    id: "generated",
    label: "FLUX.2 [pro] via fal.ai",
    isAvailable: () => Boolean(config.falKey),
    async find(request, fetcher) {
      const response = await fetcher(FAL_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Key ${config.falKey}` },
        body: JSON.stringify({
          prompt: buildImagePrompt(request),
          image_size: request.aspect === "wide" ? "landscape_16_9" : request.aspect === "square" ? "square_hd" : "landscape_4_3",
          num_images: 1,
          enable_safety_checker: true,
          seed: seedToInt(request.seed),
        }),
      });
      if (!response.ok) throw new Error(`fal HTTP ${response.status}`);
      const payload = (await response.json()) as { images?: Array<{ url?: string; width?: number; height?: number }> };
      const image = payload.images?.[0];
      if (!image?.url) return [];
      return [{
        sourceImageId: `flux2-${seedToInt(request.seed)}`,
        url: image.url,
        width: image.width ?? 1024,
        height: image.height ?? 1024,
        description: buildImagePrompt(request),
        tags: [],
        hasRecognizablePeople: false,
        license: {
          provider: "fal.ai / Black Forest Labs FLUX.2 [pro]",
          sourceId: "generated",
          licenseName: "FLUX.2 [pro] — commercial use",
          commercialUse: true,
          attributionRequired: false,
          attributionText: null,
          evidenceUrl: "https://fal.ai/models/fal-ai/flux-2-pro",
        },
      }];
    },
  };
}

/**
 * Pixabay — gratis, commercieel, geen attributieplicht. Let op de
 * volumeregel: de API is bedoeld voor menselijk gebruik, met 24u-cache en
 * zonder systematische massadownloads. Daarom is dit een AANVULLING, geen
 * hoofdpad, en worden resultaten gecacht.
 */
export function pixabaySource(config: ProviderConfig, cache?: Map<string, readonly ImageCandidate[]>): ImageSource {
  return {
    id: "pixabay",
    label: "Pixabay (stock, Content License)",
    isAvailable: () => Boolean(config.pixabayKey),
    async find(request, fetcher) {
      const query = [request.industry, request.mood[0], request.slot === "gallery" ? "project" : "detail", "exterior"]
        .filter(Boolean).join(" ");
      const key = `pixabay:${query}:${request.aspect}`;
      const cached = cache?.get(key);
      if (cached) return cached;
      const url = `https://pixabay.com/api/?key=${config.pixabayKey}&q=${encodeURIComponent(query)}&image_type=photo&orientation=${request.aspect === "wide" ? "horizontal" : "horizontal"}&per_page=20&safesearch=true`;
      const response = await fetcher(url);
      if (!response.ok) throw new Error(`pixabay HTTP ${response.status}`);
      const payload = (await response.json()) as { hits?: Array<Record<string, unknown>> };
      const candidates: ImageCandidate[] = (payload.hits ?? []).map((hit) => {
        const tags = String(hit.tags ?? "");
        return {
          sourceImageId: String(hit.id ?? ""),
          url: String(hit.largeImageURL ?? hit.webformatURL ?? ""),
          width: Number(hit.imageWidth ?? 0),
          height: Number(hit.imageHeight ?? 0),
          description: tags,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          hasRecognizablePeople: mentionsPeople(tags),
          license: {
            provider: "Pixabay",
            sourceId: "pixabay" as const,
            licenseName: "Pixabay Content License",
            commercialUse: true,
            attributionRequired: false,
            attributionText: null,
            evidenceUrl: "https://pixabay.com/service/license-summary/",
          },
        };
      }).filter((candidate) => Boolean(candidate.sourceImageId) && Boolean(candidate.url));
      cache?.set(key, candidates);
      return candidates;
    },
  };
}

/**
 * Openverse — alleen CC0. CC BY vraagt naamsvermelding per item en BY-SA
 * heeft een copyleft-effect dat we een klant niet aandoen; die filteren we
 * dus weg in plaats van ze later te moeten uitleggen.
 */
export function openverseSource(config: ProviderConfig): ImageSource {
  return {
    id: "openverse_cc0",
    label: "Openverse (alleen CC0)",
    isAvailable: () => Boolean(config.openverseToken ?? true),
    async find(request, fetcher) {
      const query = [request.industry, request.slot].join(" ");
      const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license=cc0&page_size=20`;
      const headers: Record<string, string> = { accept: "application/json" };
      if (config.openverseToken) headers.authorization = `Bearer ${config.openverseToken}`;
      const response = await fetcher(url, { headers });
      if (!response.ok) throw new Error(`openverse HTTP ${response.status}`);
      const payload = (await response.json()) as { results?: Array<Record<string, unknown>> };
      return (payload.results ?? []).flatMap((item) => {
        const license = String(item.license ?? "");
        if (license !== "cc0") return [];
        const tags = Array.isArray(item.tags) ? item.tags.map((tag) => String((tag as { name?: string }).name ?? "")).filter(Boolean) : [];
        return [{
          sourceImageId: String(item.id ?? ""),
          url: String(item.url ?? ""),
          width: Number(item.width ?? 0),
          height: Number(item.height ?? 0),
          description: String(item.title ?? ""),
          tags,
          hasRecognizablePeople: mentionsPeople(`${item.title ?? ""} ${tags.join(" ")}`),
          license: {
            provider: String(item.source ?? "Openverse"),
            sourceId: "openverse_cc0" as const,
            licenseName: "CC0 1.0",
            commercialUse: true,
            attributionRequired: false,
            attributionText: null,
            evidenceUrl: "https://docs.openverse.org/",
          },
        }];
      }).filter((candidate) => Boolean(candidate.sourceImageId) && Boolean(candidate.url));
    },
  };
}

/** Standaardvolgorde: kwaliteit eerst, dan gratis aanvulling, dan archief. */
export function defaultImageSources(config: ProviderConfig): readonly ImageSource[] {
  return [falSource(config), pixabaySource(config), openverseSource(config)];
}

/* --------------------------------------------------------------- helpers */

export function seedToInt(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash % 2147483647);
}
