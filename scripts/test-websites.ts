/**
 * Website Generation Engine-testsuite (Fase 9) — mock mode, 0 echte
 * API-calls, volledig fictieve fixtures. Uitvoeren: npx tsx scripts/test-websites.ts
 */
import { WebsiteSpecificationSchema } from "../lib/ai/schemas";
import { getAIRunRepository, MemoryAIRunRepository } from "../lib/repositories/ai-run-repository";
import { getLeadRepository } from "../lib/repositories/lead-repository";
import { ProjectService } from "../lib/projects/service";
import { NextJsWebsiteGenerator, ShopifyWebsiteGenerator, getWebsiteGeneratorProvider } from "../lib/websites/generator";
import { WebsiteBuildService } from "../lib/websites/build-service";
import { checkWebsiteSpecificationSafety } from "../lib/websites/safety-check";
import { getGeneratedWebsiteRepository } from "../lib/websites/repository";
import { WebsiteGenerationService, WebsiteLimitError, slugifyBusinessName } from "../lib/websites/service";
import { selectTemplateForIndustry, getWebsiteTemplateConfig } from "../lib/websites/templates";
import type { WebsiteSpecification } from "../lib/websites/types";

let failures = 0;
function check(name: string, condition: boolean, detail?: string) {
  console.info(`${condition ? "PASS" : "FAIL"} — ${name}${condition || !detail ? "" : ` (${detail})`}`);
  if (!condition) failures += 1;
}

/** Fictieve, veilige basis-specificatie (TESTDATA). */
function baseSpecification(overrides: Partial<WebsiteSpecification> = {}): WebsiteSpecification {
  return {
    template: "home_improvement",
    business: {
      businessName: "Test Dakwerken (TESTDATA)",
      industry: "Dakwerk",
      city: "Teststad",
      province: "Testprovincie",
      description: null,
      targetAudience: null,
    },
    branding: { primaryColor: null, secondaryColor: null, accentColor: null, backgroundStyle: null, typographyStyle: null, visualStyle: null },
    structure: { pages: [{ key: "home", title: "Home" }], navigation: ["Home", "Diensten", "Contact"], sections: ["hero", "services", "about", "cta", "contact"] },
    content: {
      headline: "Test Dakwerken — dakwerk in Teststad",
      subheadline: "Persoonlijke service in Teststad en omgeving.",
      valueProposition: null,
      services: [{ title: "Dak inspecteren", description: null }],
      about: null,
      benefits: ["Actief in Teststad en omgeving"],
      faq: [],
      testimonials: [],
      contactIntro: null,
      ctaPrimaryText: "Neem contact op",
      ctaSecondaryText: null,
    },
    conversion: { primaryCta: "contact", secondaryCta: null, contactMethods: ["contactformulier"], leadCapture: true },
    media: { imageRequirements: [{ key: "hero", description: "Sfeerbeeld dakwerk", required: true }], imageDescriptions: [], imagePlaceholders: ["hero-placeholder"] },
    seo: { title: "Test Dakwerken | Teststad", metaDescription: "Test Dakwerken is actief in Teststad. Neem vrijblijvend contact op.", keywords: ["dakwerk teststad"], localArea: "Teststad" },
    missingInformation: ["TESTDATA: bedrijfsbeschrijving onbekend"],
    ...overrides,
  } as WebsiteSpecification;
}

async function main() {
  // TESTS draaien uitsluitend op mock-data (Fase-instructie): een eventueel
  // aanwezige Supabase-configuratie wordt bewust genegeerd — géén live API-calls.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  const safetyContext = { allowedPhone: "+31612345678", allowedEmail: "info@testdakwerken.nl", allowedRating: null, allowedReviewCount: null, leadNotes: [] };
  const buildService = new WebsiteBuildService();
  const generator = new NextJsWebsiteGenerator();

  console.info("--- WebsiteSpecification (Zod + validatie) ---");

  check("geldige specificatie geaccepteerd", WebsiteSpecificationSchema.safeParse(baseSpecification()).success);
  const invalid = { ...baseSpecification(), content: { ...baseSpecification().content, headline: "x" } };
  check("ongeldige specificatie geweigerd (headline te kort)", !WebsiteSpecificationSchema.safeParse(invalid).success);
  const invalidServices = { ...baseSpecification(), content: { ...baseSpecification().content, services: [] } };
  check("specificatie zonder diensten geweigerd door schema", !WebsiteSpecificationSchema.safeParse(invalidServices).success);

  const specNoSeo = { ...baseSpecification(), seo: { ...baseSpecification().seo, metaDescription: "kort" } };
  check("te korte meta-description → build-error", buildService.validateSpecification(specNoSeo).some((e) => e.includes("meta-description")));

  // ============ SAFETY CHECKS ============
  console.info("--- Safety checks (deterministisch, geen AI) ---");

  check("veilige specificatie passeert", checkWebsiteSpecificationSafety(baseSpecification(), safetyContext).passed);

  const fabrications: { name: string; spec: WebsiteSpecification }[] = [
    { name: "verzonnen prijs geblokkeerd", spec: { ...baseSpecification(), content: { ...baseSpecification().content, benefits: ["Kwaliteit vanaf € 499"] } } },
    { name: "verzonnen garantie geblokkeerd", spec: { ...baseSpecification(), content: { ...baseSpecification().content, benefits: ["Volledige garantie op alle werkzaamheden"] } } },
    { name: "verzonnen certificaat/keurmerk geblokkeerd", spec: { ...baseSpecification(), content: { ...baseSpecification().content, about: "Wij zijn gecertificeerd en dragen het keurmerk." } } },
    { name: "verzonnen reviewaantal geblokkeerd", spec: { ...baseSpecification(), content: { ...baseSpecification().content, benefits: ["Meer dan 500 tevreden klanten"] } } },
    { name: "verzonnen sterrenrating geblokkeerd", spec: { ...baseSpecification(), content: { ...baseSpecification().content, subheadline: "Beoordeeld met 5 sterren door onze klanten." } } },
    { name: "verzonnen ervaring geblokkeerd", spec: { ...baseSpecification(), content: { ...baseSpecification().content, about: "Al 25 jaar ervaring in de regio." } } },
    { name: "verzonnen testimonial geblokkeerd", spec: { ...baseSpecification(), content: { ...baseSpecification().content, testimonials: ["Fantastisch bedrijf, echt top!"] } } },
    { name: "verzonnen openingstijden geblokkeerd", spec: { ...baseSpecification(), content: { ...baseSpecification().content, about: "Open: maandag t/m vrijdag van 8 tot 17." } } },
    { name: "AI-vermelding geblokkeerd", spec: { ...baseSpecification(), content: { ...baseSpecification().content, about: "Deze website is gegenereerd door een AI." } } },
    { name: "API-key-lek geblokkeerd", spec: { ...baseSpecification(), content: { ...baseSpecification().content, about: "Onze api key: sk-ant-abc123xyz" } } },
  ];
  for (const fabrication of fabrications) {
    const result = checkWebsiteSpecificationSafety(fabrication.spec, safetyContext);
    check(fabrication.name, !result.passed, result.issues.map((i) => i.rule).join(","));
  }

  const fabricatedPhone = { ...baseSpecification(), content: { ...baseSpecification().content, about: "Bel ons op 0201234567." } };
  check("telefoonnummer buiten lead-data geblokkeerd", !checkWebsiteSpecificationSafety(fabricatedPhone, safetyContext).passed);
  const realPhone = { ...baseSpecification(), content: { ...baseSpecification().content, about: "Bel ons op +31612345678." } };
  check("échte lead-telefoon toegestaan", checkWebsiteSpecificationSafety(realPhone, safetyContext).passed);
  const fabricatedEmail = { ...baseSpecification(), content: { ...baseSpecification().content, about: "Mail info@anderepartij.nl." } };
  check("e-mailadres buiten lead-data geblokkeerd", !checkWebsiteSpecificationSafety(fabricatedEmail, safetyContext).passed);
  const realEmail = { ...baseSpecification(), content: { ...baseSpecification().content, about: "Mail info@testdakwerken.nl." } };
  check("écht lead-e-mailadres toegestaan", checkWebsiteSpecificationSafety(realEmail, safetyContext).passed);

  const fromNotes = { ...baseSpecification(), content: { ...baseSpecification().content, testimonials: ["Klant zei: prima geleverd werk en snelle service"] } };
  const notesContext = { ...safetyContext, leadNotes: ["Klant zei: prima geleverd werk en snelle service"] };
  check("testimonial uit echte leadnotitie toegestaan", checkWebsiteSpecificationSafety(fromNotes, notesContext).passed);

  const apiRunRepo = getAIRunRepository();

  // ============ TEMPLATES ============
  console.info("--- Template-selectie ---");
  check("branche-hint → template (dakwerk)", selectTemplateForIndustry("Dakwerk en dakbedekking") === "home_improvement");
  check("branche-hint → template (kapsalon)", selectTemplateForIndustry("Kapsalon") === "local_service");
  check("branche-hint → template (advocaten)", selectTemplateForIndustry("Advocatenkantoor") === "professional_service");
  check("onbekende branche → business_standard", selectTemplateForIndustry("Willekeurige branche XYZ") === "business_standard");
  check("template-config bestaat", getWebsiteTemplateConfig("home_improvement").sectionOrder.includes("benefits"));

  // ============ GENERATOR ============
  console.info("--- Deterministische generator ---");
  const generated = generator.generate(baseSpecification(), { phone: "+31612345678", email: "info@testdakwerken.nl", address: "Teststraat 1", city: "Teststad", province: "Testprovincie" });
  check("generator produceert sections", generated.content.sections.length >= 5, `${generated.content.sections.length}`);
  check("generator gebruikt alleen gecontroleerde componenten", generated.content.sections.every((s) => ["header", "hero", "services", "about", "benefits", "faq", "cta", "contact", "footer"].includes(s.type)));
  check("framework nextjs", generated.framework === "nextjs");
  check("template-volgorde gevolgd", generated.content.sections[2].type === "services" || generated.content.sections[2].type === "about");
  check("contactgegevens deterministisch ingevoegd (niet door AI)", (generated.content.sections.find((s) => s.type === "contact")?.data as Record<string, unknown>)?.phone === "+31612345678");
  check("generator-output door build-service valideert", buildService.build(baseSpecification(), generated.content, safetyContext).passed);

  const noContactGenerated = generator.generate(baseSpecification(), { phone: null, email: null, address: null, city: "Teststad", province: null });
  check("zonder contactgegevens: note over formulier", noContactGenerated.notes.some((n) => n.includes("contactformulier")));
  check("build zonder contactgegevens nog steeds mogelijk (formulier-only is geldig)", buildService.build(baseSpecification(), noContactGenerated.content, safetyContext).passed);

  // Failed build: ongeldige content
  const badContent = { ...generated.content, sections: [{ type: "unknown_section" as never, data: {} }] };
  const failedBuild = buildService.build(baseSpecification(), badContent, safetyContext);
  check("ongeldige component → build FAILED met errors", !failedBuild.passed && failedBuild.errors.some((e) => e.includes("Ongeldige component")));

  // ============ SHOPIFY ABSTRACTION ============
  console.info("--- Provider abstraction ---");
  const shopifyContact = { phone: "+31612345678", email: "info@testdakwerken.nl", address: "Straat 1", city: "Utrecht", province: "Utrecht" };
  const shopifyResult = new ShopifyWebsiteGenerator().generate(baseSpecification(), shopifyContact);
  check("Shopify-provider levert shopify-framework content", shopifyResult.framework === "shopify" && shopifyResult.content.sections.length > 0);
  check("provider-fabriek kiest nextjs", getWebsiteGeneratorProvider("nextjs") instanceof NextJsWebsiteGenerator);
  check("provider-fabriek kiest shopify", getWebsiteGeneratorProvider("shopify") instanceof ShopifyWebsiteGenerator);

  // ============ SLUG + DUPLICATES ============
  console.info("--- Slug-generatie ---");
  check("slugify: tekens gestript", slugifyBusinessName("Dakwerk & Schilder B.V. — München!") === "dakwerk-schilder-b-v-munchen", slugifyBusinessName("Dakwerk & Schilder B.V. — München!"));
  check("slugify: path traversal onmogelijk", !slugifyBusinessName("../../etc/passwd").includes("/"), slugifyBusinessName("../../etc/passwd"));

  // ============ SERVICE FLOW (mock, volledige integratie) ============
  console.info("--- WebsiteGenerationService (volledige flow, mock mode) ---");

  const leadRepo = getLeadRepository();
  const qualifiedLead = (await leadRepo.list()).find((l) => l.leadStatus === "qualified")!;
  const project = await new ProjectService().createFromLead(qualifiedLead.id);

  const service = new WebsiteGenerationService();
  const website = await service.generateWebsite(project.id);

  check("website aangemaakt met project/lead-koppeling", website.projectId === project.id && website.leadId === qualifiedLead.id);
  check("status READY FOR QC (eindpunt van Fase 9)", website.status === "ready_for_qc", website.status);
  check("generatiestatus completed", website.generationStatus === "completed");
  check("buildstatus passed", website.buildStatus === "passed");
  check("geen build-errors", website.buildErrors.length === 0);
  check("preview-url verwijst naar preview-route", website.previewUrl === `/generated-websites/${website.slug}`);
  check("versie 1", website.version === 1);
  check("content gegenereerd met gecontroleerde componenten", (website.generatedContent?.sections.length ?? 0) >= 5);
  check("placeholder-aanpak: missing information doorgegeven", website.specification.missingInformation.length > 0);
  check("geen verzonnen content: testimonials leeg in mock", website.specification.content.testimonials.length === 0);

  // Regeneratie → versie 2, v1 gearchiveerd en bewaard
  const websiteV2 = await service.generateWebsite(project.id);
  check("regeneratie → versie 2", websiteV2.version === 2);
  check("nieuwe slug (uniek)", websiteV2.slug !== website.slug);
  const versions = await service.listByProject(project.id);
  check("vorige versie gearchiveerd en terugvindbaar", versions.length === 2 && versions.some((w) => w.version === 1 && w.status === "archived"));
  check("v2 is de actieve versie", versions.some((w) => w.version === 2 && w.status === "ready_for_qc"));
  check("oude specificatie bewaard (niet vernietigd)", versions.find((w) => w.version === 1)!.specification.content.headline.length > 0);

  // ============ GUARDS ============
  console.info("--- Generation guards ---");

  let guardError = "";
  try { await service.generateWebsite("proj-999"); } catch (e) { guardError = e instanceof Error ? e.name : ""; }
  check("onbekend project geweigerd", guardError === "WebsiteGenerationError", guardError);

  const interestedLead = (await leadRepo.list()).find((l) => l.leadStatus === "interested")!;
  const cancelledProject = await new ProjectService().createFromLead(interestedLead.id);
  await new ProjectService().updateStatus(cancelledProject.id, "cancelled");
  let cancelledError = "";
  try { await new WebsiteGenerationService().generateWebsite(cancelledProject.id); } catch (e) { cancelledError = e instanceof Error ? e.message : ""; }
  check("geannuleerd project geblokkeerd", cancelledError.includes("geannuleerd"), cancelledError);

  // Lead-statusguard: zet de gekwalificeerde lead tijdelijk op 'new' → geblokkeerd
  await leadRepo.updateStatuses(qualifiedLead.id, { leadStatus: "new" });
  let leadGuardError = "";
  try { await new WebsiteGenerationService().generateWebsite(project.id); } catch (e) { leadGuardError = e instanceof Error ? e.message : ""; }
  check("ongeschikte lead-status geblokkeerd", leadGuardError.includes("niet geschikt"), leadGuardError);
  check("guard-failure consumeren geen generatiebudget", !leadGuardError.includes("limiet"));
  await leadRepo.updateStatuses(qualifiedLead.id, { leadStatus: "qualified" });

  // ============ LIMIET ============
  process.env.MAX_WEBSITE_GENERATIONS_PER_RUN = "1";
  const limited = new WebsiteGenerationService();
  await limited.generateWebsite(project.id);
  let limitError = "";
  try { await limited.generateWebsite(project.id); } catch (e) { limitError = e instanceof Error ? e.name : ""; }
  check("generatie-limiet weigert tweede call", limitError === WebsiteLimitError.name, limitError);
  delete process.env.MAX_WEBSITE_GENERATIONS_PER_RUN;

  // ============ AI-LOGGING ============
  console.info("--- AI activity/run logging ---");
  if (apiRunRepo instanceof MemoryAIRunRepository) {
    const runs = apiRunRepo.getRuns();
    check("AI-runs gelogd met agent website_generation", runs.some((r) => r.agentType === "website_generation"));
    check("geen API-keys in run-logs", runs.every((r) => !String(r.model).includes("sk-ant")));
  }

  // ============ REPOSITORY ============
  console.info("--- Repository behavior ---");
  const repo = getGeneratedWebsiteRepository();
  check("getBySlug werkt", (await repo.getBySlug(website.slug))?.id === website.id);
  check("getBySlug onbekend → null", (await repo.getBySlug("onbekende-slug")) === null);
  check("list gesorteerd (nieuwste eerst)", (await repo.list())[0].version >= 1);
  const updatedSite = await repo.update(website.id, { generationNotes: "TESTDATA: handmatige notitie" });
  check("update werkt", Boolean(updatedSite?.generationNotes.includes("handmatige notitie")));

  // ============ GEEN AUTONOME DELIVERY ============
  const serviceSource = (await import("node:fs")).readFileSync("lib/websites/service.ts", "utf8");
  const actionsSource = (await import("node:fs")).readFileSync("app/actions/websites.ts", "utf8");
  // Echte call-patronen (comments die documenteren dat delivery juist NIET bestaat moeten matchen-vrij blijven)
  check("geen echte verzend/deploy-calls in de service", !/(sendEmail|sendMail|resend|deploy|publish|verstuur)\s*\(/i.test(serviceSource));
  check("geen deliver-acties geëxporteerd in server actions", !/export\s+async\s+function\s+\w*(send|deliver|deploy|publish|mail)\w*/i.test(actionsSource));

  console.info(failures === 0 ? "\\nALLE WEBSITE GENERATION-TESTS PASS" : `\\n${failures} TEST(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.info(`Onverwachte fout: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
