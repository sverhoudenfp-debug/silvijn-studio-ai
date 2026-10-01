import { test } from "node:test";
import assert from "node:assert/strict";
import { primaryAction } from "../lib/leads/primary-action";
import type { Lead } from "../lib/types";

/**
 * Regressietests — leadtabel "belangrijkste actie" (2026-10-01).
 * De kolom is deterministisch: zelfde leadgegevens geven altijd dezelfde
 * actie, en menselijke poorten ("Handmatig contact") hebben altijd prioriteit
 * boven alles wat het systeem zelf kan.
 */

function lead(overrides: Partial<Lead>): Lead {
  return {
    id: "lead-1",
    businessName: "Testbedrijf",
    industry: "Retail",
    address: null,
    postalCode: null,
    city: "Eindhoven",
    province: "Noord-Brabant",
    country: "NL",
    phone: null,
    email: "test@example.com",
    website: null,
    websiteStatus: "no_website",
    googleRating: null,
    reviewCount: null,
    leadScore: 60,
    leadStatus: "qualified",
    outreachStatus: "not_contacted",
    demoStatus: "not_created",
    source: "google",
    notes: [],
    aiAnalysis: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

test("geen e-mailadres + contacteerbaar: Handmatig contact heeft hoogste prioriteit", () => {
  const result = primaryAction(lead({ email: null, phone: "+31612345678" }));
  assert.equal(result.label, "Handmatig contact");
  assert.equal(result.tone, "warning");
});

test("needsManualContact-semantiek volgt de bestaande contactability-regel: bij een reactie is het e-mailtekort irrelevant", () => {
  // needsManualContact geldt alleen voor nog niet gecontacteerde leads;
  // een lead die al reageerde heeft geen outreach-actie meer nodig.
  assert.equal(primaryAction(lead({ email: null, phone: "+31612345678", outreachStatus: "replied" })).label, "Reactie bekijken");
});

test("replied/interested: reactie bekijken gaat vóór outreach en demo", () => {
  assert.equal(primaryAction(lead({ outreachStatus: "replied", demoStatus: "ready" })).label, "Reactie bekijken");
  assert.equal(primaryAction(lead({ outreachStatus: "interested" })).label, "Reactie bekijken");
});

test("draft/opened: outreach afronden", () => {
  assert.equal(primaryAction(lead({ outreachStatus: "draft" })).label, "Outreach afronden");
  assert.equal(primaryAction(lead({ outreachStatus: "opened" })).label, "Outreach afronden");
});

test("demo ready (zonder actieve outreach): demo delen", () => {
  assert.equal(primaryAction(lead({ demoStatus: "ready", outreachStatus: "not_contacted" })).label, "Demo delen");
});

test("hoge score zonder outreach: outreach genereren", () => {
  assert.equal(primaryAction(lead({ leadScore: 75, outreachStatus: "not_contacted" })).label, "Outreach genereren");
});

test("lage score zonder bijzonderheden: algemeen bekijken", () => {
  assert.equal(primaryAction(lead({ leadScore: 30, outreachStatus: "not_contacted" })).label, "Bekijken");
});

test("won: klant-label, geen actievere verkoopactie", () => {
  assert.equal(primaryAction(lead({ leadStatus: "won" })).label, "Klant — bekijken");
});
