/**
 * ECHTE EIND-TOT-EIND GENERATIE — Veld & Vorm (W3, 5 november 2026).
 *
 * Dit script gebruikt dezelfde AI-laag, prompts, schema's, deterministische
 * finalizer, claimkeuring en consistentiechecks als de productieflow. Wat het
 * NIET doet is Supabase-schrijfacties (bookkeeping): de uitkomst wordt als
 * artifact op schijf gezet zodat de meetlat hem kan renderen.
 *
 * Volgorde (identiek aan productie):
 *   brief → website-specificatie (AI) → design plan (AI, inclusief blueprint)
 *         → contentplan (AI) → finalizer → F/C/G-claims → contentkeuring
 *         → consistentie → Shopify-thema.
 *
 * Gebruik: AI_MODE=live npx tsx scripts/visual/veld-gen.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { AIService } from "../../lib/ai/service";
import type { DesignPlanInput } from "../../lib/ai/types";
import { designPlanSchema, validateDesignPlanConsistency, type DesignPlan } from "../../lib/websites/design-plan";
import { selectD3Compositions } from "../../lib/websites/blueprint/composition-engine";
import { selectTemplateForIndustry } from "../../lib/websites/templates";
import { assembleContentSourceBundle } from "../../lib/websites/content/content-source";
import { finalizeRawContentPlan, rawContentPlanOutputSchema } from "../../lib/websites/content/content-plan-finalizer";
import { mergeRepairedPages, pagesNeedingRepair, subsetBlueprint } from "../../lib/websites/content/content-repair";
import { normalizeClaims, auditClaims } from "../../lib/websites/content/claims";
import { auditContentQuality, summarizeQuality } from "../../lib/websites/content/content-quality";
import { validateContentPlanConsistency } from "../../lib/websites/content/content-plan";
import type { ContentPlan } from "../../lib/websites/content/content-plan";
import type { ProjectRequirements } from "../../lib/projects/types";
import { veldEnVormBrief, veldEnVormNotes } from "./veld-en-vorm-brief";

const OUT = join(process.cwd(), "visual-output", "veld-en-vorm");
const PLAN_DIR = join(OUT, "plans");

const requirements: ProjectRequirements = {
  websiteType: "business_website",
  numberOfPages: 5,
  designLevel: "premium",
  responsive: true,
  cms: true,
  ecommerce: false,
  customFunctionality: null,
  integrations: null,
  seo: true,
  copywriting: true,
  photography: false,
  hosting: true,
  maintenance: false,
  deadline: null,
  existingWebsite: false,
  existingBranding: false,
  contentAvailable: false,
  specialRequirements:
    "Vijf pagina's: home, over ons, diensten, contact en FAQ. Geen webshop. Geen prijzen of garanties op de site.",
};

const requirementsSummary = [
  `Website type: ${requirements.websiteType}`,
  `Aantal pagina's: ${requirements.numberOfPages}`,
  `Designniveau: ${requirements.designLevel}`,
  "Responsive: ja",
  "CMS: ja (Shopify OS 2.0)",
  "Webshop: nee",
  "SEO: ja",
  "Copywriting: ja (de studio schrijft de teksten)",
  "Fotografie: nog niet beschikbaar (beeld volgt later)",
  `Speciale eisen: ${requirements.specialRequirements}`,
].join("\n");

function log(step: string, detail: string) {
  console.log(`\n[${step}] ${detail}`);
}

async function main() {
  mkdirSync(PLAN_DIR, { recursive: true });
  const ai = new AIService();
  const suggestedTemplate = selectTemplateForIndustry(veldEnVormBrief.industry);

  /** Waar zit een claim? Zonder deze uitleg is "afgekeurd op garantie" niet te
   * repareren: we loggen het exacte veldpad + de tekst. */
  const findClaimPaths = (value: unknown, path = "plan"): string[] => {
    if (typeof value === "string") {
      return /garantie|gegarandeerd/i.test(value) ? [`${path}: ${value.slice(0, 140)}`] : [];
    }
    if (Array.isArray(value)) return value.flatMap((item, index) => findClaimPaths(item, `${path}[${index}]`));
    if (value && typeof value === "object") {
      return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => findClaimPaths(child, `${path}.${key}`));
    }
    return [];
  };

  const specPath = join(PLAN_DIR, "specification.json");
  const fresh = process.argv.includes("--fresh");
  const refinalize = process.argv.includes("--refinalize");

  // ---- 1. Website-specificatie (AI) -------------------------------------
  log("1/5", "Website-specificatie genereren");
  const specification = !fresh && existsSync(specPath)
    ? { data: JSON.parse(readFileSync(specPath, "utf8")), model: "cache", estimatedCost: 0 }
    : await ai.generateWebsiteSpecification(
    {
      businessName: veldEnVormBrief.businessName,
      industry: veldEnVormBrief.industry,
      city: veldEnVormBrief.city,
      province: veldEnVormBrief.province,
      address: null,
      phone: veldEnVormBrief.phone,
      email: veldEnVormBrief.email,
      website: veldEnVormBrief.website,
      leadNotes: veldEnVormNotes,
      requirementsSummary,
      existingWebsite: false,
      googleRating: null,
      reviewCount: null,
      suggestedTemplate,
      designPlanSummary: null,
    },
    requirements
  );
  console.log(
    `   ✓ ${specification.data.template}, ${specification.data.structure.pages.length} pagina's, ` +
      `${specification.data.missingInformation.length} ontbrekende punten, ${specification.model}, $${specification.estimatedCost.toFixed(2)}`
  );

  // ---- 2. Design plan (AI) ----------------------------------------------
  log("2/5", "Design plan + blueprint genereren");
  writeFileSync(specPath, JSON.stringify(specification.data, null, 2));
  const designInput: DesignPlanInput = {
    businessName: veldEnVormBrief.businessName,
    industry: veldEnVormBrief.industry,
    city: veldEnVormBrief.city,
    province: veldEnVormBrief.province,
    leadNotes: veldEnVormNotes,
    requirementsSummary,
    numberOfPages: 5,
    ecommerce: false,
    specialRequirements: requirements.specialRequirements ?? null,
    existingWebsite: false,
    googleRating: null,
    reviewCount: null,
    questionnaireSummary: [
      "Aangeleverde bedrijfsfeiten (enige toegestane bron):",
      ...veldEnVormNotes.map((line) => `- ${line}`),
      "Merkbelofte: Tuinen met karakter. Ontworpen voor het dagelijks leven.",
      "Er zijn nog geen foto's beschikbaar; de site moet ook zonder beeld sterk zijn.",
    ],
    hasCompletedQuestionnaire: true,
    suggestedTemplate,
  };
  // De AI mag geen enkel bedrijfsfeit toevoegen; garanties/prijzen zijn de
  // klassieke fabricage-valkuil. De deterministische check vangt het af — bij
  // een afkeuring proberen we het opnieuw met die feedback in de opdracht.
  const designPlanPath = join(PLAN_DIR, "design-plan.json");
  const cachedDesignPlan =
    !fresh && existsSync(designPlanPath)
      ? designPlanSchema.parse(JSON.parse(readFileSync(designPlanPath, "utf8")))
      : null;
  if (cachedDesignPlan) {
    console.log("   ✓ design plan uit cache ($0.00) — gebruik --fresh om opnieuw te plannen");
  }
  let designPlan: DesignPlan | null = cachedDesignPlan;
  let designModel = "cache";
  let designCost = 0;
  let consistency = { passed: false, errors: ["nog niet gevalideerd"] } as { passed: boolean; errors: string[] };
  let compositionAdjustments: string[] = [];
  if (cachedDesignPlan) {
    consistency = validateDesignPlanConsistency(cachedDesignPlan, requirements);
    if (!consistency.passed) {
      console.error("   ✗ gecachet design plan is niet meer consistent:", consistency.errors.slice(0, 3));
      process.exitCode = 1;
      return;
    }
  } else {
    let designResult = await ai.generateDesignPlan(designInput);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const composition = selectD3Compositions(designResult.data, {
        industry: veldEnVormBrief.industry,
        newGeneration: true,
        hasAvailableMedia: false,
      });
      const candidate = designPlanSchema.parse(composition.plan);
      const check = validateDesignPlanConsistency(candidate, requirements);
      if (check.passed) {
        designPlan = candidate;
        compositionAdjustments = composition.adjustments;
        consistency = check;
        designModel = designResult.model;
        designCost = designResult.estimatedCost;
        break;
      }
      console.log(`   ! poging ${attempt} afgekeurd: ${check.errors[0]}`);
      for (const hit of findClaimPaths(JSON.parse(JSON.stringify(designResult.data)))) {
        console.log(`       bron -> ${hit}`);
      }
      consistency = check;
      designResult = await ai.generateDesignPlan({
        ...designInput,
        specialRequirements:
          `${designInput.specialRequirements ?? ""}\nStreng: gebruik uitsluitend de aangeleverde feiten. Noem geen garanties, prijzen, certificeringen, keurmerken, aantallen projecten of beoordelingen.`.trim(),
      });
    }
    if (!designPlan) {
      console.error("   ✗ design plan afgekeurd:", consistency.errors);
      process.exitCode = 1;
      return;
    }
  }
  const acceptedDesign = designPlan;
  if (!acceptedDesign) {
    console.error("   ✗ design plan ontbreekt");
    process.exitCode = 1;
    return;
  }
  const blueprint = acceptedDesign.blueprint!;
  console.log(
    `   ✓ ${acceptedDesign.pageStructure.length} pagina's, ${blueprint.pages.length} blueprint-pagina's, ` +
      `${blueprint.pages.reduce((sum, page) => sum + page.sectionInstances.length, 0)} sectie-instanties, ` +
      `${designModel}, $${designCost.toFixed(2)}`
  );
  console.log(`   pagina's: ${blueprint.pages.map((page) => page.key).join(", ")}`);
  console.log(`   compositie-aanpassingen: ${compositionAdjustments.join(" | ") || "geen"}`);
  writeFileSync(join(PLAN_DIR, "specification.json"), JSON.stringify(specification.data, null, 2));
  writeFileSync(join(PLAN_DIR, "design-plan.json"), JSON.stringify(designPlan, null, 2));

  // ---- 3. Contentplan (AI) ----------------------------------------------
  log("3/5", "Contentplan genereren (echte copy)");
  const bundle = assembleContentSourceBundle({
    lead: {
      businessName: veldEnVormBrief.businessName,
      industry: veldEnVormBrief.industry,
      address: null,
      city: veldEnVormBrief.city,
      province: veldEnVormBrief.province,
      phone: veldEnVormBrief.phone,
      email: veldEnVormBrief.email,
      website: veldEnVormBrief.website,
      websiteStatus: veldEnVormBrief.websiteStatus,
      googleRating: null,
      reviewCount: null,
    },
    qualificationNotes: veldEnVormNotes,
    questionnaire: null,
    requirements,
    designPlan: acceptedDesign,
  });

  const rawContentPath = join(PLAN_DIR, "raw-content.json");
  // --refinalize: de opgeslagen AI-output opnieuw door de finalizer halen.
  // Nodig om een finalizer/keuringsfix te testen zonder een nieuwe betaalde
  // contentpass (en zonder de tekst te variëren).
  const cachedRaw = !fresh && refinalize && existsSync(rawContentPath);
  const raw = cachedRaw
    ? {
        data: rawContentPlanOutputSchema.parse(JSON.parse(readFileSync(rawContentPath, "utf8"))),
        model: "cache",
        estimatedCost: 0,
      }
    : await ai.generateContentPlan(
        {
          businessName: veldEnVormBrief.businessName,
          copywriting: true,
          bundle,
          blueprint,
          industry: veldEnVormBrief.industry,
          description: acceptedDesign.goals?.primaryGoal ?? null,
          serviceTitles: veldEnVormBrief.services.map((service) => service.title),
        },
        null
      );
  if (cachedRaw) console.log("   ✓ ruwe content uit cache ($0.00) — --fresh voor een nieuwe AI-pass");
  else writeFileSync(rawContentPath, JSON.stringify(raw.data, null, 2));
  const finalized = finalizeRawContentPlan({
    raw: raw.data,
    blueprint,
    bundle,
    copywriting: true,
    designPlanId: "veld-en-vorm",
  });
  let contentPlan: ContentPlan = normalizeClaims(finalized.plan);
  const ctaSectionsByPage = new Map<string, number>(
    blueprint.pages.map((page) => [
      page.key,
      page.sectionInstances.filter((instance) => instance.type === "cta").length,
    ])
  );
  let quality = auditContentQuality({ plan: contentPlan, ctaSectionsByPage });
  let claims = auditClaims(contentPlan);
  let contentConsistency = validateContentPlanConsistency(contentPlan, blueprint, bundle);
  let repairCost = 0;
  let repairRounds = 0;

  // REPARATIERONDE (W2: generate → fix → re-QC, luslimiet 2).
  // Alleen afgekeurde pagina's worden opnieuw opgevraagd; de rest blijft staan.
  for (let round = 1; round <= 2 && !quality.ok; round += 1) {
    const failingPages = pagesNeedingRepair(contentPlan, quality.issues);
    if (failingPages.length === 0) break;
    const issues = quality.issues
      .filter((issue) => issue.severity === "blocking")
      .map((issue) => `${issue.page} (${issue.code}): ${issue.message}`);
    console.log(`   ↻ herstelronde ${round}: ${failingPages.join(", ")}`);
    const repairedRaw = await ai.generateContentPlan(
      {
        businessName: veldEnVormBrief.businessName,
        copywriting: true,
        bundle,
        blueprint: subsetBlueprint(blueprint, failingPages),
        industry: veldEnVormBrief.industry,
        description: acceptedDesign.goals?.primaryGoal ?? null,
        serviceTitles: veldEnVormBrief.services.map((service) => service.title),
        repair: { issues },
      },
      null
    );
    repairCost += repairedRaw.estimatedCost;
    const repairedFinal = finalizeRawContentPlan({
      raw: repairedRaw.data,
      blueprint,
      bundle,
      copywriting: true,
      designPlanId: "veld-en-vorm",
    });
    const merged = mergeRepairedPages(
      contentPlan,
      normalizeClaims(repairedFinal.plan).pages.map((page) => ({ key: page.key, units: page.units }))
    );
    console.log(`   ✓ hersteld: ${merged.replaced.join(", ") || "(geen pagina vervangen)"}`);
    contentPlan = normalizeClaims(merged.plan);
    quality = auditContentQuality({ plan: contentPlan, ctaSectionsByPage });
    claims = auditClaims(contentPlan);
    contentConsistency = validateContentPlanConsistency(contentPlan, blueprint, bundle);
    repairRounds = round;
  }
  console.log(`   ✓ ${summarizeQuality(quality)}`);
  console.log(
    `   F ${claims.totals.F} · C ${claims.totals.C} · G ${claims.totals.G} · ` +
      `correcties ${finalized.corrections.length} · ${raw.model}, $${raw.estimatedCost.toFixed(2)}`
  );
  if (!quality.ok) {
    console.error("   ✗ contentkeuring blokkeert:", quality.issues.filter((i: { severity: string }) => i.severity === "blocking").slice(0, 5));
  }
  if (!contentConsistency.passed) {
    console.error("   ✗ content-consistentie:", contentConsistency.errors.slice(0, 5));
  }
  writeFileSync(join(PLAN_DIR, "content-plan.json"), JSON.stringify(contentPlan, null, 2));
  writeFileSync(
    join(PLAN_DIR, "report.md"),
    [
      `# Veld & Vorm — generatierapport`,
      ``,
      `- specificatie: ${specification.model}, template ${specification.data.template}`,
      `- design plan: ${acceptedDesign.pageStructure.length} pagina's, ${blueprint.pages.length} blueprint-pagina's`,
      `- contentplan: ${summarizeQuality(quality)}`,
      `- claims: F ${claims.totals.F}, C ${claims.totals.C}, G ${claims.totals.G}`,
      `- contentkeuring: ${quality.ok ? "PASS" : "FAIL"}`,
      `- design-consistentie: ${consistency.passed ? "PASS" : "FAIL"}`,
      `- content-consistentie: ${contentConsistency.passed ? "PASS" : "FAIL"}`,
      `- kosten: specificatie $${specification.estimatedCost.toFixed(3)}, design $${designCost.toFixed(3)}, content $${raw.estimatedCost.toFixed(3)}, herstel $${repairCost.toFixed(3)} (${repairRounds} ronde(n))`,
      ``,
      `## Pagina's`,
      ...blueprint.pages.map(
        (page) =>
          `- ${page.key}: ${page.sectionInstances.map((instance) => instance.type).join(" → ")}`
      ),
    ].join("\n")
  );
  log("klaar", `artefacten in ${PLAN_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
