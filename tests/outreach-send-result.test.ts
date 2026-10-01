import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Regressietests — productiebug 2026-10-01 "Minified React error #441" bij
 * "Versturen via Gmail" (lead Twan Janssen Schilderwerken, geen e-mailadres).
 *
 * Gedekte bugklasse:
 *  1. Een Server Action die voor verwachte fouten throwt, laat in Next 16 de
 *     client-render crashen met React #441 (Server Components-renderfout;
 *     /outreach heeft geen error.tsx). Verwachte fouten moeten als
 *     getypeerd resultaat terugkomen.
 *  2. De client moet result.ok afvangen vóór de herlaadactie, zodat een
 *     mislukte verzending een inline melding geeft i.p.v. een pagina-crash.
 *  3. Mislukte verzending vóór de Gmail-call mag het draft niet raken
 *     (status blijft approved, geen claim/provider-bewijs).
 *  4. Een al verzonden draft mag nooit opnieuw verstuurd kunnen worden
 *     (claim + immutable-guard blijven in de keten).
 */

const root = path.join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

test("send-action gooit geen verwachte fouten meer, maar geeft een getypeerd resultaat", () => {
  const actions = read("app/actions/gmail.ts");
  assert.ok(actions.includes("export type SendDraftResult"), "getypeerd resultaat geëxporteerd");
  assert.ok(actions.includes("catch (error)"), "onverwachte fouten worden afgevangen");
  assert.ok(actions.includes("ok: false"), "fouten komen als { ok: false } terug");
  assert.ok(actions.includes("| { ok: false; error: string }"), "resultaattype documenteert het foutkanaal");
  assert.ok(actions.includes("console.error"), "fouten blijven server-side gelogd");
  assert.ok(!/throw new Error\("BLOCKED_EXTERNAL_CONFIGURATION/.test(actions.split("sendApprovedOutreachDraft")[1] ?? ""), "Gmail-config-fout is geen throw meer");
});

test("client toont verzendfouten inline zonder de pagina te breken", () => {
  const view = read("components/outreach/outreach-view.tsx");
  assert.ok(view.includes("const result = await sendApprovedOutreachDraft(draftId)"), "resultaat wordt opgevangen");
  assert.ok(view.includes("if (!result.ok)"), "result.ok wordt gecontroleerd vóór herladen");
  assert.ok(view.indexOf("if (!result.ok)") < view.indexOf("window.location.reload()"), "geen herladen bij een mislukte verzending");
  assert.ok(view.includes("setError(result.error)"), "inline foutmelding wordt getoond");
});

test("bestemmingscontrole gebeurt vóór de verzendclaim: mislukking laat het draft onaangetast", () => {
  const send = read("lib/gmail/send.ts");
  const destIndex = send.indexOf("resolveOutreachDestination(");
  const claimIndex = send.indexOf("Dubbelverzend-slot");
  assert.ok(destIndex > 0 && claimIndex > 0, "zowel bestemming als claim aanwezig");
  assert.ok(destIndex < claimIndex, "bestemming wordt opgelost vóór het claimen");
  assert.ok(send.includes("Geen e-mailadres bekend voor deze lead"), "expliciete foutmelding zonder e-mailadres");
});

test("al verzonden drafts blijven immutable: geen tweede verzending mogelijk", () => {
  const send = read("lib/gmail/send.ts");
  assert.ok(send.includes('is("provider_message_id", null)'), "atomische claim vereist draft zonder provider_message_id");
  assert.ok(send.includes("Dit draft is al verzonden (immutable)"), "immutable-guard aanwezig");
  assert.ok(send.includes('status: "failed"'), "provider-fout ná de claim markeert het draft failed");
});

test("de productiondb-status van de gefixte flow klopt: approved draft zonder claim kan opnieuw aangeboden worden", () => {
  const send = read("lib/gmail/send.ts");
  // Een draft dat vóór de claim faalt (zoals bij de Twan-lead) behoudt
  // status approved + provider_message_id null; de claim-query matcht
  // precies die staat, dus herstelt de normale actie zonder databewijs.
  assert.ok(send.includes('eq("status", "approved")'), "claim vereist status approved");
});
