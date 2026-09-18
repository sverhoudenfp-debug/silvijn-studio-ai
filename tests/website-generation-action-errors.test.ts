import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Bron-contracttests (zelfde patroon als security-pricing.test.ts): de
// modules onder test importeren next/navigation via lib/auth/server, wat
// buiten een React-runtime niet laadt. Daarom bewaken we de contracten op
// broncodeniveau; runtime-gedrag wordt door de live E2E op de fixture gedekt.

const root = process.cwd();
const actionSource = readFileSync(path.join(root, "app/actions/websites.ts"), "utf8");
const sectionSource = readFileSync(
  path.join(root, "components/projects/website-generation-section.tsx"),
  "utf8"
);
const paymentsSource = readFileSync(path.join(root, "lib/payments/service.ts"), "utf8");
const serviceSource = readFileSync(path.join(root, "lib/websites/service.ts"), "utf8");

/**
 * REGRESSIETEST (productiebug 2026-09-19, owner-test [TEST-FIXTURE]):
 * "Minified React error #441" bij "Genereer Website" in de zip-flow.
 *
 * Exacte oorzaak: de productie-poort (assertProductionAuthorized) weigerde
 * terecht — het fixtureproject had géén goedgekeurde prijs, géén betaalplan
 * en géén bevestigde betaling (live DB-bewijs: price_status=not_calculated,
 * 0 price_approvals, 0 payment_events; de pipeline opent bewust met de
 * poort, dus géén website-record, géén AI-run, géén audit-event). De
 * weigering kwam echter als ruwe Error-throw uit de server action, en
 * React/Next maskeert een geserverde throw in productie tot
 * "Minified React error #441" — de eigenaar zag een crash i.p.v. de echte
 * reden (zelfde maskeerles als de Design Plan-fix, commit 6390ad5).
 */

// ---------------------------------------------------------------------------
// 1. Getypeerde poortweigering (zonder de poort zelf te verzwakken)
// ---------------------------------------------------------------------------

test("de poort gooit een getypeerde ProductionGateError — conditie onveranderd !gate.allowed", () => {
  assert.match(paymentsSource, /export class ProductionGateError extends Error/);
  assert.match(paymentsSource, /this\.name = "ProductionGateError"/);
  assert.match(paymentsSource, /if \(!gate\.allowed\) \{\s*\n\s*throw new ProductionGateError\(/);
  assert.match(paymentsSource, /PRODUCTION_BLOCKED: productie vereist een goedgekeurde scope\/prijs/);
  // De poort-conditie zelf is onaangeraakt: de weigering blijft gebaseerd op
  // het DB-gate-resultaat, niet op client-/soft-state.
  assert.doesNotMatch(paymentsSource, /gate\.allowed\s*=\s*true/);
});

// ---------------------------------------------------------------------------
// 2. Service-contract: de poort is de EERSTE stap (guard-failures kosten
//    geen AI-budget en laten geen half geschreven staat na)
// ---------------------------------------------------------------------------

test("generateWebsite start met de productie-poort vóór project/lead-guards en AI", () => {
  assert.match(serviceSource, /await assertProductionAuthorized\(projectId\);/);
  const gateIdx = serviceSource.indexOf("await assertProductionAuthorized(projectId)");
  const projectGuardIdx = serviceSource.indexOf("Project niet gevonden");
  const aiIdx = serviceSource.indexOf("AI WEBSITE PLANNING");
  assert.ok(gateIdx > -1 && gateIdx < projectGuardIdx && projectGuardIdx < aiIdx,
    "poort moet vóór de guards en ver vóór de AI-call staan");
});

test("de service persisteert bij een falende generatie zélf de failed-status vóór de rethrow", () => {
  // Daardoor mag de action in het catch-pad enkel revalideren en hoeft zelf
  // niets te schrijven; het failed-record blijft altijd zichtbaar.
  const catchIdx = serviceSource.indexOf("} catch (error) {");
  const failedIdx = serviceSource.indexOf('status: "failed"', catchIdx);
  const rethrowIdx = serviceSource.indexOf("throw error;", catchIdx);
  assert.ok(catchIdx > -1 && failedIdx > catchIdx && rethrowIdx > failedIdx,
    "in de service-catch: eerst failed-status persistèren, dan rethrowen");
});

// ---------------------------------------------------------------------------
// 3. Action-contract: verwachte fouten → { ok: false, error }, géén #441
// ---------------------------------------------------------------------------

test("action-contract: poort-/guard-/limiet-/AI-fouten komen terug als { ok: false, error }", () => {
  assert.match(actionSource, /export type GenerateWebsiteResult =[\s\S]*?\{ ok: true; website: GeneratedWebsite \}[\s\S]*?\{ ok: false; error: string \}/);
  assert.match(
    actionSource,
    /error instanceof ProductionGateError \|\|\s*\n\s*error instanceof WebsiteGenerationError \|\|\s*\n\s*error instanceof WebsiteLimitError \|\|\s*\n\s*error instanceof AIError/
  );
  assert.match(actionSource, /return \{ ok: false, error: error\.message \}/);
});

test("action-contract: onverwachte fouten blijven throwen (Vercel-logging)", () => {
  const catchIdx = actionSource.indexOf("} catch (error) {");
  const throwIdx = actionSource.indexOf("    throw error;", catchIdx);
  assert.ok(catchIdx > -1 && throwIdx > catchIdx,
    "de action moet expliciet onverwachte fouten rethrowen");
});

test("action-contract: revalidatePath staat op succès- én faalpad (failed-record zichtbaar)", () => {
  const occurrences = actionSource.match(/revalidatePath\(`\/projects\/\$\{projectId\}`\)/g);
  assert.ok(occurrences && occurrences.length >= 2,
    "revalidatePath moet op succès- én faalpad staan");
});

// ---------------------------------------------------------------------------
// 4. UI-contract: de echte reden komt inline in het paneel
// ---------------------------------------------------------------------------

test("UI-contract: website-generation-section toont de echte foutreden uit het actieresultaat", () => {
  assert.match(sectionSource, /const result = await generateWebsiteAction\(projectId\)/);
  assert.match(sectionSource, /if \(!result\.ok\) setError\(result\.error\)/);
});

test("REGRESSIE: géén startTransition(async ...) in het website-generatiepad", () => {
  // Fase E-les: React 19 levert rejections van startTransition(async ...) aan
  // de error boundary i.p.v. de lokale catch — oorspronkelijke #441-route.
  assert.doesNotMatch(sectionSource, /startTransition/);
});
