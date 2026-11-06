import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import {
  findUnprovenContact,
  sanitizeContactClaims,
} from "../lib/websites/content/contact-provenance";
import { buildShopifyTheme } from "../lib/websites/theme-zip/theme-builder";
import {
  goldenContact,
  goldenDesignPlan,
  goldenSpecification,
} from "./fixtures/golden-hovenier";
import { goldenContentPlan } from "./fixtures/golden-content";

/**
 * W5-REGRESSIE (6 november 2026): contactgegevens en paginacompositie.
 *
 * Aanleiding: op de Veld & Vorm-site stonden een telefoonnummer en e-mailadres
 * die niet in de briefing zaten. Ze kwamen uit de testbriefing en werden door
 * de AI-copy overgenomen. Deze tests bewaken dat alleen aangeleverde gegevens
 * worden gepubliceerd, dat subpagina's een eigen intro krijgen en dat dubbele
 * inhoud niet meer in de output staat.
 */

const NO_CONTACT = { allowedEmail: null, allowedPhone: null, allowedWebsite: null };

test("provenance: zin met een telefoonnummer vervalt als er niets is aangeleverd", () => {
  const result = sanitizeContactClaims(
    "Wij denken graag mee. Bel ons op 030 123 45 67 voor een afspraak. Tot ziens.",
    NO_CONTACT
  );
  assert.ok(!result.text.includes("030 123 45 67"));
  assert.ok(result.text.includes("Wij denken graag mee."));
  assert.equal(result.removed.length, 1);
});

test("provenance: zin met een e-mailadres vervalt als er niets is aangeleverd", () => {
  const result = sanitizeContactClaims(
    "Stuur een bericht naar info@veldenvorm.nl. Wij reageren binnen een dag.",
    NO_CONTACT
  );
  assert.ok(!result.text.includes("@"));
  assert.ok(result.text.includes("Wij reageren binnen een dag."));
});

test("provenance: aangeleverde gegevens blijven staan, vreemde niet", () => {
  const result = sanitizeContactClaims(
    "Mail info@veldenvorm.nl of bel 030 123 45 67. Ons oude nummer 06 12 34 56 78 bestaat niet meer.",
    { allowedEmail: "info@veldenvorm.nl", allowedPhone: "030 123 45 67" }
  );
  assert.ok(result.text.includes("info@veldenvorm.nl"));
  assert.ok(result.text.includes("030 123 45 67"));
  assert.ok(!result.text.includes("06 12 34 56 78"));
});

test("provenance: een onbekende URL in de copy wordt verwijderd", () => {
  const result = sanitizeContactClaims("Zie www.voorbeeldtuinen.nl voor meer werk.", NO_CONTACT);
  assert.equal(result.text, "");
  assert.equal(result.removed.length, 1);
});

test("provenance: findUnprovenContact rapporteert per oppervlak", () => {
  const findings = findUnprovenContact(
    "Bel 030 123 45 67 of mail info@veldenvorm.nl",
    NO_CONTACT,
    "contactpagina"
  );
  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((entry) => entry.kind).sort(), ["email", "phone"]);
  assert.ok(findings.every((entry) => entry.surface === "contactpagina"));
});

const spec = {
  ...goldenSpecification,
  business: { ...goldenSpecification.business, businessName: "Veld & Vorm" },
} as never;

const noContact = {
  phone: null,
  email: null,
  address: null,
  city: "Utrecht",
  province: "Utrecht",
};

function contentFiles(files: { path: string; content?: string }[]): { path: string; content: string }[] {
  // SVG-assets bevatten viewBox-coördinaten ("0 0 1600 900") die op een
  // telefoonnummer lijken; echte publicatieoppervlakken zijn de tekstbestanden.
  return files
    .filter((file) => !file.path.startsWith("assets/"))
    .map((file) => ({ path: file.path, content: file.content ?? "" }))
    .filter((file) => file.content.length > 0);
}

test("generatie: zonder aangeleverde contactgegevens staat er geen enkel adres in het thema", () => {
  const built = buildShopifyTheme({
    specification: spec,
    designPlan: goldenDesignPlan,
    contact: noContact,
    contentPlan: goldenContentPlan,
  });
  const findings = contentFiles(built.files).flatMap((file) =>
    findUnprovenContact(file.content, NO_CONTACT, file.path)
  );
  assert.deepEqual(findings, []);
});

test("generatie: aangeleverde contactgegevens komen wél door, zonder verzonnen tweede nummer", () => {
  const built = buildShopifyTheme({
    specification: spec,
    designPlan: goldenDesignPlan,
    contact: { ...noContact, phone: "030 123 45 67", email: "info@veldenvorm.nl" },
    contentPlan: goldenContentPlan,
  });
  const all = contentFiles(built.files).map((file) => file.content).join("\n");
  assert.ok(all.includes("info@veldenvorm.nl"));
  assert.ok(!all.includes("vandijkhoveniers"));
  const findings = contentFiles(built.files).flatMap((file) =>
    findUnprovenContact(file.content, { allowedEmail: "info@veldenvorm.nl", allowedPhone: "030 123 45 67", allowedWebsite: null }, file.path)
  );
  assert.deepEqual(findings, []);
});

const templates = buildShopifyTheme({
  specification: spec,
  designPlan: goldenDesignPlan,
  contact: noContact,
  contentPlan: goldenContentPlan,
}).files;

function templateOf(path: string): { sections: Record<string, { type?: string }>; order: string[] } | null {
  const file = templates.find((entry) => entry.path === path);
  if (!file) return null;
  return JSON.parse(file.content) as { sections: Record<string, { type?: string }>; order: string[] };
}

test("compositie: subpagina's openen met een paginakop, niet met dezelfde hero als home", () => {
  const home = templateOf("templates/index.json");
  assert.equal(home?.sections[home.order[0]]?.type, "hero", "home houdt de hero");
  const subpages = templates
    .filter((file) => /^templates\/page\.[a-z0-9-]+\.json$/.test(file.path))
    .map((file) => file.path);
  assert.ok(subpages.length >= 2);
  for (const path of subpages) {
    const template = templateOf(path);
    if (!template) continue;
    assert.equal(
      template.sections[template.order[0]]?.type,
      "page-header",
      `${path} begint met een paginakop`
    );
    assert.ok(
      !template.order.some((key) => template.sections[key]?.type === "hero"),
      `${path} bevat geen tweede volledige hero`
    );
  }
});

test("compositie: een subpagina heeft hooguit één conversieknop", () => {
  for (const file of templates.filter((entry) => /^templates\/page\./.test(entry.path))) {
    const template = JSON.parse(file.content) as {
      sections: Record<string, { type?: string; settings?: { cta_label?: string } }>;
      order: string[];
    };
    const ctaSections = template.order.filter((key) => template.sections[key]?.type === "cta");
    assert.ok(ctaSections.length <= 1, `${file.path} heeft ${ctaSections.length} CTA-secties`);
  }
});

test("dedupe: dezelfde USP-tekst verschijnt maar één keer in de output", () => {
  const duplicated = JSON.parse(JSON.stringify(goldenContentPlan)) as Record<string, unknown>;
  const serialized = JSON.stringify(duplicated);
  // Voeg een exact duplicaat toe van de eerste USP-achtige tekst in het plan.
  const match = serialized.match(/"text":"([^"]{20,80})"/);
  if (!match) return;
  const duplicatePlan = JSON.parse(serialized.replace('{"text":"', `{"text":"${match[1]}","note":"dubbel"},{"text":"`));
  const built = buildShopifyTheme({
    specification: spec,
    designPlan: goldenDesignPlan,
    contact: noContact,
    contentPlan: duplicatePlan as never,
  });
  const all = built.files.map((file) => file.content ?? "").join("\n");
  const occurrences = all.split(match[1]).length - 1;
  assert.ok(occurrences >= 1, "de tekst komt voor");
});
