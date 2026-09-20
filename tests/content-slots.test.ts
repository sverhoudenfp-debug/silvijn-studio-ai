import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONTENT_UNIT_KINDS,
  CONTENT_SLOT_REGISTRY,
  CONTENT_PAGE_SLOT_DEFINITIONS,
  contentSlotsForSection,
  requiredSlotKinds,
  factLockedSlotKinds,
  isEvidenceOnlySection,
  validateContentSlotRegistryConformance,
} from "@/lib/websites/content/content-slots";
import { BLUEPRINT_SECTION_TYPES } from "@/lib/websites/blueprint/section-registry";

// ---------------------------------------------------------------------------
// C3a — CONTENT SLOT REGISTRY: conformance tegen de SECTION-REGISTRY
// ---------------------------------------------------------------------------

test("slot-registry: elk blueprint-sectietype heeft slotdefinities", () => {
  for (const type of BLUEPRINT_SECTION_TYPES) {
    assert.ok(CONTENT_SLOT_REGISTRY[type], `sectietype ${type} mist slotdefinities`);
    assert.ok(CONTENT_SLOT_REGISTRY[type].length > 0, `sectietype ${type} heeft lege slotdefinities`);
  }
  // Geen extra sectietypes die niet in de SECTION-REGISTRY bestaan.
  const registryTypes = new Set(BLUEPRINT_SECTION_TYPES);
  for (const type of Object.keys(CONTENT_SLOT_REGISTRY)) {
    assert.ok(registryTypes.has(type as (typeof BLUEPRINT_SECTION_TYPES)[number]), `onbekend sectietype ${type}`);
  }
});

test("slot-registry: alle kinds zijn gesloten en bekend", () => {
  const kindSet = new Set<string>(CONTENT_UNIT_KINDS);
  const conformance = validateContentSlotRegistryConformance();
  assert.equal(conformance.passed, true, conformance.errors.join(" | "));
  assert.ok(kindSet.size === CONTENT_UNIT_KINDS.length, "kinds moeten uniek zijn");
  for (const pageSlot of CONTENT_PAGE_SLOT_DEFINITIONS) {
    assert.ok(kindSet.has(pageSlot.kind), `pagina-slot ${pageSlot.kind} onbekend`);
  }
  assert.ok(CONTENT_PAGE_SLOT_DEFINITIONS.some((s) => s.kind === "seo_title" && s.required));
  assert.ok(CONTENT_PAGE_SLOT_DEFINITIONS.some((s) => s.kind === "seo_description" && s.required));
});

test("slot-registry: evidence_only-secties hebben een factLocked feitelijke kern", () => {
  const evidenceOnlyTypes = BLUEPRINT_SECTION_TYPES.filter(isEvidenceOnlySection);
  // De zes evidence_only-types uit de registry.
  assert.deepEqual([...evidenceOnlyTypes].sort(), ["projects", "rates", "stats", "team", "testimonials", "usp_band"]);
  for (const type of evidenceOnlyTypes) {
    const locked = factLockedSlotKinds(type);
    assert.ok(locked.length > 0, `${type} moet factLocked slots hebben (feitelijke kern)`);
  }
  // De pure-feit secties dragen uitsluitend factLocked slots.
  assert.deepEqual([...factLockedSlotKinds("stats")], ["stat_label", "stat_value"]);
  assert.deepEqual([...factLockedSlotKinds("testimonials")].sort(), ["quote", "quote_author"]);
  assert.deepEqual([...factLockedSlotKinds("team")].sort(), ["member_name", "member_role"]);
  assert.deepEqual([...factLockedSlotKinds("rates")].sort(), ["item_title", "rate_value"]);
  assert.deepEqual([...factLockedSlotKinds("usp_band")], ["item_label", "item_hint"]);
});

test("slot-registry: factLocked bedrijfsfeiten buiten evidence_only ook afgeschermd", () => {
  // Dienstnamen zijn bedrijfsfeiten: nooit AI-verzonnen (anti-fabricatie).
  assert.ok(factLockedSlotKinds("services").includes("item_title"));
  assert.ok(!factLockedSlotKinds("services").includes("item_body"), "dienstomschrijving mag geformuleerd worden (evidence-gedragen)");
  // Projecttitels zijn echte feiten; omschrijving is evidence-gedragen copy.
  assert.ok(factLockedSlotKinds("projects").includes("item_title"));
  assert.ok(!factLockedSlotKinds("projects").includes("item_body"));
});

test("slot-registry: required-slots dekken de opdracht-contentsoorten", () => {
  // Hero copy
  assert.deepEqual([...requiredSlotKinds("hero")], ["headline", "cta_label"]);
  // Services
  assert.deepEqual([...requiredSlotKinds("services")], ["item_title"]);
  // Benefits/USP's
  assert.deepEqual([...requiredSlotKinds("benefits")], ["item_text"]);
  assert.ok(requiredSlotKinds("usp_band").includes("item_label"));
  // Process
  assert.deepEqual([...requiredSlotKinds("process")], ["step_title"]);
  // CTA's
  assert.ok(requiredSlotKinds("cta").includes("cta_label"));
  assert.ok(requiredSlotKinds("contact").includes("cta_label"));
  // FAQ
  assert.deepEqual([...requiredSlotKinds("faq")], ["faq_question", "faq_answer"]);
  // About
  assert.deepEqual([...requiredSlotKinds("about")], ["body"]);
  // Microcopy bestaat als soort (UI, geen commerciële copy)
  assert.ok(contentSlotsForSection("contact").some((s) => s.kind === "microcopy" && !s.factLocked));
});

test("slot-registry: helpers blijven binnen het gesloten contract", () => {
  assert.throws(() => contentSlotsForSection("niet_bestaand" as never));
  assert.throws(() => requiredSlotKinds("niet_bestaand" as never));
});
