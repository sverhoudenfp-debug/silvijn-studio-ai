import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Regressietests — inloggen met wachtwoord i.p.v. magic link (2026-10-01).
 * Gedekte klasse van bugs:
 *  1. Per ongeluk terug naar magic-link/Otp (verificatie-e-mail moest weg).
 *  2. De server-side eigenaar-poort (OWNER_EMAIL + is_studio_owner) verdwijnt
 *     stilletjes uit de nieuwe wachtwoordflow.
 *  3. De "Ga naar website"-knop ontbreekt of naar een verkeerde URL wijst.
 *  4. Wachtwoordveld zonder type/password of zonder autocomplete-conventie.
 */

const root = path.join(import.meta.dirname, "..");

test("login-action gebruikt wachtwoord-login, geen magic link", () => {
  const actions = readFileSync(path.join(root, "app/login/actions.ts"), "utf8");
  assert.ok(actions.includes("signInWithPassword"), "moet signInWithPassword gebruiken");
  assert.ok(!actions.includes("signInWithOtp"), "geen e-mail-OTP meer");
  assert.ok(!actions.includes("emailRedirectTo"), "geen e-mail-redirect meer");
  assert.ok(!actions.includes("shouldCreateUser"), "geen impliciete accountcreatie meer");
});

test("login-action houdt de server-side eigenaar-poorten intact", () => {
  const actions = readFileSync(path.join(root, "app/login/actions.ts"), "utf8");
  assert.ok(actions.includes('OWNER_EMAIL = "silvijn@silvijnstudio.com"'), "geautoriseerd account vast in code");
  assert.ok(actions.includes("is_studio_owner"), "is_studio_owner-RPC blijft verplicht na succesvolle login");
  assert.ok(actions.includes("access_denied"), "niet-eigenaar wordt uitgelogd en geweigerd");
  assert.ok(actions.includes("z.string().email()"), "e-mail blijft gevalideerd vóór enige auth-aanroep");
});

test("login-pagina heeft wachtwoordveld, Inloggen-knop en geen e-mail-link-flow", () => {
  const page = readFileSync(path.join(root, "app/login/page.tsx"), "utf8");
  assert.ok(page.includes('type="password"'), "wachtwoordveld met type=password");
  assert.ok(page.includes('autoComplete="current-password"'), "autocomplete-conventie voor wachtwoordveld");
  assert.ok(page.includes(">Inloggen</button>"), "knop heet Inloggen");
  assert.ok(!page.includes("requestLogin"), "oude magic-link-action is vervangen");
  assert.ok(!page.includes("Stuur beveiligde inloglink"), "oude magic-link-tekst is weg");
  assert.ok(!page.includes("sent"), "geen verzonden-status meer (geen e-mailflow)");
});

test("login-pagina heeft een werkende Ga naar website-knop naar de publieke site", () => {
  const page = readFileSync(path.join(root, "app/login/page.tsx"), "utf8");
  assert.ok(page.includes('href="https://silvijnstudio.com"'), "link wijst naar de publieke website");
  assert.ok(page.includes("Ga naar website"), "knoptekst aanwezig");
  // Externe link: geen client-side navigatie die sessie/staat deelt.
  assert.ok(!page.includes("<Link"), "externe link is een gewone <a>, geen interne Link");
});

test("bestaande autorisatie-onderdelen zijn onaangetast", () => {
  const server = readFileSync(path.join(root, "lib/auth/server.ts"), "utf8");
  assert.ok(server.includes("is_studio_owner"), "requireStudioOwner blijft autoritatief");
  assert.ok(server.includes("user.email_confirmed_at"), "bevestigd-account-eis blijft staan");
  const proxy = readFileSync(path.join(root, "proxy.ts"), "utf8");
  assert.ok(proxy.includes("/login"), "proxy blijft onbevoegden naar /login sturen");
});
