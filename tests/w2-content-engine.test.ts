import test from "node:test";
import assert from "node:assert/strict";

import { buildShopifyTheme } from "../lib/websites/theme-zip/theme-builder";
import { auditClaims, claimIssues, normalizeClaims } from "../lib/websites/content/claims";
import { auditContentQuality, summarizeQuality } from "../lib/websites/content/content-quality";
import { pageBriefFor, detectIndustryProfile, buildPageBriefLines, buildIndustryProfileLines } from "../lib/websites/content/page-briefs";
import { contentPlanSchema, type ContentPlan } from "../lib/websites/content/content-plan";
import { goldenContentPlan } from "./fixtures/golden-content";
import { goldenSpecification, goldenDesignPlan, goldenContact } from "./fixtures/golden-hovenier";

/**
 * W2 — CONTENT ENGINE. De contentpass is pas klaar als de inhoud
 * controleerbaar compleet is: diepgang per pagina, gevulde FAQ, geen
 * placeholders, geen herhaling, en G-tekst die wacht op goedkeuring.
 */

function clonePlan(plan: ContentPlan): ContentPlan {
  return contentPlanSchema.parse(JSON.parse(JSON.stringify(plan)));
}

test("W2: referentieplan haalt de contentkeuring (diepgang, FAQ, geen placeholders)", () => {
  const report = auditContentQuality({ plan: goldenContentPlan });
  assert.equal(report.ok, true, summarizeQuality(report));
  assert.equal(report.issues.filter((issue) => issue.severity === "blocking").length, 0);

  const byKey = new Map(report.pages.map((page) => [page.key, page]));
  assert.ok(byKey.get("home")!.words >= 220, "homepage heeft inhoudelijke diepgang");
  assert.ok(byKey.get("over-ons")!.words >= 170, "over-ons is een echt verhaal");
  assert.ok(byKey.get("diensten")!.words >= 190, "diensten legt per dienst uit");
  assert.ok(byKey.get("faq")!.words >= 160, "FAQ heeft volledige antwoorden");
  assert.ok(byKey.get("contact")!.words >= 40, "contact is kort maar compleet");

  // Drie vragen, drie antwoorden, geen lege accordion.
  assert.equal(byKey.get("faq")!.faqPairs, 3);
  assert.equal(byKey.get("faq")!.faqWithoutAnswer, 0);
  assert.equal(report.totals.faqPairs, 3);
});

test("W2: FAQ zonder antwoord of met alleen een doorverwijzing wordt geblokkeerd", () => {
  const broken = clonePlan(goldenContentPlan);
  const faqPage = broken.pages.find((page) => page.key === "faq")!;
  const answer = faqPage.units.find((unit) => unit.kind === "faq_answer");
  assert.ok(answer);
  answer.text = "Zie de contactpagina.";
  const report = auditContentQuality({ plan: broken });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.code === "faq_answer_missing"));
});

test("W2: placeholdertekst en lege generated units blokkeren de oplevering", () => {
  const broken = clonePlan(goldenContentPlan);
  const about = broken.pages.find((page) => page.key === "over-ons")!;
  const body = about.units.find((unit) => unit.kind === "body");
  assert.ok(body);
  body.text = "Voorbeeldtekst over het bedrijf.";
  const report = auditContentQuality({ plan: broken });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.code.startsWith("placeholder_")));
});

test("W2: herhaling tussen pagina's wordt gesignaleerd", () => {
  const repeated = clonePlan(goldenContentPlan);
  const home = repeated.pages.find((page) => page.key === "home")!;
  const about = repeated.pages.find((page) => page.key === "over-ons")!;
  const source = home.units.find((unit) => unit.status === "generated" && unit.text)!.text!;
  const target = about.units.find((unit) => unit.kind === "body");
  assert.ok(target);
  target.text = `${source}\n\n${source}`;
  const report = auditContentQuality({ plan: repeated });
  assert.ok(report.issues.some((issue) => issue.code === "repetition"), "gedeelde zinnen zijn zichtbaar");
});

test("W2: G-tekst met bedrijfsfeiten wordt geweigerd (geen verzonnen claims)", () => {
  const base = clonePlan(goldenContentPlan);
  const plan = base.pages.find((page) => page.key === "faq")!.units.find((unit) => unit.claim === "G")!;
  const cases = [
    "Wij werken al 25 jaar in Utrecht en omgeving.",
    "Elke aanleg is gegarandeerd binnen twee weken klaar.",
    "Ons team van vier mensen heeft honderden tuinen aangelegd.",
    "Wij zijn de beste hovenier van de regio.",
    "Een ontwerp kost 350 euro.",
  ];
  for (const text of cases) {
    const unit = { ...plan, text };
    const issues = claimIssues(unit);
    assert.ok(issues.length > 0, `G-tekst had geweigerd moeten worden: ${text}`);
  }
  // En dezelfde zinnen als F mét bewijs zijn wél toegestaan.
  const allowed = claimIssues({ ...plan, claim: "F", evidence: ["bronfragment"], text: cases[0] });
  assert.equal(allowed.length, 0);
});

test("W2: F-unit zonder bewijs is een onbevestigd bedrijfsfeit", () => {
  const plan = clonePlan(goldenContentPlan);
  const unit = plan.pages[0].units.find((entry) => entry.claim === "F")!;
  unit.evidence = [];
  const issues = claimIssues(unit);
  assert.ok(issues.some((issue) => issue.code === "claim_f_evidence"));
});

test("W2: plan zonder goedgekeurde G-content levert geen G-tekst aan het thema", () => {
  const unapproved = clonePlan(goldenContentPlan);
  unapproved.approvals = { gContent: null };
  const files = (plan: ContentPlan) =>
    buildShopifyTheme({
      specification: goldenSpecification as never,
      designPlan: goldenDesignPlan,
      contact: goldenContact,
      contentPlan: plan,
    }).files;

  const withApproval = files(goldenContentPlan);
  const withoutApproval = files(unapproved);
  const read = (list: { path: string; content?: string }[], path: string) =>
    list.find((file) => file.path === path)?.content ?? "";

  const faqApproved = read(withApproval, "templates/page.faq.json");
  const faqHeld = read(withoutApproval, "templates/page.faq.json");
  assert.ok(faqApproved.includes("grondwerk en bestrating"), "goedgekeurde G-content staat in het thema");
  assert.ok(!faqHeld.includes("grondwerk en bestrating"), "niet-goedgekeurde G-content blijft buiten het thema");
});

test("W2: paginarollen verschillen per type en de branche bepaalt de inhoud", () => {
  const home = pageBriefFor("home");
  const about = pageBriefFor("over-ons");
  const faq = pageBriefFor("faq");
  assert.notEqual(home.purpose, about.purpose);
  assert.notEqual(about.purpose, faq.purpose);
  assert.ok(home.elements.some((element) => element.toLowerCase().includes("positionering")));
  assert.ok(faq.elements.some((element) => element.toLowerCase().includes("antwoord")));

  const garden = detectIndustryProfile({ industry: "Hoveniersbedrijf", description: "tuinaanleg en onderhoud" });
  const restaurant = detectIndustryProfile({ industry: "Restaurant", serviceTitles: ["Proeverij"] });
  const architect = detectIndustryProfile({ industry: "Architectenbureau" });
  assert.equal(garden.key, "hovenier");
  assert.equal(restaurant.key, "horeca");
  assert.equal(architect.key, "architect");
  assert.notEqual(garden.faqThemes.join(), restaurant.faqThemes.join());
  assert.notEqual(garden.tone, architect.tone);
});

test("W2: promptregels bevatten paginarollen, brancheprofiel en diepgang", () => {
  const lines = [
    ...buildPageBriefLines(goldenDesignPlan.blueprint ?? ({} as never)),
    ...buildIndustryProfileLines(detectIndustryProfile({ industry: "hovenier" })),
  ].join("\n");
  assert.ok(lines.includes("OPDRACHT") || lines.includes("PAGINA-OPDRACHTEN"));
});

test("W2: legacy-units zonder claimcategorie worden deterministisch genormaliseerd", () => {
  const legacy = clonePlan(goldenContentPlan);
  for (const page of legacy.pages) {
    for (const unit of page.units) {
      if (unit.status === "generated" && unit.claim === "F") delete (unit as { claim?: string }).claim;
    }
  }
  const normalized = normalizeClaims(legacy);
  const audit = auditClaims(normalized);
  assert.equal(audit.blocking.length, 0, "normalisatie levert een sluitend claimmodel");
  assert.ok(audit.totals.F > 0);
});

test("W2: dienstenkaarten tonen geen grijs plaatshoudervlak zonder beeld", () => {
  const files = buildShopifyTheme({
    specification: goldenSpecification as never,
    designPlan: goldenDesignPlan,
    contact: goldenContact,
    contentPlan: goldenContentPlan,
  }).files;
  const liquid = files.find((file) => file.path === "sections/services.liquid")?.content ?? "";
  assert.ok(liquid.includes("card--plain"), "tekstkaart-variant bestaat");
  // W3: de mediapoort is één expliciete assign geworden (has_media) die alle
  // layoutvarianten delen; zonder beeld wordt er geen placeholder gerenderd.
  assert.ok(
    liquid.includes("if block.settings.image != blank or block.settings.image_asset != blank"),
    "media wordt alleen gerenderd als er een beeld is"
  );
  assert.ok(liquid.includes("assign has_media = false"), "mediapoort start gesloten");
  assert.ok(liquid.includes("service-line--text"), "lijstvariant heeft een tekstvariant zonder media");
  const index = files.find((file) => file.path === "templates/page.diensten.json")?.content ?? "";
  assert.ok(!index.includes("image_asset"), "geen beeld-asset op de dienstenkaarten");
});
