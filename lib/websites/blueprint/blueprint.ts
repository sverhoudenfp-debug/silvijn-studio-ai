import { getD3Composition } from "./composition-registry";
import { z } from "zod";
import type { ProjectRequirements } from "@/lib/projects/types";
import {
  BLUEPRINT_BACKGROUNDS,
  BLUEPRINT_MEDIA_RATIOS,
  BLUEPRINT_MEDIA_ROLES,
  BLUEPRINT_MOTION,
  BLUEPRINT_SECTION_REGISTRY,
  BLUEPRINT_SECTION_TYPES,
  isBlueprintLayout,
  blueprintBlockKeys,
  type BlueprintSectionType,
} from "./section-registry";

/**
 * WEBSITE BLUEPRINT v2 (Fase A, 2026-09-19) — de machine-uitvoerbare
 * website-architectuur, gegenereerd als onderdeel van het Design Plan.
 *
 * ARCHITECTUUR: het blueprint is een ADDITIEF, OPTIONEEL veld op het
 * bestaande Design Plan (`plan.blueprint`). Daardoor:
 * - blijven ALLE bestaande Design Plans geldig (backward compatible);
 * - verandert er niets aan gates, payments, QC, ZIP of preview;
 * - kan de latere Shopify theme-builder het blueprint rechtstreeks
 *   uitvoeren (types/layouts/blocks uit de gesloten SECTION-REGISTRY),
 *   zonder de huidige generatievloei aan te raken.
 *
 * De AI plant PER PAGINA welke secties nodig zijn, in welke volgorde en
 * met welke layoutvariant — branche-afhankelijk, niet één universeel
 * template. De sectie-instanties zijn composable: gesloten typen +
 * layoutvarianten + getypeerde blokken + mediasloten + CTA-configuratie.
 *
 * HARD REGELS (zelfde geest als het Design Plan):
 * - Geen verzonnen bedrijfsfeiten: blocks zijn COMPOSITIE-hints
 *   (korte richting), geen definitieve copy — de content-pass vult later
 *   de echte teksten onder het bestaande fabricatie-contract.
 * - trustElements vereisen een expliciete bron (source) — echte data
 *   alleen; de fabricatie-scan over het hele plan dekt het blueprint mee.
 * - De paginacompositie is hard gekoppeld aan de requirements
 *   (numberOfPages): prijsintegriteit geldt óók voor het blueprint.
 */

// ---------------------------------------------------------------------------
// Sectie-instantie (composable)
// ---------------------------------------------------------------------------

/** Blok binnen een sectie-instantie: compositie-hint, geen definitieve copy. */
export const blueprintBlockSchema = z.object({
  kind: z.string().min(2).max(60),
  hint: z.string().min(2).max(200).nullable(),
});

/** Mediaslot op een sectie-instantie (koppeling met de R1 media-laag). */
export const blueprintMediaSlotSchema = z.object({
  role: z.enum(BLUEPRINT_MEDIA_ROLES),
  ratio: z.enum(BLUEPRINT_MEDIA_RATIOS),
  alt: z.string().min(2).max(160).nullable(),
});

/** CTA-configuratie op een sectie-instantie. */
export const blueprintCtaSchema = z.object({
  label: z.string().min(2).max(60),
  target: z.string().min(1).max(160),
  prominence: z.enum(["primary", "secondary", "inline"]),
});

export const blueprintSectionInstanceSchema = z
  .object({
    composition: z.object({
      variant: z.string().min(2).max(40),
      density: z.enum(["compact", "balanced", "airy"]),
      importance: z.enum(["primary", "supporting"]),
      rationale: z.string().min(3).max(400),
    }).optional(),
    type: z.enum(BLUEPRINT_SECTION_TYPES),
    layout: z.string().min(2).max(40),
    blocks: z.array(blueprintBlockSchema).max(24),
    media: z.array(blueprintMediaSlotSchema).max(8),
    cta: blueprintCtaSchema.nullable(),
    background: z.enum(BLUEPRINT_BACKGROUNDS).default("default"),
    motion: z.enum(BLUEPRINT_MOTION).default("none"),
    contentHints: z.string().min(2).max(400).nullable(),
  })
  .superRefine((instance, ctx) => {
    const definition = BLUEPRINT_SECTION_REGISTRY[instance.type as BlueprintSectionType];
    if (!definition) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Onbekend sectietype "${instance.type}".` });
      return;
    }
    if (instance.composition && !getD3Composition(instance.type, instance.composition.variant)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["composition", "variant"], message: `Onbekende D3-compositie ${instance.type}/${instance.composition.variant}.` });
    }
    // 1. Layout moet bij het sectietype bestaan.
    if (!isBlueprintLayout(instance.type as BlueprintSectionType, instance.layout)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Layout "${instance.layout}" bestaat niet bij sectietype "${instance.type}" (toegestaan: ${definition.layouts.map((l) => l.key).join(", ")}).`,
      });
    }
    // 2. Blokkeys en aantallen volgen de registry.
    const allowedKinds = blueprintBlockKeys(instance.type as BlueprintSectionType);
    const counts = new Map<string, number>();
    for (const block of instance.blocks) {
      if (!allowedKinds.has(block.kind)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Blokkind "${block.kind}" is niet toegestaan bij sectietype "${instance.type}" (toegestaan: ${[...allowedKinds].join(", ") || "geen"}).`,
        });
        continue;
      }
      counts.set(block.kind, (counts.get(block.kind) ?? 0) + 1);
    }
    for (const blockDef of definition.blocks) {
      const count = counts.get(blockDef.key) ?? 0;
      if (blockDef.requiredKind && count < blockDef.min) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Sectietype "${instance.type}" vereist minimaal ${blockDef.min} "${blockDef.key}"-blokken (nu ${count}).`,
        });
      }
      if (count > blockDef.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Sectietype "${instance.type}" staat maximaal ${blockDef.max} "${blockDef.key}"-blokken (nu ${count}).`,
        });
      }
    }
    // 3. Mediarollen volgen de registry.
    for (const slot of instance.media) {
      if (!definition.mediaRoles.includes(slot.role)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Mediarol "${slot.role}" is niet toegestaan bij sectietype "${instance.type}".`,
        });
      }
    }
    // 4. CTA alleen waar ondersteund (en verplicht op cta-instanties).
    if (instance.cta && !definition.supportsCta) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Sectietype "${instance.type}" ondersteunt geen CTA-configuratie.`,
      });
    }
    if (instance.type === "cta" && !instance.cta) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Een cta-sectie-instantie vereist een CTA-configuratie (label + target).`,
      });
    }
  });

export type BlueprintBlock = z.infer<typeof blueprintBlockSchema>;
export type BlueprintMediaSlot = z.infer<typeof blueprintMediaSlotSchema>;
export type BlueprintCta = z.infer<typeof blueprintCtaSchema>;
export type BlueprintSectionInstance = z.infer<typeof blueprintSectionInstanceSchema>;

// ---------------------------------------------------------------------------
// Pagina's
// ---------------------------------------------------------------------------

export const blueprintPageSchema = z.object({
  key: z.string().min(1).max(60),
  title: z.string().min(1).max(120).nullable(),
  purpose: z.string().min(3).max(500).nullable(),
  seo: z
    .object({
      title: z.string().min(3).max(120).nullable(),
      metaDescription: z.string().min(10).max(300).nullable(),
    })
    .nullable(),
  sectionInstances: z.array(blueprintSectionInstanceSchema).min(1).max(12),
});

export type BlueprintPage = z.infer<typeof blueprintPageSchema>;

// ---------------------------------------------------------------------------
// Trust- en conversie-elementen (echte data, bron verplicht)
// ---------------------------------------------------------------------------

const TRUST_SOURCES = ["requirements", "questionnaire", "lead_notes"] as const;

export const blueprintTrustElementsSchema = z.object({
  usps: z
    .array(
      z.object({
        label: z.string().min(2).max(80),
        source: z.enum(TRUST_SOURCES),
      })
    )
    .max(6),
  stats: z
    .array(
      z.object({
        label: z.string().min(2).max(80),
        value: z.string().min(1).max(40),
        source: z.enum(TRUST_SOURCES),
      })
    )
    .max(4),
  badges: z
    .array(
      z.object({
        label: z.string().min(2).max(80),
        source: z.enum(TRUST_SOURCES),
      })
    )
    .max(4),
});

export const blueprintConversionPlanSchema = z.object({
  primaryGoal: z.string().min(3).max(300).nullable(),
  leadCapture: z.boolean().nullable(),
  contactPreference: z.enum(["form", "call", "booking", "unknown"]).nullable(),
});

// ---------------------------------------------------------------------------
// Het volledige blueprint
// ---------------------------------------------------------------------------

export const websiteBlueprintSchema = z.object({
  version: z.literal(2),
  pages: z.array(blueprintPageSchema).min(1).max(10),
  trustElements: blueprintTrustElementsSchema,
  conversionPlan: blueprintConversionPlanSchema,
  missingInformation: z.array(z.string().min(3).max(200)).max(20),
});

export type WebsiteBlueprint = z.infer<typeof websiteBlueprintSchema>;

/** Homepage-aliaskeys die de compositieregels herkennen. */
const HOME_KEYS = new Set(["home", "index", "start", "homepage"]);
/** Sectietypes die de conversie-eis op de homepage vervullen. */
const CONVERSION_SECTION_TYPES = new Set<BlueprintSectionType>(["contact", "booking", "cta"]);

export interface BlueprintConsistencyResult {
  passed: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Conversieketen (A3, 2026-09-19) — attention / interest / trust / action
// ---------------------------------------------------------------------------

/**
 * Sectietypes die de INTEREST-schakel vervullen: inhoudelijke secties die
 * de bezoeker vertellen wat het bedrijf doet of laat (uit de registry).
 */
const INTEREST_SECTION_TYPES: ReadonlySet<BlueprintSectionType> = new Set([
  "services",
  "benefits",
  "projects",
  "gallery",
  "process",
  "about",
  "faq",
  "rich_text",
]);

/**
 * Sectietypes die de TRUST-schakel vervullen: betrouwbaar bewijs. Dit zijn
 * precies de evidence_only-secties — alleen planbaar met echte data
 * (check 7 dwingt de binding voor usp_band/stats deterministisch af).
 */
const TRUST_SECTION_TYPES: ReadonlySet<BlueprintSectionType> = new Set([
  "usp_band",
  "stats",
  "testimonials",
  "team",
  "projects",
  "rates",
]);

/**
 * Sectietypes die de ACTION-schakel vervullen: daadwerkelijk uitvoerbare
 * conversie (zelfde verzameling als de compositie-vloer, aangevuld met
 * newsletter — de keten geldt websitebreed, niet alleen op de homepage).
 */
const ACTION_SECTION_TYPES: ReadonlySet<BlueprintSectionType> = new Set([
  "cta",
  "contact",
  "booking",
  "newsletter",
]);

/**
 * Herkent een EERLIJKE trust-disclosure in missingInformation: een regel
 * die expliciet benoemt dat betrouwbaar bewijs (USP's, cijfers, reviews,
 * referenties, certificering, team, tarieven, ...) ontbreekt.
 */
const TRUST_DISCLOSURE_PATTERN =
  /(usp|trust|betrouwbaar|bewijs|testimoni|referent|review|cijfer|statist|garantie|certific|keurmerk|klantuitspraak|team|tarie(v|f))/i;

/** Status van de trust-schakel: aanwezig, of eerlijk afgezien (waived). */
export interface ConversionTrustStatus {
  satisfied: boolean;
  waived: boolean;
}

export interface ConversionStructureChain {
  attention: boolean;
  interest: boolean;
  trust: ConversionTrustStatus;
  action: boolean;
}

export interface ConversionStructureResult {
  passed: boolean;
  errors: string[];
  /** Machineleesbare ketenstatus — ook bij passed=false volledig gevuld. */
  chain: ConversionStructureChain;
}

/**
 * Deterministische conversieketen-check (AIDA): controleert of het blueprint
 * een logische conversiestructuur bevat — attention (homepage opent met
 * hero-positionering), interest (inhoudelijke sectie), trust (bewijs óf een
 * expliciete, eerlijke registratie van ontbrekend bewijs) en action
 * (uitvoerbare conversie). Dit is géén volgorde-check: alleen de keten als
 * geheel moet logisch zijn, niet één vaste sectievolgorde.
 *
 * Trust-uitsondering: ontbreekt betrouwbaar bewijs, dan mag de trust-schakel
 * ontbreken mits dat EXPLICIET in blueprint.missingInformation staat. Dit
 * mag nooit tot gefabriceerde claims leiden — check 7 blokkeert trust-secties
 * zonder geregistreerde echte data, en deze check blokkeert het omgekeerde:
 * geregistreerde trust-data die stilletjes nergens zichtbaar wordt.
 */
export function validateConversionStructure(blueprint: WebsiteBlueprint): ConversionStructureResult {
  const errors: string[] = [];
  const instances = blueprint.pages.flatMap((page) =>
    page.sectionInstances.map((instance) => ({ pageKey: page.key, instance }))
  );
  const homePages = blueprint.pages.filter((p) => HOME_KEYS.has(p.key.toLowerCase()));

  // 1. ATTENTION: de homepage opent met positionering (hero).
  const attention =
    homePages.length === 1 && homePages[0].sectionInstances[0]?.type === "hero";
  if (!attention) {
    errors.push(
      homePages.length === 0
        ? "Conversieketen: geen homepage — de attention-positie (hero) ontbreekt."
        : `Conversieketen: homepage "${homePages[0].key}" opent niet met een hero-sectie — de attention-positie ontbreekt.`
    );
  }

  // 2. INTEREST: minimaal één inhoudelijke sectie, ergens op de website.
  const interest = instances.some(({ instance }) =>
    INTEREST_SECTION_TYPES.has(instance.type as BlueprintSectionType)
  );
  if (!interest) {
    errors.push(
      "Conversieketen: geen interest-sectie (services, benefits, projects, gallery, process, about, faq of rich_text) — de bezoeker vindt nergens inhoudelijk aanbod."
    );
  }

  // 3. TRUST: betrouwbaar bewijs of een expliciete, eerlijke uitzondering.
  const trustPlanned = instances.some(({ instance }) =>
    TRUST_SECTION_TYPES.has(instance.type as BlueprintSectionType)
  );
  const trustDataRegistered =
    blueprint.trustElements.usps.length > 0 || blueprint.trustElements.stats.length > 0;
  const trustDisclosed = blueprint.missingInformation.some((entry) =>
    TRUST_DISCLOSURE_PATTERN.test(entry)
  );
  let trust: ConversionTrustStatus;
  if (trustPlanned) {
    trust = { satisfied: true, waived: false };
  } else if (trustDisclosed) {
    trust = { satisfied: true, waived: true };
  } else {
    trust = { satisfied: false, waived: false };
    errors.push(
      "Conversieketen: geen trust-sectie en geen expliciete registratie van ontbrekend betrouwbaar bewijs in missingInformation — registreer het ontbreken eerlijk (nooit trust claims verzinnen)."
    );
  }
  // Anti-fabricatie, omgekeerde richting: geregistreerde ECHTE trust-data moet
  // ook echt zichtbaar worden gepland, niet als 'ontbrekend' worden weggezet.
  if (!trustPlanned && trustDataRegistered) {
    errors.push(
      "Conversieketen: trustElements bevatten geregistreerde echte data, maar er is geen trust-sectie gepland — gebruik de echte data in de compositie i.p.v. deze te negeren."
    );
  }

  // 4. ACTION: minimaal één daadwerkelijk uitvoerbare conversie.
  const action = instances.some(({ instance }) =>
    ACTION_SECTION_TYPES.has(instance.type as BlueprintSectionType)
  );
  if (!action) {
    errors.push(
      "Conversieketen: geen action-sectie (cta, contact, booking of newsletter) — de website biedt nergens een uitvoerbare conversie."
    );
  }

  return {
    passed: errors.length === 0,
    errors,
    chain: { attention, interest, trust, action },
  };
}

/**
 * Deterministische consistentie-checks op een Zod-geldig blueprint.
 * Vallen buiten Zod omdat ze afhankelijk zijn van de project-requirements
 * (prijsintegriteit) en van het bijbehorende v1 Design Plan (navigatie,
 * pageStructure). Dezelfde falingssemantiek als
 * validateDesignPlanConsistency: niet-geslaagd = plan faalt.
 */
export function validateBlueprintConsistency(
  blueprint: WebsiteBlueprint,
  requirements: ProjectRequirements,
  planNavigationItems?: Array<{ label: string; pageKey: string }>,
  planPageStructureKeys?: string[]
): BlueprintConsistencyResult {
  const errors: string[] = [];

  // 1. PRIJSINTEGRITEIT: exact het vereiste aantal pagina's — nooit meer,
  //    nooit minder (zelfde harde regel als bij Design Plan v1).
  if (requirements.numberOfPages != null && blueprint.pages.length !== requirements.numberOfPages) {
    errors.push(
      `Blueprint plant ${blueprint.pages.length} pagina('s), maar de requirements vermelden ${requirements.numberOfPages} — de goedgekeurde scope mag nooit stilzwijgend wijzigen.`
    );
  }

  // 2. Unieke paginakeys.
  const seenKeys = new Set<string>();
  for (const page of blueprint.pages) {
    if (seenKeys.has(page.key)) {
      errors.push(`Paginakey "${page.key}" komt dubbel voor in het blueprint.`);
    }
    seenKeys.add(page.key);
  }

  // 3. Navigatie (uit Design Plan v1) moet naar blueprint-pagina's wijzen.
  for (const item of planNavigationItems ?? []) {
    if (!seenKeys.has(item.pageKey)) {
      errors.push(`Navigatie-item "${item.label}" verwijst naar blueprint-onbekende pagina "${item.pageKey}".`);
    }
  }

  // 4. V1-paginastructuur en blueprint moeten dezelfde paginaset beschrijven
  //    (één bron van waarheid; anders is het plan intern inconsistent).
  if (planPageStructureKeys && planPageStructureKeys.length > 0) {
    const planKeys = new Set(planPageStructureKeys);
    for (const key of planKeys) if (!seenKeys.has(key)) errors.push(`Pagina "${key}" staat in pageStructure maar niet in het blueprint.`);
    for (const key of seenKeys) if (!planKeys.has(key)) errors.push(`Pagina "${key}" staat in het blueprint maar niet in pageStructure.`);
  }

  // 5. COMPOSITIE-VLOER per pagina:
  //    - exact één homepage; hero altijd als eerste instantie;
  //    - homepage bevat minimaal één conversiesectie (contact/booking/cta);
  //    - geen twee identieke sectietypes direct achter elkaar;
  //    - maximaal 2 cta-secties en maximaal 2 primaire CTA's per pagina;
  //    - een contact-pagina bevat een contact-instantie.
  const homePages = blueprint.pages.filter((p) => HOME_KEYS.has(p.key.toLowerCase()));
  if (homePages.length > 1) {
    errors.push("Het blueprint bevat meerdere homepages (home/index/start/homepage) — precies één is toegestaan.");
  }
  if (blueprint.pages.length >= 1 && homePages.length === 0) {
    errors.push("Het blueprint bevat geen homepage (key: home/index/start/homepage).");
  }
  for (const page of blueprint.pages) {
    const isHome = HOME_KEYS.has(page.key.toLowerCase());
    if (isHome) {
      if (page.sectionInstances[0]?.type !== "hero") {
        errors.push(`Homepage "${page.key}" moet met een hero-sectie beginnen (nu: "${page.sectionInstances[0]?.type ?? "geen"}").`);
      }
      if (!page.sectionInstances.some((s) => CONVERSION_SECTION_TYPES.has(s.type as BlueprintSectionType))) {
        errors.push(`Homepage "${page.key}" bevat geen conversiesectie (contact, booking of cta).`);
      }
      const heroCount = page.sectionInstances.filter((s) => s.type === "hero").length;
      if (heroCount > 1) {
        errors.push(`Homepage "${page.key}" bevat ${heroCount} hero-secties — maximaal één is toegestaan.`);
      }
    }
    let previousType: string | null = null;
    let ctaSections = 0;
    let primaryCtas = 0;
    const typeCounts = new Map<string, number>();
    for (const instance of page.sectionInstances) {
      if (instance.type === previousType) {
        errors.push(`Pagina "${page.key}" heeft twee identieke "${instance.type}"-secties direct achter elkaar.`);
      }
      previousType = instance.type;
      if (instance.type === "cta") {
        ctaSections += 1;
        if (instance.cta?.prominence === "primary") primaryCtas += 1;
      } else if (instance.cta?.prominence === "primary") {
        primaryCtas += 1;
      }
      typeCounts.set(instance.type, (typeCounts.get(instance.type) ?? 0) + 1);
    }
    if (ctaSections > 2) {
      errors.push(`Pagina "${page.key}" bevat ${ctaSections} cta-secties — maximaal 2 per pagina.`);
    }
    if (primaryCtas > 2) {
      errors.push(`Pagina "${page.key}" bevat ${primaryCtas} primaire CTA's — maximaal 2 per pagina.`);
    }
    for (const [type, count] of typeCounts) {
      if (count > 3) {
        errors.push(`Pagina "${page.key}" bevat ${count} "${type}"-secties — maximaal 3 per type per pagina.`);
      }
    }
    if (page.key.toLowerCase() === "contact" && !page.sectionInstances.some((s) => s.type === "contact")) {
      errors.push(`De contactpagina "${page.key}" bevat geen contact-sectie.`);
    }
  }

  // 6. CTA-targets moeten uitvoerbaar zijn: paginakey, '#anker', 'form',
  //    mailto:, tel: of een volledige URL.
  const validTarget = (target: string): boolean => {
    if (seenKeys.has(target)) return true;
    if (target.startsWith("#")) return true;
    if (target === "form") return true;
    if (target.startsWith("mailto:") || target.startsWith("tel:")) return true;
    if (target.startsWith("/") || /^https?:\/\//.test(target)) return true;
    return false;
  };
  for (const page of blueprint.pages) {
    for (const instance of page.sectionInstances) {
      if (instance.cta && !validTarget(instance.cta.target)) {
        errors.push(
          `CTA-doel "${instance.cta.target}" op pagina "${page.key}" is niet uitvoerbaar (geen paginakey, anker, form, mailto/tel of URL).`
        );
      }
    }
  }

  // 7. ANTI-FABRICATIE (planning targets): trust-gebonden sectietypes
  //    vereisen geregistreerde ECHTE data in trustElements. Dit is de
  //    machine-kant van de evidence_only-regel: wie een usp_band/stats-sectie
  //    plant zonder geregistreerde echte USP's/cijfers, verzint die.
  const TRUST_BOUND: Array<{ type: BlueprintSectionType; kind: "usps" | "stats" }> = [
    { type: "usp_band", kind: "usps" },
    { type: "stats", kind: "stats" },
  ];
  for (const page of blueprint.pages) {
    for (const instance of page.sectionInstances) {
      for (const bound of TRUST_BOUND) {
        if (instance.type !== bound.type) continue;
        if (blueprint.trustElements[bound.kind].length === 0) {
          errors.push(
            `Sectie "${instance.type}" op pagina "${page.key}" is evidence_only maar trustElements.${bound.kind} is leeg — plan deze sectie alleen met geregistreerde echte data (anti-fabricatie).`
          );
        }
      }
    }
  }

  // 8. CONVERSIEKETEN (A3): attention/interest/trust/action — logisch
  //    genoeg, zonder één vaste sectievolgorde af te dwingen. Trust mag
  //    ontbreken mits eerlijk geregistreerd; fabricatie blijft geblokkeerd.
  const conversion = validateConversionStructure(blueprint);
  errors.push(...conversion.errors);

  return { passed: errors.length === 0, errors };
}
