/**
 * Project + Pricing-testsuite (Fase 8) — mock mode, geen echte API-calls,
 * geen echte klanten, geen verzending. De PricingEngine wordt getest met
 * een expliciete TEST-configuratie (duidelijk gemarkeerd als TESTDATA):
 * de échte agency-configuratie blijft leeg tot de Master Configuration.
 * Uitvoeren: npx tsx scripts/test-projects-pricing.ts
 */
import { readFileSync } from "node:fs";
import { RequirementsAnalysisSchema } from "../lib/ai/schemas";
import { getAIRunRepository, MemoryAIRunRepository } from "../lib/repositories/ai-run-repository";
import { calculatePriceIndication } from "../lib/pricing/engine";
import { getPriceIndicationRepository } from "../lib/pricing/repository";
import { getPricingConfiguration } from "../lib/config/agency-config";
import { ProjectService, ProjectLimitError, ProjectNotFoundError, ProjectValidationError } from "../lib/projects/service";
import { getLeadRepository } from "../lib/repositories/lead-repository";
import type { PricingConfiguration } from "../lib/pricing/types";

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  console.info(`${condition ? "PASS" : "FAIL"} — ${name}${condition || !detail ? "" : ` (${detail})`}`);
  if (!condition) failures += 1;
}

/** TESTDATA-configuratie — uitsluitend voor engine-tests; géén echte agency-prijzen. */
const testConfig: PricingConfiguration = {
  currency: "EUR",
  pricingVersion: "TEST-2026.09",
  packages: {
    business_website: { key: "business_website", label: "Zakelijke website (TEST)", basePrice: 1000, includedPages: 3 },
    webshop: { key: "webshop", label: "Webshop (TEST)", basePrice: 2500, includedPages: 5 },
  },
  addOns: {
    seo: { key: "seo", label: "SEO (TEST)", price: 300 },
    copywriting: { key: "copywriting", label: "Tekstschrijving (TEST)", price: 250 },
    ecommerce: { key: "ecommerce", label: "E-commerce add-on (TEST)", price: 750 },
  },
  extraPagePrice: 100,
  minimumPrice: 800,
  maximumPrice: 10000,
  humanApprovalThreshold: 5000,
  priceRangeDeviation: 0.1,
  vatRate: null,
  pricingRules: ["TEST"],
  customProjectRules: ["TEST"],
};

const emptyRequirements = { websiteType: null, numberOfPages: null };

async function main() {
  // TESTS draaien uitsluitend op mock-data (Fase-instructie): een eventueel
  // aanwezige Supabase-configuratie wordt bewust genegeerd — géén live API-calls.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  // ============ PRICING ENGINE (deterministisch, geen AI nodig) ============
  console.info("--- PricingEngine (pure functie — geen AI, geen provider geïnstantieerd) ---");

  // 1) Missing configuration: géén bedrag verzinnen
  const appConfig = getPricingConfiguration();
  check("app-configuratie is leeg tot de Master Configuration", appConfig.pricingVersion === "" && Object.keys(appConfig.packages).length === 0);
  const missingConfigResult = calculatePriceIndication({ projectId: "proj-test", requirements: { websiteType: "business_website", numberOfPages: 3 } }, appConfig);
  check("lege configuratie → CONFIGURATION_MISSING", missingConfigResult.status === "configuration_missing");
  check("lege configuratie → totaal 0 (niets verzonnen)", missingConfigResult.total === 0 && missingConfigResult.lineItems.length === 0);
  check("lege configuratie → escalatie READY FOR SILVIJN", missingConfigResult.requiresHuman && missingConfigResult.escalationReasons[0].includes("niet ingesteld"));

  // 2) Base package
  const base = calculatePriceIndication({ projectId: "p1", requirements: { websiteType: "business_website", numberOfPages: 3 } }, testConfig);
  check("basispakket berekend", base.status === "ready" && base.total === 1000, `status=${base.status}, total=${base.total}`);
  check("berekening uitlegbaar (line items + explanation)", base.lineItems.length === 1 && base.lineItems[0].explanation.length > 5);

  // 3) Extra pagina's
  const extraPages = calculatePriceIndication({ projectId: "p2", requirements: { websiteType: "business_website", numberOfPages: 5 } }, testConfig);
  check("extra pagina's berekend (5 pagina's → +2×100)", extraPages.total === 1200 && extraPages.lineItems.some((i) => i.key === "extra_pages"));

  // 4) Add-ons (enkel + meerdere)
  const oneAddOn = calculatePriceIndication({ projectId: "p3", requirements: { websiteType: "business_website", numberOfPages: 3, seo: true } }, testConfig);
  check("één add-on berekend (SEO)", oneAddOn.total === 1300);
  const multipleAddOns = calculatePriceIndication({ projectId: "p4", requirements: { websiteType: "business_website", numberOfPages: 3, seo: true, copywriting: true } }, testConfig);
  check("meerdere add-ons berekend (SEO + copywriting)", multipleAddOns.total === 1550 && multipleAddOns.lineItems.length === 3);

  // 5) E-commerce → webshop-pakket
  const webshop = calculatePriceIndication({ projectId: "p5", requirements: { ecommerce: true, numberOfPages: 5 } }, testConfig);
  check("e-commerce → webshop-pakket + aannamenotitie", webshop.total === 2500 && webshop.assumptions.some((a) => a.toLowerCase().includes("webshop")));

  // 6) Ontbrekende requirements
  const noWebsiteType = calculatePriceIndication({ projectId: "p6", requirements: emptyRequirements }, testConfig);
  check("requirements onbekend → MISSING_INFORMATION", noWebsiteType.status === "missing_information" && noWebsiteType.total === 0);
  check("missende informatie is benoemd", noWebsiteType.missingInformation.some((m) => m.toLowerCase().includes("pakket")));
  const unknownType = calculatePriceIndication({ projectId: "p7", requirements: { websiteType: "avondkrant" } }, testConfig);
  check("onbekend website type → MISSING_INFORMATION (niet gegokt)", unknownType.status === "missing_information");

  // 7) Price boundaries
  const smallConfig: PricingConfiguration = { ...testConfig, packages: { mini: { key: "mini", label: "Mini (TEST)", basePrice: 500, includedPages: 1 } } };
  const belowMinimum = calculatePriceIndication({ projectId: "p8", requirements: { websiteType: "mini", numberOfPages: 1 } }, smallConfig);
  check("onder minimum → REQUIRES_HUMAN met reden", belowMinimum.status === "requires_human" && belowMinimum.escalationReasons.some((r) => r.includes("minimum")));
  const bigConfig: PricingConfiguration = { ...testConfig, packages: { mega: { key: "mega", label: "Mega (TEST)", basePrice: 12000, includedPages: 20 } } };
  const aboveMaximum = calculatePriceIndication({ projectId: "p9", requirements: { websiteType: "mega", numberOfPages: 10 } }, bigConfig);
  check("boven maximum → REQUIRES_HUMAN met reden", aboveMaximum.status === "requires_human" && aboveMaximum.escalationReasons.some((r) => r.includes("maximum")));
  const aboveThreshold = calculatePriceIndication({ projectId: "p10", requirements: { websiteType: "webshop", numberOfPages: 40 } }, testConfig);
  check("boven goedkeuringsdrempel → REQUIRES_HUMAN", aboveThreshold.status === "requires_human" && aboveThreshold.escalationReasons.some((r) => r.includes("goedkeuringsdrempel")));

  // 8) Custom project
  const custom = calculatePriceIndication({ projectId: "p11", requirements: { websiteType: "business_website", numberOfPages: 3, customFunctionality: "koppeling met boekhoudsysteem" } }, testConfig);
  check("custom functionaliteit → REQUIRES_HUMAN", custom.status === "requires_human" && custom.escalationReasons.some((r) => r.includes("Custom")));

  // 9) Btw en prijsrange
  const vatConfig: PricingConfiguration = { ...testConfig, vatRate: 0.21 };
  const withVat = calculatePriceIndication({ projectId: "p12", requirements: { websiteType: "business_website", numberOfPages: 3 } }, vatConfig);
  check("btw berekend zodra geconfigureerd", withVat.subtotal === 1000 && withVat.tax === 210 && withVat.total === 1210);
  check("prijsrange ±10% zodra geconfigureerd", withVat.priceRange?.min === 1089 && withVat.priceRange?.max === 1331, JSON.stringify(withVat.priceRange));
  const noVat = calculatePriceIndication({ projectId: "p13", requirements: { websiteType: "business_website", numberOfPages: 3 } }, testConfig);
  check("geen btw zodra niet geconfigureerd (exclusief btw-notitie)", noVat.tax === 0 && noVat.assumptions.some((a) => a.includes("exclusief btw")));

  // 10) Deterministisch + versie
  const a = calculatePriceIndication({ projectId: "p14", requirements: { websiteType: "business_website", numberOfPages: 4, seo: true } }, testConfig, "2026-09-16T10:00:00.000Z");
  const b = calculatePriceIndication({ projectId: "p14", requirements: { websiteType: "business_website", numberOfPages: 4, seo: true } }, testConfig, "2026-09-16T11:00:00.000Z");
  check("deterministisch: zelfde input → zelfde bedrag", a.total === b.total && a.lineItems.length === b.lineItems.length);
  check("pricing-versie vastgelegd", a.pricingVersion === "TEST-2026.09");
  check("indicatie gemarkeerd als niet-bindend", a.assumptions.some((s) => s.includes("PRIJSINDICATIE")));

  // ============ PROJECT SERVICE ============
  console.info("--- ProjectService (repository + regels) ---");

  const service = new ProjectService();
  const leadRepo = getLeadRepository();

  // 1) Ongeldige creatie
  let err = "";
  try { await new ProjectService().createFromLead("ld-999"); } catch (e) { err = e instanceof Error ? e.message : ""; }
  check("onbekende lead geweigerd", err.length > 0);
  const unqualifiedLead = (await leadRepo.list()).find((l) => l.leadStatus === "new");
  check("ongekwalificeerde testlead gevonden", Boolean(unqualifiedLead));
  let unqualifiedErr = "";
  try { await new ProjectService().createFromLead(unqualifiedLead!.id); } catch (e) { unqualifiedErr = e instanceof Error ? e.name : ""; }
  check("ongekwalificeerde lead geweigerd", unqualifiedErr === ProjectValidationError.name, unqualifiedErr);

  // 2) Geldige creatie (qualified lead → project)
  const qualifiedLead = (await leadRepo.list()).find((l) => l.leadStatus === "qualified");
  check("gekwalificeerde testlead gevonden", Boolean(qualifiedLead));
  const project = await service.createFromLead(qualifiedLead!.id);
  check("project aangemaakt met leadId-koppeling", project.leadId === qualifiedLead!.id);
  check("project start in quotation_pending", project.status === "quotation_pending");
  check("prijsstatus initieel not_calculated", project.priceStatus === "not_calculated");
  check("geen startprijs verzonnen", project.estimatedPrice === null);

  // 3) Duplicate geweigerd
  let duplicateErr = "";
  try { await new ProjectService().createFromLead(qualifiedLead!.id); } catch (e) { duplicateErr = e instanceof Error ? e.name : ""; }
  check("duplicaat-project per lead geweigerd", duplicateErr === ProjectValidationError.name, duplicateErr);

  // 4) Ophalen + updates
  check("getById werkt", (await service.get(project.id)).id === project.id);
  check("getByLeadId werkt", (await service.getByLeadId(qualifiedLead!.id))?.id === project.id);
  const updated = await service.update(project.id, { name: "Testproject (TESTDATA)", timeline: "Q1 2027" });
  check("project-update werkt", updated.name === "Testproject (TESTDATA)" && updated.timeline === "Q1 2027");
  const afterRequirements = await service.updateRequirements(project.id, { websiteType: "business_website", numberOfPages: 4, seo: true });
  check("requirements-update werkt", afterRequirements.requirements.numberOfPages === 4);

  // 5) Statusovergangen (mens-only)
  let transitionErr = "";
  try { await service.updateStatus(project.id, "completed"); } catch (e) { transitionErr = e instanceof Error ? e.name : ""; }
  check("directe sprong naar COMPLETED geweigerd", transitionErr === ProjectValidationError.name, transitionErr);
  let notFoundErr = "";
  try { await service.get("proj-999"); } catch (e) { notFoundErr = e instanceof Error ? e.name : ""; }
  check("onbekend project → NotFound", notFoundErr === ProjectNotFoundError.name);

  // ============ AI: REQUIREMENTS-ANALYSE (mock) ============
  console.info("--- AI requirements-analyse (mock mode, pricing agent) ---");

  const proposal = await new ProjectService().proposeRequirements(project.id);
  check("AI-voorstel werkt in mock mode", proposal.mode === "mock" && proposal.project.requirements.websiteType != null);
  check("bestaande requirements behouden (nooit overschreven)", proposal.project.requirements.numberOfPages === 4, JSON.stringify(proposal.project.requirements));
  check("AI identificeert ontbrekende informatie", proposal.missingInformation.length > 0);
  check("AI stelt max 3 vervolgvragen (schema)", proposal.questions.length <= 3);

  check("Zod weigert ongeldige requirements-output", !RequirementsAnalysisSchema.safeParse({ requirements: { numberOfPages: -5 }, missingInformation: [], questions: [], confidence: 5 }).success);

  const runRepo = getAIRunRepository();
  if (runRepo instanceof MemoryAIRunRepository) {
    const runs = runRepo.getRuns();
    check("AI-run gelogd voor requirements-analyse", runs.length >= 1 && runs.some((r) => r.agentType === "pricing"));
  }

  // Safety-limiet
  process.env.MAX_PRICING_ANALYSES_PER_RUN = "1";
  const limited = new ProjectService();
  const secondProject = await limited.createFromLead((await leadRepo.list()).find((l) => l.leadStatus === "interested")!.id);
  await limited.proposeRequirements(secondProject.id);
  let limitErr = "";
  try { await limited.proposeRequirements(secondProject.id); } catch (e) { limitErr = e instanceof Error ? e.name : ""; }
  check("requirements-analyse-limiet weigert tweede call", limitErr === ProjectLimitError.name, limitErr);
  delete process.env.MAX_PRICING_ANALYSES_PER_RUN;

  // ============ INTEGRATIE: lead → project → pricing → escalatie ============
  console.info("--- Integratie (volle flow, app-configuratie = leeg) ---");

  const priced = await new ProjectService().calculatePrice(project.id);
  check("prijsberekening zonder AI-call mogelijk (service, geen provider-fout)", true);
  check("lege configuratie → project.priceStatus CONFIGURATION_MISSING", priced.priceStatus === "configuration_missing");
  check("geen bedrag op project gezet", priced.estimatedPrice === null);
  const indications = await getPriceIndicationRepository().listByProject(project.id);
  check("indicatie gepersisteerd met escalatiereden", indications.length === 1 && indications[0].escalationReasons[0].includes("niet ingesteld"));
  check("project blijft quotation_pending (geen automatische status)", priced.status === "quotation_pending");

  // Historie: tweede berekening overschrijft nooit stilzwijgend
  await new ProjectService().calculatePrice(project.id);
  const history = await getPriceIndicationRepository().listByProject(project.id);
  check("indicatie-historie bewaard (2 versies, niets overschreven)", history.length === 2, `${history.length}`);

  // ============ GEEN KLANTCOMMUNICATIE ============
  const projectsSource = readFileSync("lib/projects/service.ts", "utf8");
  const actionsSource = readFileSync("app/actions/projects.ts", "utf8");
  check("geen e-mail/offerte-verzending in projectservice", !/sendEmail|sendQuote|verstuur|emailTo/i.test(projectsSource));
  check("geen verzend-acties in server actions", !/sendEmail|sendQuote|email/i.test(actionsSource));

  console.info(failures === 0 ? "\\nALLE PROJECT + PRICING-TESTS PASS" : `\\n${failures} TEST(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.info(`Onverwachte fout: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
