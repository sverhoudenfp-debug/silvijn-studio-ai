import { test } from "node:test";
import assert from "node:assert/strict";

// Memory-mode: nooit productie raken.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

import {
  findIdentityLeaks,
  identityConflictsWithRetired,
  missingIdentityFields,
  normalizePhone,
} from "../lib/websites/identity-isolation";
import { runDeterministicPreflight } from "../lib/websites/theme-zip/preflight";
import { buildShopifyTheme } from "../lib/websites/theme-zip/theme-builder";
import {
  goldenContact,
  goldenDesignPlan,
  goldenSpecification,
} from "./fixtures/golden-hovenier";
import { goldenContentPlan } from "./fixtures/golden-content";

/**
 * W4-REGRESSIE (2026-11-05): identiteitsisolatie.
 *
 * Aanleiding: op de Veld & Vorm-contactpagina stond `info@vandijkhoveniers.nl`
 * van de eerdere testonderneming Van Dijk Hoveniers. Deze tests bewaken dat
 * gegevens van het ene bedrijf nooit in de website van het andere belanden, en
 * dat ontbrekende gegevens ontbrekend blijven.
 */

const RECENT_IDENTITY = {
  businessName: "Veld & Vorm",
  email: "info@veldenvorm.nl",
  phone: "030 123 45 67",
  website: null,
  city: "Utrecht",
};

test("isolatie: e-mailadres van een gepensioneerd bedrijf wordt gesignaleerd", () => {
  const leaks = findIdentityLeaks(
    `<a href="mailto:info@vandijkhoveniers.nl">Mail ons</a>`,
    RECENT_IDENTITY,
    "sections/contact.liquid"
  );
  // Het adres én het bijbehorende domein worden gemeld: twee invalshoeken,
  // dezelfde vreemde identiteit.
  assert.ok(leaks.some((leak) => leak.kind === "email" && leak.value === "info@vandijkhoveniers.nl"));
  assert.ok(leaks.some((leak) => leak.kind === "domain"));
});

test("isolatie: bedrijfsnaam en domein van een gepensioneerd bedrijf worden gesignaleerd", () => {
  const leaks = findIdentityLeaks(
    "Van Dijk Hoveniers verzorgt het onderhoud. Zie www.vandijkhoveniers.nl.",
    RECENT_IDENTITY,
    "templates/page.contact.json"
  );
  const kinds = leaks.map((leak) => leak.kind);
  assert.ok(kinds.includes("business_name"));
  assert.ok(kinds.includes("domain"));
});

test("isolatie: vreemd telefoonnummer faalt, eigen nummer niet", () => {
  const foreign = findIdentityLeaks("Bel 06 12 34 56 78 voor een afspraak.", RECENT_IDENTITY, "x.liquid");
  assert.ok(foreign.map((leak) => leak.kind).includes("phone"));
  const own = findIdentityLeaks("Bel 030 123 45 67 voor een afspraak.", RECENT_IDENTITY, "x.liquid");
  assert.equal(own.length, 0);
});

test("isolatie: eigen domein met ander postbusdeel is geen lek", () => {
  const leaks = findIdentityLeaks("info@veldenvorm.nl en sales@veldenvorm.nl", RECENT_IDENTITY, "x.liquid");
  assert.equal(leaks.length, 0);
});

test("isolatie: publieke provider is geen bedrijfsidentiteit", () => {
  const leaks = findIdentityLeaks("iemand@gmail.com", RECENT_IDENTITY, "x.liquid");
  assert.equal(leaks.length, 0);
});

test("isolatie: telefoonnormalisatie gebruikt de laatste 9 cijfers", () => {
  assert.equal(normalizePhone("+31 30 123 45 67"), normalizePhone("030-1234567"));
});

test("isolatie: ontbrekende velden worden expliciet gemeld", () => {
  assert.deepEqual(
    missingIdentityFields({ businessName: "Veld & Vorm", email: null, phone: null, website: null, city: null }),
    ["email", "phone", "city"]
  );
});

// Let op: de gouden fixture is zélf de gepensioneerde testcase (Van Dijk
// Hoveniers). Voor een positieve preflight gebruiken we daarom dezelfde
// structuur met een neutrale, actuele identiteit.
const veldSpecification = {
  ...goldenSpecification,
  business: { ...goldenSpecification.business, businessName: "Veld & Vorm" },
};
const identityFiles = buildShopifyTheme({
  specification: veldSpecification as never,
  designPlan: goldenDesignPlan,
  contact: { ...goldenContact, email: "info@veldenvorm.nl" },
}).files;

const ownIdentity = {
  businessName: "Veld & Vorm",
  email: "info@veldenvorm.nl",
  phone: goldenContact.phone,
  website: null,
  city: goldenContact.city,
};

test("preflight: thema met uitsluitend de eigen identiteit is in orde", () => {
  const result = runDeterministicPreflight(identityFiles, { identity: ownIdentity });
  const check = result.checks.find((entry) => entry.id === "identity_isolation");
  assert.equal(check?.result, "pass");
});

test("preflight: content van een andere case wordt als identiteitslek geblokkeerd", () => {
  // Dit is exact het oorspronkelijke incident: de content/contactcontext van
  // Van Dijk Hoveniers belandde in de Veld & Vorm-website.
  const built = buildShopifyTheme({
    specification: veldSpecification as never,
    designPlan: goldenDesignPlan,
    contact: { ...goldenContact, email: "info@veldenvorm.nl" },
    contentPlan: goldenContentPlan,
  }).files;
  const result = runDeterministicPreflight(built, { identity: ownIdentity });
  const check = result.checks.find((entry) => entry.id === "identity_isolation");
  assert.equal(check?.result, "fail");
  assert.ok(check?.errors.join(" ").includes("Van Dijk Hoveniers"));
});

test("preflight: vreemd e-mailadres in een template is een harde fail", () => {
  const leaked = identityFiles.map((file) =>
    file.path === "templates/page.contact.json"
      ? { ...file, content: file.content.replace("info@veldenvorm.nl", "info@vandijkhoveniers.nl") }
      : file
  );
  const result = runDeterministicPreflight(leaked, { identity: ownIdentity });
  const check = result.checks.find((entry) => entry.id === "identity_isolation");
  assert.equal(check?.result, "fail");
  assert.equal(result.passed, false);
  assert.ok(check?.errors.join(" ").includes("info@vandijkhoveniers.nl"));
});

test("preflight: een project dat zelf een gepensioneerde identiteit draagt faalt", () => {
  const result = runDeterministicPreflight(identityFiles, {
    identity: { ...ownIdentity, businessName: "Van Dijk Hoveniers" },
  });
  const check = result.checks.find((entry) => entry.id === "identity_isolation");
  assert.equal(check?.result, "fail");
});

test("isolatie: gepensioneerde identiteit wordt als eigen identiteit geblokkeerd", () => {
  const conflicts = identityConflictsWithRetired({
    businessName: "Van Dijk Hoveniers",
    email: "info@vandijkhoveniers.nl",
    phone: null,
    website: null,
    city: null,
  });
  assert.ok(conflicts.length >= 2);
});

test("generatie: zonder telefoon en e-mail wordt niets verzonnen of overgenomen", () => {
  const built = buildShopifyTheme({
    specification: goldenSpecification,
    designPlan: goldenDesignPlan,
    contact: { phone: null, email: null, address: null, city: goldenContact.city, province: goldenContact.province },
    contentPlan: goldenContentPlan,
  });
  const all = built.files.map((file) => file.content ?? file.bytes?.toString() ?? "").join("\n");
  assert.ok(!all.includes("vandijkhoveniers"));
  assert.ok(!/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(all));
});

test("generatie: Veld & Vorm bevat uitsluitend de eigen contactgegevens", () => {
  const built = buildShopifyTheme({
    specification: {
      ...goldenSpecification,
      business: { ...goldenSpecification.business, businessName: "Veld & Vorm" },
    },
    designPlan: goldenDesignPlan,
    contact: { phone: "030 123 45 67", email: "info@veldenvorm.nl", address: null, city: "Utrecht", province: "Utrecht" },
    contentPlan: goldenContentPlan,
  });
  const all = built.files.map((file) => file.content ?? file.bytes?.toString() ?? "").join("\n");
  assert.ok(all.includes("info@veldenvorm.nl"));
  assert.ok(!all.includes("vandijkhoveniers"));
});
