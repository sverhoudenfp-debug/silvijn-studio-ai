import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken (zelfde patroon als outreach-sales-tests).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import { buildThemeDesignTokens } from "../lib/websites/theme-zip/theme-builder";
import { createThemeZip, readThemeZip } from "../lib/websites/theme-zip/theme-zip";
import { validateThemeFiles } from "../lib/websites/theme-zip/theme-validation";
import { BLUEPRINT_SECTION_REGISTRY, BLUEPRINT_SECTION_TYPES } from "../lib/websites/blueprint/section-registry";
import { THEME_REQUIRED_FILES, type ThemeFile } from "../lib/websites/theme-zip/theme-structure";
import { getThemeZipArtifactRepository } from "../lib/websites/theme-zip/repository";
import { ThemeZipService } from "../lib/websites/theme-zip/service";
import { validateDesignPlanConsistency, type DesignPlan } from "../lib/websites/design-plan";
import { getLeadRepository } from "../lib/repositories/lead-repository";
import { getProjectRepository } from "../lib/projects/repository";
import { getDesignPlanRepository } from "../lib/websites/design-plan-repository";
import { getGeneratedWebsiteRepository } from "../lib/websites/repository";

// ---------------------------------------------------------------------------
// Fixtures — uitsluitend echte vormen; geen verzonnen bedrijfsfeiten
// ---------------------------------------------------------------------------

import {
  CONTACT,
  DESIGN_PLAN,
  REQUIREMENTS,
  SPECIFICATION,
  builtTheme,
} from "./fixtures/theme";

// ---------------------------------------------------------------------------
// Deterministische bouw + ZIP-creatie
// ---------------------------------------------------------------------------

test("theme-zip: de gebouwde thema's bevatten alle vereiste Shopify-bestanden", () => {
  const files = builtTheme();
  const paths = new Set(files.map((f) => f.path));
  for (const required of THEME_REQUIRED_FILES) {
    assert.ok(paths.has(required), `ontbreekt: ${required}`);
  }
  assert.ok(paths.has("sections/header-group.json"));
  assert.ok(paths.has("sections/footer-group.json"));
  assert.ok(paths.has("templates/page.contact.json"));
});

test("theme-zip: paginatemplates volgen het Design Plan (home excluded, contact explicit)", () => {
  const files = builtTheme();
  const paths = files.map((f) => f.path);
  assert.ok(paths.includes("templates/page.diensten.json"));
  assert.ok(!paths.includes("templates/page.home.json"), "homepage hoort in templates/index.json");
});

test("theme-zip: design-tokens komen uit het Design Plan (kleuren + serif-pairing)", () => {
  const tokens = buildThemeDesignTokens(DESIGN_PLAN);
  assert.equal(tokens.primary, "#2f5233");
  assert.equal(tokens.accent, "#c9a55a");
  assert.ok(tokens.headingFont.startsWith("Georgia"), "serif-pairing uit het plan");
  assert.equal(tokens.sectionSpacing, "spacious");
});

test("theme-zip: contactgegevens in de footer zijn de échte context (geen fabricatie)", () => {
  const files = builtTheme();
  const footerGroup = JSON.parse(
    files.find((f) => f.path === "sections/footer-group.json")!.content
  );
  const settings = footerGroup.sections.footer.settings;
  assert.equal(settings.phone, CONTACT.phone);
  assert.equal(settings.email, CONTACT.email);
  assert.equal(settings.address, CONTACT.address);
});

// ---------------------------------------------------------------------------
// Completeness-pass (Fase I.2): password, klantaccounts, gift card, share-image
// ---------------------------------------------------------------------------

test("theme-zip: password-layout + -template zijn gebrand en compleet", () => {
  const files = builtTheme();
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const layout = byPath.get("layout/password.liquid")!;
  const template = byPath.get("templates/password.liquid")!;
  assert.ok(layout.includes("content_for_header"), "password-layout mist content_for_header");
  assert.ok(layout.includes("content_for_layout"), "password-layout mist content_for_layout");
  assert.ok(!layout.includes("sections 'header-group'"), "password-layout hoort geen header-group te tonen");
  assert.ok(template.includes("storefront_password"), "password-template mist het formulier");
  assert.ok(template.includes("shop.password_message"), "password-template leest de merchant-boodschap");
  assert.ok(template.includes("{{ settings.brand_name"), "password-template toont de branding via settings");
});

test("theme-zip: klantaccount-templates zijn functioneel en alleen systeemniveau", () => {
  const files = builtTheme();
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const expected = [
    "templates/customers/login.liquid",
    "templates/customers/register.liquid",
    "templates/customers/account.liquid",
    "templates/customers/order.liquid",
    "templates/customers/addresses.liquid",
    "templates/customers/activate_account.liquid",
    "templates/customers/reset_password.liquid",
  ];
  for (const path of expected) {
    assert.ok(byPath.has(path), `ontbreekt: ${path}`);
    assert.ok(byPath.get(path)!.length > 100, `${path} is verdacht leeg`);
  }
  assert.ok(byPath.get("templates/customers/login.liquid")!.includes("customer_login"));
  assert.ok(byPath.get("templates/customers/login.liquid")!.includes("guest_login"));
  assert.ok(byPath.get("templates/customers/register.liquid")!.includes("create_customer"));
  assert.ok(byPath.get("templates/customers/account.liquid")!.includes("customer.orders"));
  assert.ok(byPath.get("templates/customers/addresses.liquid")!.includes("customer_address"));
  // Geen klantaccountpagina's in de navigatie: geen webshop-UI op niet-webshop sites.
  const headerGroup = byPath.get("sections/header-group.json")!;
  assert.ok(!headerGroup.includes("/account"), "navigatie mag niet naar accountpagina's verwijzen");
  const index = byPath.get("templates/index.json")!;
  assert.ok(!index.includes("customers/"), "homepage bevat geen accountblokken");
});

test("theme-zip: gift_card is een standalone printpagina met echte objectdata", () => {
  const files = builtTheme();
  const giftCard = files.find((f) => f.path === "templates/gift_card.liquid")!;
  assert.ok(giftCard.content.includes("{% layout none %}"));
  assert.ok(giftCard.content.includes("{{ gift_card.code"));
  assert.ok(giftCard.content.includes("{{ gift_card.initial_value"));
  assert.ok(giftCard.content.includes("{{ gift_card.balance"));
});

test("theme-zip: share_image/og:image en JSON-LD zijn settings-gedreven", () => {
  const files = builtTheme();
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const schema = JSON.parse(byPath.get("config/settings_schema.json")!);
  const settingIds = new Set<string>();
  for (const group of schema) {
    for (const setting of group.settings ?? []) settingIds.add(setting.id);
  }
  for (const id of ["brand_name", "contact_email", "contact_phone", "contact_city", "seo_description", "share_image"]) {
    assert.ok(settingIds.has(id), `setting ontbreekt: ${id}`);
  }
  const metaTags = byPath.get("snippets/meta-tags.liquid")!;
  assert.ok(metaTags.includes("settings.share_image"));
  assert.ok(metaTags.includes("og:image"));
  assert.ok(metaTags.includes("application/ld+json"));
  // JSON-LD leest uitsluitend settings/shop-object (geen hardcoded bedrijfsdata).
  assert.ok(metaTags.includes("settings.brand_name | json"));
  assert.ok(metaTags.includes("shop.url | json"));
  // Geverifieerde defaults in settings_data; lege waarden blijven leeg.
  const data = JSON.parse(byPath.get("config/settings_data.json")!).current;
  assert.equal(data.brand_name, SPECIFICATION.business.businessName);
  assert.equal(data.contact_email, CONTACT.email);
  assert.equal(data.contact_phone, CONTACT.phone);
  assert.equal(data.contact_city, CONTACT.city);
  assert.equal(data.seo_description, SPECIFICATION.seo.metaDescription);
});

test("theme-zip: layouts gebruiken geldige Shopify Liquid comments (regressie: nooit {comment})", () => {
  const files = builtTheme();
  // Geen enkel gegenereerd bestand mag een ongeldige accolade-tag {tag}/{/tag} bevatten:
  // Shopify renders die letterlijk als zichtbare tekst vóór de doctype.
  const invalidTag = /\{(?!%|\{)[a-z_]+\}|\{\/[a-z_]+\}/;
  for (const f of files) {
    if (f.path.endsWith(".liquid")) {
      const m = f.content.match(invalidTag);
      assert.ok(!m, `${f.path} bevat ongeldige accolade-tag ${m?.[0]} die Shopify letterlijk rendert`);
    }
  }
  // Beide layouts bevatten een expliciet geldig Liquid-commentpaar.
  for (const p of ["layout/theme.liquid", "layout/password.liquid"]) {
    const layout = files.find((f) => f.path === p)!;
    assert.ok(layout.content.includes("{% comment %}"), `${p} mist {% comment %}`);
    assert.ok(layout.content.includes("{% endcomment %}"), `${p} mist {% endcomment %}`);
    assert.ok(!layout.content.includes("{comment}"), `${p} bevat nog {comment}`);
    assert.ok(!layout.content.includes("{/comment}"), `${p} bevat nog {/comment}`);
  }
  // Het comment staat ná de doctype noch vóór: alleen comment-inhoud, nooit output.
  const theme = files.find((f) => f.path === "layout/theme.liquid")!;
  assert.ok(theme.content.trimStart().startsWith("{% comment %}"), "theme.liquid begint met het Liquid-comment");
});

test("theme-zip: title en meta-description hebben betrouwbare fallbackketen", () => {
  const layout = builtTheme().find((f) => f.path === "layout/theme.liquid")!;
  assert.ok(layout.content.includes("{{ page_title | default: shop.name }}"), "title-fallback via page_title");
  assert.ok(layout.content.includes("page_description | default: settings.seo_description"), "meta-description-fallback");
});

test("theme-zip: validator vangt incompleteness (password/gift card/settings)", () => {
  // 1. Password-layout weg → vereist-bestand + referentiefout
  const missingPassword = builtTheme().filter((f) => f.path !== "layout/password.liquid");
  let result = validateThemeFiles(missingPassword);
  assert.ok(result.errors.some((e) => e.includes("layout/password.liquid")));

  // 2. Gift card zonder standalone layout → fout
  const badGiftCard = builtTheme().map((f) =>
    f.path === "templates/gift_card.liquid"
      ? { ...f, content: f.content.replace("{% layout none %}", "") }
      : f
  );
  result = validateThemeFiles(badGiftCard);
  assert.ok(result.errors.some((e) => e.includes("gift_card") && e.includes("layout none")));

  // 3. Schema zonder share_image-setting → setting-referentiefout
  const badSchema = builtTheme().map((f) => {
    if (f.path !== "config/settings_schema.json") return f;
    const schema = JSON.parse(f.content);
    for (const group of schema) {
      group.settings = (group.settings ?? []).filter((setting: { id: string }) => setting.id !== "share_image");
    }
    return { ...f, content: JSON.stringify(schema, null, 2) + "\n" };
  });
  result = validateThemeFiles(badSchema);
  assert.ok(result.errors.some((e) => e.includes("share_image")));

  // 4. Lege klantaccountpagina → fout
  const emptyCustomer = builtTheme().map((f) =>
    f.path === "templates/customers/register.liquid" ? { ...f, content: "<p>x</p>" } : f
  );
  result = validateThemeFiles(emptyCustomer);
  assert.ok(
    result.errors.some((e) => e.includes("templates/customers/register.liquid")),
    "lege accountpagina moet worden afgewezen"
  );
});

test("theme-zip: ZIP-creatie is deterministisch (byte-identiek) en leesbaar terug", async () => {
  const zip1 = await createThemeZip(builtTheme());
  const zip2 = await createThemeZip(builtTheme());
  assert.deepEqual(Buffer.from(zip1), Buffer.from(zip2));
  const readBack = await readThemeZip(zip1);
  assert.equal(readBack.length, builtTheme().length);
  const layout = readBack.find((f) => f.path === "layout/theme.liquid");
  assert.ok(layout?.content.includes("content_for_layout"));
});

test("theme-zip: dubbele bestandspaden worden geweigerd", async () => {
  const files = builtTheme();
  files.push({ ...files.find((f) => f.path === "layout/theme.liquid")! });
  await assert.rejects(() => createThemeZip(files), /Dubbel themabestand/);
});

// ---------------------------------------------------------------------------
// Validatie: geldig thema
// ---------------------------------------------------------------------------

test("theme-zip: de volledig gegenereerde themaset valideert zonder fouten", () => {
  const result = validateThemeFiles(builtTheme());
  assert.deepEqual(result.errors, []);
  assert.equal(result.passed, true);
});

// ---------------------------------------------------------------------------
// Shopify-import-mirror (2026-09-20): ZIP-uploads valideren JSON-templates
// strikt tegen de sectie-schema's en laten templatebestanden met onbekende
// setting- of blok-ids STIL vallen — de homepage wordt dan 404. De validator
// moet dit vóór oplevering fail-loud afvangen.
// ---------------------------------------------------------------------------

test("theme-zip: import-mirror vangt een onbekende setting in een template", () => {
  const files = builtTheme().map((f) => {
    if (f.path !== "templates/index.json") return f;
    const data = JSON.parse(f.content);
    const first = data.order[0];
    data.sections[first].settings.heading_onbekend = "x";
    return { ...f, content: JSON.stringify(data, null, 2) + "\n" };
  });
  const result = validateThemeFiles(files);
  assert.equal(result.passed, false);
  assert.ok(
    result.errors.some((e) => e.includes("heading_onbekend") && e.includes("ZIP-import")),
    `verwacht import-mirror-fout voor heading_onbekend, kreeg: ${JSON.stringify(result.errors)}`
  );
});

test("theme-zip: import-mirror vangt een onbekend bloktype en blok-setting", () => {
  const files = builtTheme().map((f) => {
    if (f.path !== "templates/index.json") return f;
    const data = JSON.parse(f.content);
    const key = Object.keys(data.sections).find((k: string) => data.sections[k].blocks);
    assert.ok(key, "verwacht een sectie met blocks");
    const blocks = data.sections[key].blocks as Record<string, { type: string; settings: Record<string, unknown> }>;
    const blockKey = Object.keys(blocks)[0];
    const blokType = blocks[blockKey].type;
    blocks[`${blockKey}_onbekend`] = { type: `${blokType}_bestaat_niet`, settings: { label: "x" } };
    (data.sections[key].block_order as string[]).push(`${blockKey}_onbekend`);
    // plus een geldig bloktype met een onbekende setting
    const geldigKey = Object.keys(blocks)[0];
    blocks[geldigKey].settings.setting_onbekend = "y";
    return { ...f, content: JSON.stringify(data, null, 2) + "\n" };
  });
  const result = validateThemeFiles(files);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes("_bestaat_niet") && e.includes("bloktype")));
  assert.ok(result.errors.some((e) => e.includes("setting_onbekend") && e.includes("blok")));
});

test("theme-zip: import-mirror vereist name in section groups (Shopify-spec)", () => {
  const zonderName = builtTheme().map((f) => {
    if (f.path !== "sections/header-group.json") return f;
    const data = JSON.parse(f.content);
    delete data.name;
    return { ...f, content: JSON.stringify(data, null, 2) + "\n" };
  });
  const result = validateThemeFiles(zonderName);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes("header-group.json") && e.includes("name")));

  // Gegenereerde groups hebben beide de verplichte name.
  const headerGroup = JSON.parse(builtTheme().find((f) => f.path === "sections/header-group.json")!.content);
  const footerGroup = JSON.parse(builtTheme().find((f) => f.path === "sections/footer-group.json")!.content);
  assert.ok(typeof headerGroup.name === "string" && headerGroup.name.length > 0, "header-group name aanwezig");
  assert.ok(typeof footerGroup.name === "string" && footerGroup.name.length > 0, "footer-group name aanwezig");
});

// ---------------------------------------------------------------------------
// Validatie: ongeldige thema's
// ---------------------------------------------------------------------------

test("theme-zip: ontbrekend vereist bestand wordt afgewezen", () => {
  const files = builtTheme().filter((f) => f.path !== "config/settings_schema.json");
  const result = validateThemeFiles(files);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes("config/settings_schema.json")));
});

test("theme-zip: ongeldige JSON wordt afgewezen", () => {
  const files = builtTheme().map((f) =>
    f.path === "config/settings_data.json" ? { ...f, content: "{ oeps" } : f
  );
  const result = validateThemeFiles(files);
  assert.ok(result.errors.some((e) => e.includes("Ongeldige JSON")));
});

test("theme-zip: niet-gebalanceerde Liquid-tags worden afgewezen", () => {
  const files = builtTheme().map((f) => {
    if (f.path !== "sections/hero.liquid") return f;
    return { ...f, content: f.content.replace("{% schema %}", "{% if section.settings.heading %}") };
  });
  const result = validateThemeFiles(files);
  assert.ok(result.errors.some((e) => e.includes("Niet-gebalanceerde Liquid-tags")));
});

test("theme-zip: onbekende render-snippet wordt afgewezen", () => {
  const files = builtTheme().map((f) =>
    f.path === "sections/cta.liquid"
      ? { ...f, content: f.content.replace("{% schema %}", "{% render 'bestaat-niet' %}{% schema %}") }
      : f
  );
  const result = validateThemeFiles(files);
  assert.ok(result.errors.some((e) => e.includes("bestaat-niet")));
});

test("theme-zip: ontbrekende asset-referentie wordt afgewezen", () => {
  const files = builtTheme().map((f) =>
    f.path === "layout/theme.liquid"
      ? { ...f, content: f.content.replace("'theme.css' | asset_url", "'bestaat-niet.css' | asset_url") }
      : f
  );
  const result = validateThemeFiles(files);
  assert.ok(result.errors.some((e) => e.includes("bestaat-niet.css")));
});

test("theme-zip: template met onbekend sectietype wordt afgewezen", () => {
  const files = builtTheme().map((f) => {
    if (f.path !== "templates/page.json") return f;
    const data = JSON.parse(f.content);
    data.sections.main.type = "bestaat-niet";
    return { ...f, content: JSON.stringify(data) };
  });
  const result = validateThemeFiles(files);
  assert.ok(result.errors.some((e) => e.includes('sectietype "bestaat-niet"')));
});

test("theme-zip: secrets in bestandsinhoud worden afgewezen", () => {
  const files = [...builtTheme()];
  files.push({ path: "assets/dont.js", content: "const apiKey = 'sk-abcdefghijklmnopqrstuvwxyz0123';\n" });
  const result = validateThemeFiles(files);
  assert.ok(result.errors.some((e) => e.includes("API-key") || e.includes("geheim")));
});

test("theme-zip: hardcoded credential-assignments worden afgewezen", () => {
  const files = [...builtTheme()];
  files.push({ path: "assets/secret.js", content: "const config = { password: \"supergeheim123\" };\n" });
  const result = validateThemeFiles(files);
  assert.ok(result.errors.some((e) => e.includes("credential")));
});

test("theme-zip: dev-paden (.env, node_modules, git, lock) worden afgewezen", () => {
  const dirty = [
    ".env",
    ".env.local",
    "node_modules/pkg/index.js",
    ".git/config",
    "package.json",
    "package-lock.json",
    "yarn.lock",
    "docs/README.md",
    "src/leak.ts",
  ];
  const files = [...builtTheme()];
  for (const path of dirty) files.push({ path, content: "// x\n" });
  const result = validateThemeFiles(files);
  for (const path of dirty) {
    assert.ok(
      result.errors.some((e) => e.includes(path)),
      `pad ${path} moest worden afgewezen`
    );
  }
});

test("theme-zip: padtraversal en absolute paden worden afgewezen", () => {
  const files = [...builtTheme()];
  files.push({ path: "../evil.liquid", content: "x\n" });
  files.push({ path: "/absoluut.liquid", content: "x\n" });
  files.push({ path: "assets\\backslash.liquid", content: "x\n" });
  const result = validateThemeFiles(files);
  assert.ok(result.errors.some((e) => e.includes("traversal") || e.includes("Onveilig pad")));
  assert.ok(result.errors.some((e) => e.includes("Absoluut pad")));
});

test("theme-zip: verzonnen feiten (fabricatie-patronen) worden afgewezen", () => {
  const files = [...builtTheme()];
  files.push({ path: "sections/fake-reviews.liquid", content: "{% schema %}{ \"name\": \"Reviews\" }{% endschema %}\n<div>4,9 van 5 op basis van 247 reviews. 100% garanties. Geweldig!</div>\n" });
  const result = validateThemeFiles(files);
  assert.ok(result.errors.some((e) => e.includes("Fabricatie-patroon")));
});

test("theme-zip: {% include %} (deprecated) wordt afgewezen", () => {
  const files = builtTheme().map((f) =>
    f.path === "sections/rich-text.liquid"
      ? { ...f, content: f.content.replace("{% schema %}", "{% include 'meta-tags' %}{% schema %}") }
      : f
  );
  const result = validateThemeFiles(files);
  assert.ok(result.errors.some((e) => e.includes("include")));
});

// ---------------------------------------------------------------------------
// Service: versiebeheer + productie-poort
// ---------------------------------------------------------------------------

async function seedWebsite(): Promise<string> {
  const leadRepo = getLeadRepository();
  const lead = await leadRepo.create({
    businessName: "Hovenier van Dijk",
    industry: "hovenier",
    city: "Apeldoorn",
    province: "Gelderland",
    country: "NL",
    address: "Tuinstraat 12",
    phone: "+31555012345",
    email: "info@hovandijk.example",
    websiteStatus: "no_website",
    source: "manual",
  });
  const project = await getProjectRepository().create({
    leadId: lead.id,
    name: "Website Hovenier van Dijk",
    projectType: "business_website",
    description: "Nieuwe bedrijfswebsite",
    requirements: REQUIREMENTS,
    currency: "EUR",
    timeline: null,
    notes: "",
  });
  await getDesignPlanRepository().create({
    projectId: project.id,
    leadId: lead.id,
    version: 1,
    status: "completed",
    mode: "mock",
  });
  const records = await getDesignPlanRepository().listByProject(project.id);
  await getDesignPlanRepository().update(records[0].id, {
    plan: DESIGN_PLAN,
    status: "completed",
  });
  const website = await getGeneratedWebsiteRepository().create({
    projectId: project.id,
    leadId: lead.id,
    slug: `hovenier-van-dijk-v1`,
    businessName: lead.businessName,
    websiteType: "local_service",
    framework: "shopify",
    template: "local_service",
    specification: SPECIFICATION,
    previewUrl: `/generated-websites/hovenier-van-dijk-v1`,
    version: 1,
  });
  await getGeneratedWebsiteRepository().update(website.id, {
    generationStatus: "completed",
    status: "ready_for_qc",
    buildStatus: "passed",
  });
  return website.id;
}

test("theme-zip: service met geldige poort genereert een gevalideerd artefact v1 (mock-mode, geen storage)", async () => {
  const websiteId = await seedWebsite();
  const service = new ThemeZipService({ productionGate: async () => undefined });
  const artifact = await service.generateForWebsite(websiteId);
  assert.equal(artifact.status, "certified");
  assert.equal(artifact.version, 1);
  assert.equal(artifact.fileCount, builtTheme().length, "alle themabestanden zitten in het ZIP");
  assert.deepEqual(artifact.validationErrors, []);
  assert.equal(artifact.storageBucket, null, "mock-mode: geen opslag-upload");
  assert.match(artifact.checksumSha256, /^[0-9a-f]{64}$/);
});

test("theme-zip: hergeneratie maakt v2 en bewaart v1 (versiebeheer, niets verwijderd)", async () => {
  const websiteId = await seedWebsite();
  const service = new ThemeZipService({ productionGate: async () => undefined });
  const v1 = await service.generateForWebsite(websiteId);
  const v2 = await service.generateForWebsite(websiteId);
  assert.equal(v2.version, 2);
  assert.notEqual(v1.id, v2.id);
  const all = await service.listArtifacts(websiteId);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((a) => a.version).sort((a, b) => b - a), [2, 1]);
  assert.equal(v1.checksumSha256, v2.checksumSha256, "deterministisch: zelfde input, zelfde checksum");
});

test("theme-zip: geblokkeerde productie-poort weigert generatie zonder artefact", async () => {
  const websiteId = await seedWebsite();
  const before = (await getThemeZipArtifactRepository().listByWebsite(websiteId)).length;
  const service = new ThemeZipService({
    productionGate: async () => {
      throw new Error("PRODUCTION_BLOCKED: goedgekeurde scope/prijs, betaalplan, bevestigde betaling en complete requirements zijn verplicht.");
    },
  });
  await assert.rejects(() => service.generateForWebsite(websiteId), /PRODUCTION_BLOCKED/);
  const after = (await getThemeZipArtifactRepository().listByWebsite(websiteId)).length;
  assert.equal(after, before, "geen artefact bij geblokkeerde poort");
});

test("theme-zip: poort geldt vóór alle werk (guard-failure verbruikt geen budget)", async () => {
  let gateCalls = 0;
  const service = new ThemeZipService({
    productionGate: async () => {
      gateCalls += 1;
      throw new Error("PRODUCTION_BLOCKED");
    },
  });
  // onbekende website: guards falen vóór de poort
  await assert.rejects(() => service.generateForWebsite("site-999"), /niet gevonden/);
  assert.equal(gateCalls, 0);
});

test("theme-zip: nextjs-website en onafgeronde generatie worden geweigerd", async () => {
  const websiteId = await seedWebsite();
  const repo = getGeneratedWebsiteRepository();
  const website = await repo.getById(websiteId);
  assert.ok(website);
  await repo.update(websiteId, { generationStatus: "planning" });
  const service = new ThemeZipService({ productionGate: async () => undefined });
  await assert.rejects(() => service.generateForWebsite(websiteId), /niet geldig afgerond/);
  await repo.update(websiteId, { generationStatus: "completed" });
});

// Live-les Fase I.2 smoke-test (derde live-run): de productieflow roept de
// ZIP-stap aan TERWIJL de website nog "building" is. De flow rondt de
// content-generatie af vóór de ZIP (generationStatus completed, status
// building) — deze test borgt exact die tussenstand.
test("theme-zip: in-flow tussenstand (generationStatus completed + status building) is geldig", async () => {
  const leadRepo = getLeadRepository();
  const lead = await leadRepo.create({
    businessName: "Bakkerij De Gouden Korst",
    industry: "bakkerij",
    city: "Zwolle",
    province: "Overijssel",
    country: "NL",
    phone: "+31551234567",
    websiteStatus: "no_website",
    source: "manual",
  });
  const project = await getProjectRepository().create({
    leadId: lead.id,
    name: "Website Bakkerij De Gouden Korst",
    projectType: "business_website",
    description: "Nieuwe website",
    requirements: REQUIREMENTS,
    currency: "EUR",
    timeline: null,
    notes: "",
  });
  await getDesignPlanRepository().create({
    projectId: project.id,
    leadId: lead.id,
    version: 1,
    status: "completed",
    mode: "mock",
  });
  const records = await getDesignPlanRepository().listByProject(project.id);
  await getDesignPlanRepository().update(records[0].id, {
    plan: DESIGN_PLAN,
    status: "completed",
  });
  const website = await getGeneratedWebsiteRepository().create({
    projectId: project.id,
    leadId: lead.id,
    slug: "bakkerij-de-gouden-korst-v3",
    businessName: lead.businessName,
    websiteType: "local_service",
    framework: "shopify",
    template: "local_service",
    specification: SPECIFICATION,
    previewUrl: "/generated-websites/bakkerij-de-gouden-korst-v3",
    version: 3,
  });
  // Exacte tussenstand uit de productieflow: build geslaagd, ZIP wordt nu pas gemaakt.
  await getGeneratedWebsiteRepository().update(website.id, {
    generationStatus: "completed",
    status: "building",
    buildStatus: "building",
  });
  const service = new ThemeZipService({ productionGate: async () => undefined });
  const artifact = await service.generateForWebsite(website.id);
  assert.equal(artifact.status, "certified", "ZIP-generatie slaagt in de in-flow tussenstand");
  assert.equal(artifact.version, 1);
});

test("theme-zip: ontbrekend Design Plan blokkeert generatie met duidelijke melding", async () => {
  const leadRepo = getLeadRepository();
  const lead = await leadRepo.create({
    businessName: "Kapper Jansen",
    industry: "kapper",
    city: "Zutphen",
    province: "Gelderland",
    country: "NL",
    phone: "+31551234567",
    websiteStatus: "no_website",
    source: "manual",
  });
  const project = await getProjectRepository().create({
    leadId: lead.id,
    name: "Website Kapper Jansen",
    projectType: "business_website",
    description: "Nieuwe website",
    requirements: REQUIREMENTS,
    currency: "EUR",
    timeline: null,
    notes: "",
  });
  const website = await getGeneratedWebsiteRepository().create({
    projectId: project.id,
    leadId: lead.id,
    slug: "kapper-jansen-v1",
    businessName: lead.businessName,
    websiteType: "professional_service",
    framework: "shopify",
    template: "professional_service",
    specification: SPECIFICATION,
    previewUrl: "/generated-websites/kapper-jansen-v1",
    version: 1,
  });
  await getGeneratedWebsiteRepository().update(website.id, {
    generationStatus: "completed",
    status: "ready_for_qc",
    buildStatus: "passed",
  });
  const service = new ThemeZipService({ productionGate: async () => undefined });
  await assert.rejects(() => service.generateForWebsite(website.id), /Design Plan/);
});

test("theme-zip: design-plan-consistentie met requirements geldt ook voor het ZIP", () => {
  const inconsistentPlan: DesignPlan = {
    ...DESIGN_PLAN,
    pageStructure: [DESIGN_PLAN.pageStructure[0]],
  };
  const result = validateDesignPlanConsistency(inconsistentPlan, REQUIREMENTS);
  assert.equal(result.passed, false, "scope-wijziging (paginantal) moet blokkeren");
});

/** ===== Regressie: Shopify-template-ID's (2026-09-20, live import-bewijs) =====
 * Shopify laat templatebestanden met hyfen in section-/blok-ID's bij ZIP-import
 * STIL vallen (index.json + page.diensten.json verdwenen uit "Edit code").
 * Docs: ID's "accept only alphanumeric characters"; underscores zijn bewezen
 * veilig (Dawn: image_banner; de theme-editor genereert zelf underscores).
 * Het section-TYPE blijft kebab (bestandsnaam), alleen de ID's niet.
 */
function templateJsonOf(files: ThemeFile[], path: string): { sections: Record<string, Record<string, unknown>>; order: string[] } {
  const file = files.find((f) => f.path === path);
  assert.ok(file, `${path} ontbreekt`);
  return JSON.parse(file.content) as { sections: Record<string, Record<string, unknown>>; order: string[] };
}

test("theme-zip: alle template-/group-ID's zijn alfanumeriek (geen hyfens)", () => {
  const files = builtTheme();
  const idRe = /^[a-zA-Z0-9_]+$/;
  for (const file of files) {
    const isGroup = file.path.startsWith("sections/") && file.path.endsWith("-group.json");
    if (!isGroup && !file.path.startsWith("templates/")) continue;
    if (!file.path.endsWith(".json")) continue;
    const data = JSON.parse(file.content) as {
      sections?: Record<string, { blocks?: Record<string, unknown> }>;
    };
    for (const [sectionId, section] of Object.entries(data.sections ?? {})) {
      assert.ok(idRe.test(sectionId), `section-ID "${sectionId}" in ${file.path} bevat niet-alfanumerieke tekens`);
      for (const blockId of Object.keys(section.blocks ?? {})) {
        assert.ok(idRe.test(blockId), `blok-ID "${blockId}" in ${file.path} bevat niet-alfanumerieke tekens`);
      }
    }
  }
  // Legacy-homepage: service-blokken nu met underscore.
  const index = templateJsonOf(files, "templates/index.json");
  assert.ok(index.sections.services, "services op de homepage");
  const blockIds = Object.keys((index.sections.services as { blocks?: Record<string, unknown> }).blocks ?? {});
  assert.ok(blockIds.length > 0, "services heeft blokken");
  for (const blockId of blockIds) {
    assert.ok(idRe.test(blockId), `legacy blok-ID "${blockId}" bevat een hyfen`);
  }
});

test("theme-zip: validatie vangt hyfen in template-section-ID's hard af (de les van 2026-09-20)", () => {
  const theme = builtTheme();
  const index = templateJsonOf(theme, "templates/index.json");
  const sections: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(index.sections)) {
    sections[key === "cta" ? "usp-band" : key] = value;
  }
  const tampered: ThemeFile[] = theme.map((f) =>
    f.path === "templates/index.json"
      ? {
          ...f,
          content: JSON.stringify({
            sections,
            order: index.order.map((k) => (k === "cta" ? "usp-band" : k)),
          }),
        }
      : f
  );
  const result = validateThemeFiles(tampered);
  assert.equal(result.passed, false, "hyfen-section-ID's moeten de validatie laten falen");
  assert.ok(
    result.errors.some((e) => e.includes('section-ID "usp-band"')),
    "foutmelding benoemt de hyfen-section-ID"
  );
});

test("theme-zip: validatie vangt hyfen-blok-ID's hard af", () => {
  const theme = builtTheme();
  const index = templateJsonOf(theme, "templates/index.json");
  const services = index.sections.services as {
    blocks: Record<string, unknown>;
    block_order: string[];
  };
  const blocks: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(services.blocks)) {
    blocks[key.replace("_", "-")] = value;
  }
  const tampered: ThemeFile[] = theme.map((f) =>
    f.path === "templates/index.json"
      ? {
          ...f,
          content: JSON.stringify({
            sections: {
              ...index.sections,
              services: {
                ...services,
                blocks,
                block_order: services.block_order.map((k) => k.replace("_", "-")),
              },
            },
            order: index.order,
          }),
        }
      : f
  );
  const result = validateThemeFiles(tampered);
  assert.equal(result.passed, false, "hyfen-blok-ID's moeten de validatie laten falen");
  assert.ok(
    result.errors.some((e) => e.includes('blok-ID "service-1"')),
    "foutmelding benoemt de hyfen-blok-ID"
  );
});

/** ===== Regressie: schema-optielabels (2026-09-21, live import-bewijs) =====
 * Shopify's ZIP-import/theme-editor keurt select-/radio-opties met een label
 * langer dan 50 tekens af (bewezen FileSaveError op hero.liquid: "Invalid
 * schema: setting with id="layout" option label is too long (max 50
 * characters)") en valt dan het HELE sectiebestand + alle templates die
 * ernaar verwijzen stilletjes af. Dit was de werkelijke oorzaak dat
 * index.json/page.diensten.json sinds v1 stilletjes verdwenen (hero 4x,
 * services 1x overtreding; alle 19 overige secties bleven intact in kit-1).
 * Setting-labels van 54 tekens zijn bewezen veilig (about.liquid importeerde
 * in kit-1); de limiet geldt dus specifiek voor optielabels.
 */
test("theme-zip: alle registry-layoutdescriptions passen in Shopify's optielabel-limiet van 50 tekens", () => {
  for (const type of BLUEPRINT_SECTION_TYPES) {
    const def = BLUEPRINT_SECTION_REGISTRY[type];
    for (const layout of def.layouts) {
      assert.ok(
        layout.description.length <= 50,
        `layout "${type}/${layout.key}" heeft een description van ${layout.description.length} tekens; Shopify staat max 50 optielabeltekens toe (${layout.description})`
      );
    }
  }
});

test("theme-zip: gegenereerde sectieschema's hebben geen optielabels langer dan 50 tekens", () => {
  const files = builtTheme();
  const schemaRe = /\{%\s*-?\s*schema\s*-?\s*%\}([\s\S]*?)\{%\s*-?\s*endschema\s*-?\s*%\}/;
  for (const file of files) {
    if (!file.path.startsWith("sections/") || !file.path.endsWith(".liquid")) continue;
    const match = file.content.match(schemaRe);
    if (!match) continue;
    const schema = JSON.parse(match[1]) as {
      settings?: { type?: string; id?: string; options?: { label?: string }[] }[];
      blocks?: { type?: string; settings?: { type?: string; id?: string; options?: { label?: string }[] }[] }[];
    };
    const check = (settings: { type?: string; id?: string; options?: { label?: string }[] }[] | undefined, context: string) => {
      for (const setting of settings ?? []) {
        if (setting.type !== "select" && setting.type !== "radio") continue;
        for (const option of setting.options ?? []) {
          assert.ok(
            (option.label ?? "").length <= 50,
            `${file.path}: optielabel van setting "${setting.id}"${context} is ${(option.label ?? "").length} tekens (max 50): "${option.label}"`
          );
        }
      }
    };
    check(schema.settings, "");
    for (const block of schema.blocks ?? []) {
      check(block.settings, ` (blok "${block.type}")`);
    }
  }
});

test("theme-zip: validatie vangt te lange optielabels hard af (de les van 2026-09-21)", () => {
  const thema = builtTheme();
  const teLang = "x".repeat(51);
  const exactGrens = "y".repeat(50);

  // 51 tekens -> falen, met de setting-id in de foutmelding.
  const teLangTheme: ThemeFile[] = thema.map((f) =>
    f.path === "sections/hero.liquid"
      ? { ...f, content: f.content.replace('"label": "Geen"', `"label": "${teLang}"`) }
      : f
  );
  assert.ok(
    teLongTampered(teLangTheme),
    "sanity: de tamper raakt een label in hero.liquid"
  );
  const resultLang = validateThemeFiles(teLangTheme);
  assert.equal(resultLang.passed, false, "een optielabel van 51 tekens moet de validatie laten falen");
  assert.ok(
    resultLang.errors.some((e) => e.includes("too long") && e.includes('"motion"') && e.includes("sections/hero.liquid")),
    "foutmelding benoemt het bestand, de setting-id en de limiet"
  );

  // exact 50 tekens -> toegestaan (grens is max 50, niet < 50).
  const grensTheme: ThemeFile[] = thema.map((f) =>
    f.path === "sections/hero.liquid"
      ? { ...f, content: f.content.replace('"label": "Geen"', `"label": "${exactGrens}"`) }
      : f
  );
  const resultGrens = validateThemeFiles(grensTheme);
  assert.ok(
    resultGrens.passed,
    `een optielabel van exact 50 tekens is geldig (Shopify: max 50); gevonden fouten: ${resultGrens.errors.join("; ")}`
  );
});

test("theme-zip: validatie dekt ook optielabels in blok-settings", () => {
  const thema = builtTheme();
  const injectie =
    '{ "type": "select", "id": "stijl", "label": "Stijl", "options": [{ "value": "a", "label": "' +
    "z".repeat(51) +
    '" }] }, { "type": "image_picker", "id": "image", "label": "Afbeelding (optioneel)" }';
  const tampered: ThemeFile[] = thema.map((f) =>
    f.path === "sections/services.liquid"
      ? {
          ...f,
          content: f.content.replace(
            '{ "type": "image_picker", "id": "image", "label": "Afbeelding (optioneel)" }',
            injectie
          ),
        }
      : f
  );
  assert.ok(
    tampered.some((f) => f.path === "sections/services.liquid" && f.content.includes('"stijl"')),
    "sanity: de bloktamper is aangebracht"
  );
  const result = validateThemeFiles(tampered);
  assert.equal(result.passed, false, "een te lang optielabel in blok-settings moet falen");
  assert.ok(
    result.errors.some((e) => e.includes("too long") && e.includes('blok "service"')),
    "foutmelding benoemt het blok"
  );
});

function teLongTampered(theme: ThemeFile[]): boolean {
  return theme.some((f) => f.path === "sections/hero.liquid" && f.content.includes("x".repeat(51)));
}

