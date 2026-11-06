import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import { findInternalCopy, isInternalCopy, pickVisitorCopy } from "../lib/websites/content/internal-copy";
import { buildShopifyTheme } from "../lib/websites/theme-zip/theme-builder";
import { goldenDesignPlan, goldenSpecification } from "./fixtures/golden-hovenier";
import { goldenContentPlan } from "./fixtures/golden-content";
import { sanitizeContactClaims } from "../lib/websites/content/contact-provenance";

/**
 * W6-REGRESSIE (6 november 2026): interne planningsinstructies.
 *
 * Aanleiding: "Verhaal en werkwijze van Veld & Vorm tonen", "Het volledige
 * dienstenaanbod toelichten" en "Contactgegevens en aanvraagformulier tonen"
 * stonden als paginaintro op de site. Dat zijn doelen van een pagina, geen
 * bezoekerscopy.
 */

test("interne copy: planningswerkwoord aan het eind wordt herkend", () => {
  assert.ok(isInternalCopy("Verhaal en werkwijze van Veld & Vorm tonen"));
  assert.ok(isInternalCopy("Het volledige dienstenaanbod toelichten"));
  assert.ok(isInternalCopy("Contactgegevens en aanvraagformulier tonen"));
});

test("interne copy: praten over de bezoeker wordt herkend", () => {
  assert.ok(isInternalCopy("De bezoeker moet hier direct kunnen aanvragen"));
});

test("interne copy: jargon en placeholders worden herkend", () => {
  assert.ok(isInternalCopy("Hero met CTA-blok boven de vouw"));
  assert.ok(isInternalCopy("Lorem ipsum dolor sit amet"));
  assert.ok(isInternalCopy("Nader te bepalen"));
});

test("interne copy: gewone bezoekerscopy blijft toegestaan", () => {
  const copy = [
    "Tuinen met karakter, ontworpen voor het dagelijks leven.",
    "Wij ontwerpen, leggen aan en onderhouden tuinen in Utrecht en omgeving.",
    "Vertel ons over uw tuin en wij denken mee.",
    "Zo werken wij: van kennismaking tot oplevering.",
  ];
  for (const line of copy) {
    assert.deepEqual(findInternalCopy(line), [], `onterecht geblokkeerd: ${line}`);
  }
});

test("interne copy: pickVisitorCopy slaat interne kandidaten over", () => {
  assert.equal(pickVisitorCopy([null, "Diensten toelichten", "Onze diensten"]), "Onze diensten");
  assert.equal(pickVisitorCopy(["Diensten toelichten", "  "]), null);
});

test("generatie: de drie gemelde interne teksten staan niet in de output", () => {
  const built = buildShopifyTheme({
    specification: goldenSpecification,
    designPlan: goldenDesignPlan,
    contact: { phone: null, email: null, address: null, city: "Utrecht", province: "Utrecht" },
  });
  const all = built.files.map((file) => file.content ?? "").join("\n").toLowerCase();
  for (const phrase of [
    "verhaal en werkwijze",
    "volledige dienstenaanbod toelichten",
    "contactgegevens en aanvraagformulier tonen",
    "doel van deze pagina",
  ]) {
    assert.ok(!all.includes(phrase), `interne tekst in output: ${phrase}`);
  }
});

test("layout: de designsysteemlaag gebruikt inhoudsafhankelijke hoogtes en één koptrap", () => {
  const built = buildShopifyTheme({
    specification: goldenSpecification,
    designPlan: goldenDesignPlan,
    contact: { phone: null, email: null, address: null, city: "Utrecht", province: "Utrecht" },
  });
  const css = built.files.find((file) => file.path === "assets/design-system.css")?.content ?? "";
  assert.ok(css.includes("height: auto; max-height: none"), "griditems krijgen auto-hoogte");
  assert.ok(css.includes("overflow-wrap: break-word"), "lange woorden breken niet onbedoeld");
  assert.ok(css.includes("hyphens: none"), "geen onbedoelde woordafbreking");
  assert.ok(css.includes("text-wrap: balance"), "koppen houden gebalanceerde regels");
  assert.ok(css.includes(".section__header h2"), "sectiekoppen hebben één vaste trap");
});

test("intro: pagina-intro's zijn nooit dezelfde algemene contactzin", () => {
  const built = buildShopifyTheme({
    specification: goldenSpecification,
    designPlan: goldenDesignPlan,
    contact: { phone: null, email: null, address: null, city: "Utrecht", province: "Utrecht" },
    contentPlan: goldenContentPlan,
  });
  const intros: string[] = [];
  for (const file of built.files) {
    if (!file.path.startsWith("templates/page")) continue;
    const data = JSON.parse(file.content) as { sections?: Record<string, { settings?: Record<string, unknown> }>; order?: string[] };
    for (const key of data.order ?? []) {
      const intro = data.sections?.[key]?.settings?.subheading;
      if (typeof intro === "string" && intro.trim()) intros.push(intro.trim());
    }
  }
  assert.equal(new Set(intros).size, intros.length, "elke paginaintro is uniek");
  const generic = /neem contact op met .* via telefoon of e-?mail/i;
  assert.ok(!intros.some((intro) => generic.test(intro)), "geen algemene contactzin als intro");
});

test("contactkanaal: noemen van telefoon of e-mail zonder aangeleverd kanaal vervalt", () => {
  const policy = { allowedEmail: null, allowedPhone: null, allowedWebsite: null };
  const result = sanitizeContactClaims(
    "Neem contact op met Veld & Vorm via telefoon of e-mail. Wij denken graag mee.",
    policy
  );
  assert.ok(!/telefoon|e-?mail/i.test(result.text), "kanaalzin verwijderd");
  assert.ok(result.text.includes("Wij denken graag mee."), "overige copy blijft staan");
});
