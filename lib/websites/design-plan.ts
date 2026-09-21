import { z } from "zod";
import type { ProjectRequirements } from "@/lib/projects/types";
import { scanTextForFabricationPatterns } from "./safety-check";
import { validateBlueprintConsistency, websiteBlueprintSchema } from "./blueprint/blueprint";
import { visualContractSchema, type VisualContract } from "./visual-contract";

/**
 * Design Plan (Fase I.1) — het INTERNE ontwerpplan per project.
 *
 * ARCHITECTUUR: net als de WebsiteSpecification is het Design Plan een
 * gestructureerd, Zod-gevalideerd document. De AI plant; de app valideert
 * deterministisch. Het plan is intern voorbereidingsmateriaal voor de
 * (latere) Shopify-websitegeneratie en is NOOIT klantzichtbaar.
 *
 * HARD REGELS:
 * - Geen verzonnen bedrijfsfeiten: alles wat onbekend is, is null of een
 *   expliciete missingInformation-entry.
 * - De paginastructuur MAG NIET afwijken van de goedgekeurde requirements
 *   ( numberOfPages): pagina's worden nooit stilzwijgend opgehoogd —
 *   prijsintegriteit is een harde, deterministische check.
 * - Functionele features vermelden hun bron (requirements/questionnaire/
 *   lead_notes) — nooit een verzonnen bron.
 */

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const designPlanSchema = z.object({
  goals: z.object({
    primaryGoal: z.string().min(3).max(300).nullable(),
    secondaryGoals: z.array(z.string().min(3).max(200)).max(5),
    conversionGoal: z.string().min(3).max(300).nullable(),
  }),
  audience: z.object({
    primaryAudience: z.string().min(3).max(300).nullable(),
    secondaryAudiences: z.array(z.string().min(3).max(200)).max(5),
    toneOfVoice: z.string().min(3).max(200).nullable(),
  }),
  navigation: z.object({
    items: z
      .array(z.object({ label: z.string().min(1).max(40), pageKey: z.string().min(1).max(60) }))
      .min(1)
      .max(8),
    structure: z.string().min(3).max(300).nullable(),
  }),
  pageStructure: z
    .array(
      z.object({
        key: z.string().min(1).max(60),
        title: z.string().min(1).max(120).nullable(),
        purpose: z.string().min(3).max(500).nullable(),
        sections: z.array(z.string().min(2).max(120)).min(1).max(12),
      })
    )
    .min(1)
    .max(10),
  visualHierarchy: z.object({
    strategy: z.string().min(3).max(500).nullable(),
    aboveTheFold: z.array(z.string().min(2).max(200)).max(8),
  }),
  branding: z.object({
    styleDirection: z.string().min(3).max(300).nullable(),
    mood: z.array(z.string().min(2).max(80)).max(8),
    existingBrandAssets: z.string().min(3).max(500).nullable(),
    preferredColors: z.array(z.string().min(2).max(80)).max(8),
    dislikedColors: z.array(z.string().min(2).max(80)).max(8),
    restrictions: z.array(z.string().min(2).max(200)).max(8),
  }),
  /**
   * VISUAL CONTRACT (Design Token Engine D1, 2026-09-21) — machine-uitvoerbaar
   * ontwerpcontract: enum-gesloten font-pairing, paletstemming, typografische
   * curve, dichtheid en motion-niveau. ADDITIEF en OPTIONEEL: plannen zonder
   * visualContract (alle plannen vóór D1) blijven exact geldig en renderen
   * via de bestaande keyword-mapping (systeem-fonts, geen paletguard).
   */
  visualContract: visualContractSchema.nullable().optional(),
  typography: z.object({
    pairing: z.string().min(3).max(300).nullable(),
    scale: z.string().min(3).max(200).nullable(),
    weights: z.array(z.string().min(1).max(40)).max(6),
    rationale: z.string().min(3).max(500).nullable(),
  }),
  colors: z.object({
    primary: z.string().regex(HEX_COLOR, "Kleur moet een hex-waarde zijn (#rrggbb)").nullable(),
    secondary: z.string().regex(HEX_COLOR, "Kleur moet een hex-waarde zijn (#rrggbb)").nullable(),
    accent: z.string().regex(HEX_COLOR, "Kleur moet een hex-waarde zijn (#rrggbb)").nullable(),
    neutrals: z.array(z.string().regex(HEX_COLOR, "Kleur moet een hex-waarde zijn (#rrggbb)")).max(6),
    usageGuidance: z.string().min(3).max(500).nullable(),
  }),
  spacing: z.object({
    scale: z.string().min(3).max(200).nullable(),
    density: z.string().min(3).max(200).nullable(),
  }),
  components: z
    .array(
      z.object({
        key: z.string().min(1).max(60),
        purpose: z.string().min(3).max(300),
        notes: z.string().min(3).max(300).nullable(),
      })
    )
    .min(1)
    .max(20),
  ctaStrategy: z.object({
    primary: z.string().min(2).max(120).nullable(),
    secondary: z.string().min(2).max(120).nullable(),
    placement: z.array(z.string().min(2).max(200)).max(8),
    leadCapture: z.boolean().nullable(),
  }),
  imagery: z.object({
    style: z.string().min(3).max(300).nullable(),
    requirements: z.array(z.string().min(3).max(300)).max(10),
    placeholderStrategy: z.string().min(3).max(300).nullable(),
  }),
  responsive: z.object({
    mobile: z.string().min(3).max(300).nullable(),
    tablet: z.string().min(3).max(300).nullable(),
    desktop: z.string().min(3).max(300).nullable(),
    breakpoints: z.array(z.string().min(1).max(40)).max(6),
  }),
  animation: z.object({
    strategy: z.string().min(3).max(300).nullable(),
    allowed: z.array(z.string().min(2).max(120)).max(8),
    restrictions: z.array(z.string().min(2).max(200)).max(8),
  }),
  functionality: z.object({
    features: z
      .array(
        z.object({
          key: z.string().min(1).max(60),
          description: z.string().min(3).max(300),
          source: z.enum(["requirements", "questionnaire", "lead_notes"]),
        })
      )
      .max(20),
    integrations: z.array(z.string().min(2).max(120)).max(10),
  }),
  accessibility: z.object({
    contrast: z.string().min(3).max(300).nullable(),
    focusAndKeyboard: z.string().min(3).max(300).nullable(),
    semantics: z.string().min(3).max(300).nullable(),
    formsAndLabels: z.string().min(3).max(300).nullable(),
    guidelines: z.array(z.string().min(2).max(120)).max(8),
  }),
  seoPerformance: z.object({
    titleStrategy: z.string().min(3).max(300).nullable(),
    metaStrategy: z.string().min(3).max(300).nullable(),
    localSeo: z.string().min(3).max(300).nullable(),
    performanceBudget: z.string().min(3).max(300).nullable(),
    imageOptimization: z.string().min(3).max(300).nullable(),
  }),
  basis: z.object({
    sources: z.array(z.enum(["lead", "project", "requirements", "questionnaire", "sales_context"])).min(1),
  }),
  /**
   * WEBSITE BLUEPRINT v2 (Fase A, 2026-09-19) — machine-uitvoerbare
   * website-architectuur: per pagina sectie-instanties (volgorde, layout,
   * blokken, media, CTA's) uit de gesloten SECTION-REGISTRY.
   *
   * ADDITIEF en OPTIONEEL: bestaande Design Plans (vóór de blueprint-fase)
   * blijven exact geldig; plan.blueprint === null betekent "nog geen
   * blueprint geplant". Compositie-/scope-checks lopen alleen als het
   * blueprint aanwezig is (zie validateDesignPlanConsistency).
   */
  blueprint: websiteBlueprintSchema.nullable().optional(),
  missingInformation: z.array(z.string().min(3).max(200)).max(20),
});

export type DesignPlan = z.infer<typeof designPlanSchema>;
export type { VisualContract };

export type DesignPlanStatus = "generating" | "completed" | "failed";

export interface DesignPlanRecord {
  id: string;
  projectId: string;
  leadId: string;
  version: number;
  status: DesignPlanStatus;
  plan: DesignPlan | null;
  missingInformation: string[];
  validationErrors: string[];
  model: string;
  mode: "mock" | "live";
  generationNotes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Deterministische consistentie-checks op een Zod-geldig Design Plan.
 * Deze checks vallen buiten Zod omdat ze afhankelijk zijn van de
 * project-requirements (prijsintegriteit) en de fabricatie-patronen.
 */
export function validateDesignPlanConsistency(
  plan: DesignPlan,
  requirements: ProjectRequirements,
  trustedClaims?: readonly string[]
): { passed: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. PRIJSINTEGRITEIT: het plan mag nooit meer (of minder) pagina's
  //    plannen dan de requirements vermelden. Eén pagina is geldig; pagina's
  //    worden nooit stilzwijgend toegevoegd.
  if (requirements.numberOfPages != null && plan.pageStructure.length !== requirements.numberOfPages) {
    errors.push(
      `Paginastructuur bevat ${plan.pageStructure.length} pagina('s), maar de requirements vermelden ${requirements.numberOfPages} — het plan mag de goedgekeurde scope nooit stilzwijgend wijzigen.`
    );
  }

  // 2. Navigatieverwijzingen moeten naar geplande pagina's wijzen.
  const pageKeys = new Set(plan.pageStructure.map((page) => page.key));
  for (const item of plan.navigation.items) {
    if (!pageKeys.has(item.pageKey)) {
      errors.push(`Navigatie-item "${item.label}" verwijst naar onbekende pagina "${item.pageKey}".`);
    }
  }

  // 3. FABRICATIE-SCAN: dezelfde patrooncontroles als de websitecontent
  //    (prijzen, garanties, certificeringen, ervaringsclaims, klantaantallen,
  //    reviewclaims, openingstijden, secrets, AI-vermeldingen, interne info)
  //    gelden óók voor het interne plan — het plan is de bron voor de latere
  //    websitegeneratie en mag geen ongefundeerde feiten bevatten.
  // E2E-bugfix (2026-09-20): klant-aangeleverde questionnaire-antwoorden zijn
  // bewezen echte claims (zelfde contract als blueprint-trustElements, Fase C):
  // een match die VERBATIM in die antwoorden staat is geen fabricatie. De AI
  // mag klantbewijs dus alleen exact echoën — afwijkende getallen, opgeblazen
  // varianten of eigen formuleringen blijven geblokkeerd.
  const fabricationIssues = scanTextForFabricationPatterns(JSON.stringify(plan), trustedClaims);
  if (fabricationIssues.length > 0) {
    errors.push(
      ...fabricationIssues.map((issue) => `Fabricatie-patroon "${issue.rule}" gevonden: ${issue.reason}`)
    );
  }

  // 4. BLUEPRINT v2 (alleen als aanwezig): scope/prijsintegriteit,
  //    navigatieverwijzingen, v1<->v2-paginaset en compositie-vloer.
  //    Backward compatible: plannen zonder blueprint (null/undefined)
  //    doorlopen deze tak niet en gedragen zich exact als voorheen.
  if (plan.blueprint != null) {
    const blueprintConsistency = validateBlueprintConsistency(
      plan.blueprint,
      requirements,
      plan.navigation.items,
      plan.pageStructure.map((page) => page.key)
    );
    if (!blueprintConsistency.passed) {
      errors.push(...blueprintConsistency.errors.map((error) => `Blueprint: ${error}`));
    }
  }

  return { passed: errors.length === 0, errors };
}
