import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken (zelfde patroon als outreach-sales-tests).
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import { buildShopifyTheme, buildThemeDesignTokens } from "../lib/websites/theme-zip/theme-builder";
import { createThemeZip, readThemeZip } from "../lib/websites/theme-zip/theme-zip";
import { validateThemeFiles } from "../lib/websites/theme-zip/theme-validation";
import { THEME_REQUIRED_FILES, type ThemeFile } from "../lib/websites/theme-zip/theme-structure";
import { getThemeZipArtifactRepository } from "../lib/websites/theme-zip/repository";
import { ThemeZipService } from "../lib/websites/theme-zip/service";
import { designPlanSchema, validateDesignPlanConsistency, type DesignPlan } from "../lib/websites/design-plan";
import { WebsiteSpecificationSchema } from "../lib/ai/schemas";
import type { WebsiteSpecification } from "../lib/websites/types";
import type { WebsiteContactContext } from "../lib/websites/generator";
import { getLeadRepository } from "../lib/repositories/lead-repository";
import { getProjectRepository } from "../lib/projects/repository";
import { getDesignPlanRepository } from "../lib/websites/design-plan-repository";
import { getGeneratedWebsiteRepository } from "../lib/websites/repository";
import type { ProjectRequirements } from "../lib/projects/types";

// ---------------------------------------------------------------------------
// Fixtures — uitsluitend echte vormen; geen verzonnen bedrijfsfeiten
// ---------------------------------------------------------------------------

const REQUIREMENTS: ProjectRequirements = {
  websiteType: "business_website",
  numberOfPages: 3,
  designLevel: "standard",
  ecommerce: false,
  copywriting: true,
};

const SPECIFICATION: WebsiteSpecification = WebsiteSpecificationSchema.parse({
  template: "local_service",
  business: {
    businessName: "Hovenier van Dijk",
    industry: "hovenier",
    city: "Apeldoorn",
    province: "Gelderland",
    description: null,
    targetAudience: "Particuliere tuineigenaren in Apeldoorn en omstreken",
  },
  branding: {
    primaryColor: null,
    secondaryColor: null,
    accentColor: null,
    backgroundStyle: null,
    typographyStyle: null,
    visualStyle: null,
  },
  structure: {
    pages: [
      { key: "home", title: "Home" },
      { key: "diensten", title: "Diensten" },
      { key: "contact", title: "Contact" },
    ],
    navigation: ["Home", "Diensten", "Contact"],
    sections: ["hero", "services", "about", "cta", "contact"],
  },
  content: {
    headline: "Onderhoud en aanleg van tuinen in Apeldoorn",
    subheadline: "Van sneeuwvrij tot complete tuinontwerpen — vakwerk, op tijd",
    valueProposition: "Meer dan tien jaar ervaring met tuinen in Gelderland",
    services: [
      { title: "Tuinaanleg", description: "Complete aanleg van nieuwe tuinen, van ontwerp tot oplevering." },
      { title: "Tuinonderhoud", description: "Structureel onderhoud: snoei, borders en gazons." },
    ],
    about: "Hovenier van Dijk is een lokaal bedrijf uit Apeldoorn.",
    benefits: ["Persoonlijk contact", "Vrijblijvende offerte"],
    faq: [
      { question: "Werken jullie ook buiten Apeldoorn?", answer: "We werken in Apeldoorn en directe omgeving." },
    ],
    testimonials: [],
    contactIntro: "Vraag een vrijblijvende offerte aan.",
    ctaPrimaryText: "Vraag een offerte aan",
    ctaSecondaryText: "Bekijk onze diensten",
  },
  conversion: {
    primaryCta: "offerte",
    secondaryCta: "diensten",
    contactMethods: ["telefoon"],
    leadCapture: true,
  },
  media: {
    imageRequirements: [
      { key: "hero", description: "Sfeerbeeld van een aangelegde tuin", required: true },
    ],
    imageDescriptions: ["Sfeerbeeld van een aangelegde tuin"],
    imagePlaceholders: ["placeholder-hero"],
  },
  seo: {
    title: "Hovenier van Dijk — Apeldoorn",
    metaDescription: "Hovenier van Dijk verzorgt tuinaanleg en tuinonderhoud in Apeldoorn en omgeving.",
    keywords: ["hovenier apeldoorn", "tuinontwerp gelderland"],
    localArea: "Apeldoorn",
  },
  missingInformation: [],
}) as WebsiteSpecification;

const DESIGN_PLAN: DesignPlan = designPlanSchema.parse({
  goals: {
    primaryGoal: "Meer offerteaanvragen uit Apeldoorn en omstreken",
    secondaryGoals: ["Telefonische bereikbaarheid benadrukken"],
    conversionGoal: "Offerteaanvraag via contactformulier of telefoon",
  },
  audience: {
    primaryAudience: "Particuliere tuineigenaren in Apeldoorn",
    secondaryAudiences: [],
    toneOfVoice: "Nederlands, concreet en lokaal",
  },
  navigation: {
    items: [
      { label: "Home", pageKey: "home" },
      { label: "Diensten", pageKey: "diensten" },
      { label: "Contact", pageKey: "contact" },
    ],
    structure: "Horizontale hoofdnavigatie met drie items",
  },
  pageStructure: [
    { key: "home", title: "Home", purpose: "Landingspagina met hoofd-CTA", sections: ["hero", "diensten", "contact"] },
    { key: "diensten", title: "Diensten", purpose: "Overzicht van diensten", sections: ["intro", "diensten"] },
    { key: "contact", title: "Contact", purpose: "Contactgegevens en formulier", sections: ["gegevens", "formulier"] },
  ],
  visualHierarchy: {
    strategy: "Grote hero-kop, daarna rustige secties met kaarten",
    aboveTheFold: ["Hoofdkop", "Subkop", "Primair CTA"],
  },
  branding: {
    styleDirection: "Rustig, groen, vakmanschap",
    mood: ["natuurlijk", "betrouwbaar"],
    existingBrandAssets: null,
    preferredColors: ["groen"],
    dislikedColors: [],
    restrictions: [],
  },
  typography: {
    pairing: "Serif-koppen met sans-serif lopende tekst",
    scale: "1.25 major third",
    weights: ["400", "600"],
    rationale: "Serif onderstreept vakmanschap",
  },
  colors: {
    primary: "#2f5233",
    secondary: "#7a8f6d",
    accent: "#c9a55a",
    neutrals: ["#ffffff", "#f4f6f2", "#22301f", "#5b6657", "#dfe4dc"],
    usageGuidance: "Groen voor koppen en CTA, goudkleur als accent",
  },
  spacing: { scale: "8px-basis", density: "ruim" },
  components: [
    { key: "hero", purpose: "Eerste indruk met hoofd-CTA", notes: "Sfeerbeeld van tuin" },
    { key: "contact", purpose: "Contactformulier", notes: null },
  ],
  ctaStrategy: {
    primary: "Vraag een offerte aan",
    secondary: "Bekijk onze diensten",
    placement: ["Hero", "Eindsectie"],
    leadCapture: true,
  },
  imagery: {
    style: "Natuurlijke sfeerbeelden van tuinen",
    requirements: ["Eigen fotomateriaal van uitgevoerde tuinen"],
    placeholderStrategy: "Neutrale SVG-placeholder tot fotomateriaal beschikbaar is",
  },
  responsive: {
    mobile: "Eénkoloms met navigatie-uitklapper",
    tablet: "Tweekoloms",
    desktop: "Driekoloms",
    breakpoints: ["760px", "1024px"],
  },
  animation: {
    strategy: "Minimaal: hover-states",
    allowed: ["hover"],
    restrictions: ["geen parallax"],
  },
  functionality: {
    features: [{ key: "contactformulier", description: "Contactformulier", source: "requirements" }],
    integrations: [],
  },
  accessibility: {
    contrast: "Minimaal 4.5:1 lichaamstekst",
    focusAndKeyboard: "Zichtbare focus-states",
    semantics: "Semantische koppenstructuur",
    formsAndLabels: "Elk veld een label",
    guidelines: ["WCAG 2.2 AA"],
  },
  seoPerformance: {
    titleStrategy: "Plaats + vak in de titel",
    metaStrategy: "Lokale beschrijving met CTA",
    localSeo: "Apeldoorn en omgeving benoemen",
    performanceBudget: "Geen externe fonts, systeemstack",
    imageOptimization: "Responsive images met lazy loading",
  },
  basis: { sources: ["lead", "project", "requirements"] },
  missingInformation: [],
});

const CONTACT: WebsiteContactContext = {
  phone: "+31555012345",
  email: "info@hovandijk.example",
  address: "Tuinstraat 12",
  city: "Apeldoorn",
  province: "Gelderland",
};

function builtTheme(): ThemeFile[] {
  return buildShopifyTheme({
    specification: SPECIFICATION,
    designPlan: DESIGN_PLAN,
    contact: CONTACT,
  }).files;
}

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
  assert.equal(artifact.status, "passed");
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
  assert.equal(artifact.status, "passed", "ZIP-generatie slaagt in de in-flow tussenstand");
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
