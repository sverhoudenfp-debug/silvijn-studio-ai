/**
 * CONTENT-FIT (W7, 6 november 2026).
 *
 * De compositie-engine koos een layout uit het Design Plan, ongeacht hoeveel
 * inhoud er werkelijk was. Gevolg: korte tekst in een enorme sectie, een
 * beeldvlak zonder beeld, of vier kolommen voor twee diensten.
 *
 * Deze module maakt de keuze inhoudsafhankelijk. De regels zijn deterministisch
 * en conservatief: ze veranderen alleen wat aantoonbaar niet past, en laten een
 * expliciete keuze staan als die met de inhoud klopt.
 *
 * Uitgangspunt: een layout is pas goed als de inhoud hem draagt.
 */

export type SectionShape = {
  type: string;
  wordCount: number;
  itemCount: number;
  /** Gemiddeld aantal woorden per item (diensten, USP's, stappen). */
  itemWordAverage: number;
  hasImage: boolean;
};

export type SectionFit = {
  composition?: string;
  density?: "compact" | "balanced" | "airy";
  drop?: boolean;
  reason: string | null;
};

/**
 * Geldige D3-varianten per sectietype. De registry is de bron van waarheid:
 * een variant die daar niet bestaat (of die media vereist) mag nooit gekozen
 * worden, want Shopify valideert het template en de D3-audit keurt het af.
 */
import { D3_COMPOSITIONS } from "../blueprint/composition-registry";

function validVariant(type: string, key: string, shape: { itemCount: number; hasImage: boolean }): boolean {
  const defs = (D3_COMPOSITIONS as Record<string, { key: string; minItems?: number; requiresMedia?: boolean }[] | undefined>)[type];
  const definition = defs?.find((entry) => entry.key === key);
  if (!definition) return false;
  if (definition.requiresMedia && !shape.hasImage) return false;
  if (definition.minItems && shape.itemCount > 0 && shape.itemCount < definition.minItems) return false;
  return true;
}

/** Tekstveilige varianten per sectietype (allemaal zonder media-eis). */
const TEXT_SAFE: Record<string, string> = {
  services: "editorial_list",
  benefits: "editorial_list",
  about: "asymmetric",
  process: "numbered_editorial",
  contact: "editorial_contact",
  cta: "split_cta",
};

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

/** Leidt de inhoudsvorm af uit de gecomponeerde sectie (settings + blocks). */
export function sectionShape(section: {
  type?: string;
  settings?: Record<string, unknown>;
  blocks?: Record<string, { settings?: Record<string, unknown> }>;
  block_order?: string[];
}): SectionShape {
  const settings = section.settings ?? {};
  const textFields = ["heading", "subheading", "body", "text", "intro", "description", "quote"];
  let wordCount = 0;
  for (const field of textFields) {
    const value = settings[field];
    if (typeof value === "string") wordCount += countWords(value.replace(/<[^>]+>/g, " "));
  }

  const order = section.block_order ?? Object.keys(section.blocks ?? {});
  let itemWords = 0;
  let itemCount = 0;
  for (const id of order) {
    const blockSettings = section.blocks?.[id]?.settings ?? {};
    let itemWordCount = 0;
    for (const field of ["title", "heading", "description", "text", "body", "question", "answer"]) {
      const value = blockSettings[field];
      if (typeof value === "string") itemWordCount += countWords(value.replace(/<[^>]+>/g, " "));
    }
    if (itemWordCount === 0) continue;
    itemCount += 1;
    itemWords += itemWordCount;
  }
  wordCount += itemWords;

  const hasImage = Boolean(settings.image_asset) || Boolean(settings.image) || Boolean(settings.background_image);

  return {
    type: section.type ?? "",
    wordCount,
    itemCount,
    itemWordAverage: itemCount === 0 ? 0 : itemWords / itemCount,
    hasImage,
  };
}

/**
 * Kiest de best passende compositie voor deze inhoud.
 *
 * De regels zijn per sectietype geschreven en met opzet beperkt: liever de
 * bestaande keuze behouden dan een layout kiezen die de inhoud niet draagt.
 */
export function fitSection(
  shape: SectionShape,
  current: { composition?: string | null; density?: string | null }
): SectionFit {
  const composition = current.composition ?? null;
  const density = (current.density as SectionFit["density"]) ?? undefined;

  // 1. Secties waarvan élke variant beeld vereist, verdwijnen zonder beeld.
  if (!shape.hasImage && (shape.type === "gallery" || shape.type === "projects")) {
    return { drop: true, reason: `"${shape.type}" vereist beeld en er is geen bruikbaar beeld; de sectie zou leeg zijn.` };
  }

  // 2. Beeldvlak zonder beeld is een leeg vlak: kies een tekstveilige variant.
  if (composition && !shape.hasImage && !validVariant(shape.type, composition, shape)) {
    const safe = TEXT_SAFE[shape.type];
    if (safe && safe !== composition && validVariant(shape.type, safe, shape)) {
      return { composition: safe, density, reason: `"${composition}" vraagt beeld of meer items, maar de inhoud biedt dat niet; "${safe}" past bij tekst.` };
    }
  }

  // 3. Te weinig inhoud in een brede sectie: compacte variant en minder lucht.
  if (shape.wordCount > 0 && shape.wordCount < 45) {
    const compactChoice =
      shape.type === "services"
        ? shape.itemCount >= 2
          ? "numbered_list"
          : "editorial_list"
        : shape.type === "benefits"
          ? "editorial_list"
          : shape.type === "about"
            ? "asymmetric"
            : null;
    if (compactChoice && compactChoice !== composition && validVariant(shape.type, compactChoice, shape)) {
      return { composition: compactChoice, density: "compact", reason: `weinig inhoud (${shape.wordCount} woorden); compacte variant voorkomt een halflege sectie.` };
    }
    if (density !== "compact") {
      return { density: "compact", reason: `weinig inhoud (${shape.wordCount} woorden); compacte dichtheid.` };
    }
  }

  // 4. Veel inhoud: luchtiger zetten en een lijstvariant die het aankan.
  if (shape.wordCount > 220 && density !== "airy") {
    const listChoice =
      shape.type === "services" && shape.itemCount >= 3 && validVariant(shape.type, "editorial_list", shape)
        ? "editorial_list"
        : null;
    return {
      ...(listChoice && listChoice !== composition ? { composition: listChoice } : {}),
      density: "airy",
      reason: `veel inhoud (${shape.wordCount} woorden); ruimere zetting met een lijstvariant.`,
    };
  }

  // 5. Diensten en voordelen: aantal items bepaalt de verdeling.
  // 5a. Over ons mét beeld: kies een variant die het beeld echt toont.
  //     "statement" is een typografisch blok zonder media; met een foto erbij
  //     blijft die foto ongebruikt (en de pagina vlak).
  if (shape.type === "about" && shape.hasImage && shape.wordCount >= 60) {
    const preferred = validVariant("about", "image_led", shape) ? "image_led" : "editorial_split";
    if (composition !== preferred && validVariant("about", preferred, shape)) {
      return { composition: preferred, density, reason: `Over ons heeft beeld: "${preferred}" gebruikt de foto in plaats van een tekstblok zonder media.` };
    }
  }

  // 5b. Diensten mét beeld: redactionele rijen gebruiken de volle breedte en
  //     laten het beeld het verhaal dragen. Een raster met één grote cel en
  //     drie kleine laat op desktop juist lege ruimte over.
  if (shape.type === "services" && shape.itemCount >= 3 && shape.hasImage) {
    if (composition !== "editorial_list" && composition !== "featured_service" && validVariant("services", "editorial_list", shape)) {
      return { composition: "editorial_list", density, reason: `${shape.itemCount} diensten met beeld verdelen beter over redactionele rijen dan over een raster.` };
    }
  }

  if (shape.type === "services" && shape.itemCount > 0) {
    if (shape.itemCount <= 2 && composition !== "editorial_list" && validVariant("services", "editorial_list", shape)) {
      return { composition: "editorial_list", density, reason: `twee diensten in een raster van vier kolommen past niet; redactionele rijen verdelen beter.` };
    }
    if (shape.itemCount >= 5 && composition !== "editorial_list" && validVariant("services", "editorial_list", shape)) {
      return { composition: "editorial_list", density, reason: `${shape.itemCount} diensten vragen om een lijst die niet in kolommen hoeft.` };
    }
  }

  if (shape.type === "benefits" && shape.itemCount >= 5 && composition !== "bento" && validVariant("benefits", "bento", shape)) {
    return { composition: "bento", density, reason: `${shape.itemCount} voordelen verdelen beter over een compact raster dan over één rij.` };
  }

  return { composition: composition ?? undefined, density, reason: null };
}

/** Past de fit toe op een set secties; retourneert de aangepaste secties en log. */
export function applyContentFit(
  sections: Record<string, { type?: string; settings?: Record<string, unknown>; blocks?: Record<string, { settings?: Record<string, unknown> }>; block_order?: string[] }>,
  order: string[]
): { order: string[]; notes: string[] } {
  const notes: string[] = [];
  const keep: string[] = [];
  for (const key of order) {
    const section = sections[key];
    if (!section) continue;
    const shape = sectionShape(section);
    const fit = fitSection(shape, {
      composition: (section.settings?.composition as string | undefined) ?? null,
      density: (section.settings?.composition_density as string | undefined) ?? null,
    });

    if (fit.drop) {
      delete sections[key];
      notes.push(`${key}: ${fit.reason}`);
      continue;
    }
    if (section.settings) {
      // Alleen schrijven wat het sectieschema kent: een onbekende setting laat
      // Shopify het hele templatebestand bij import vallen.
      const supportsComposition = "composition" in section.settings;
      const supportsDensity = "composition_density" in section.settings;
      if (supportsComposition && fit.composition) section.settings.composition = fit.composition;
      if (supportsDensity && fit.density) section.settings.composition_density = fit.density;
      // Geen beeld? Dan ook geen lege beeldinstellingen mee naar Shopify.
      if (!shape.hasImage) {
        delete section.settings.image;
        delete section.settings.image_mobile;
        delete section.settings.image_asset;
        delete section.settings.image_asset_width;
        delete section.settings.image_asset_height;
      }
    }
    if (fit.reason) notes.push(`${key}: ${fit.reason}`);
    keep.push(key);
  }
  return { order: keep, notes };
}
