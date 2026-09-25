import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as typeof import("node:module") & { _load: (r: string, p: unknown, m: boolean) => unknown };
const originalLoad = Module._load.bind(Module);
Module._load = function intercepted(request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "next/navigation") return { redirect() { throw new Error("redirect"); } };
  if (request === "next/headers") return { cookies: async () => ({ getAll: () => [], set() {} }) };
  return originalLoad(request, parent, isMain);
};

const client = () => import("../lib/gmail/client");
const send = () => import("../lib/gmail/send");
const quality = () => import("../lib/outreach/quality-check");
const ai = () => import("../lib/ai/service");

const SIGNATURE_HTML = '<div dir="ltr"><b>Silvijn Verhouden</b><br>Silvijn Studio<br><a href="https://silvijnstudio.com">silvijnstudio.com</a></div>';

test("sender: the OAuth callback stores the authorized Gmail profile and refuses any account other than the required one", () => {
  const src = readFileSync("app/auth/gmail/callback/route.ts", "utf8");
  assert.match(src, /gmailGetProfile\(tokens\.accessToken\)/);
  assert.match(src, /if \(emailAddress !== required\)/);
  assert.match(src, /gmail_error: "wrong_account"/);
  assert.match(src, /accountKey: emailAddress/);
  assert.doesNotMatch(src, /silvijn@silvijnstudio\.com/, "login-adres is nooit meer de opgeslagen account_key");
});

test("sender: send uses the connected account as From and refuses a connection that is not the required account", () => {
  const src = readFileSync("lib/gmail/send.ts", "utf8");
  assert.match(src, /const senderAddress = connection\.account_key\.toLowerCase\(\)/);
  assert.match(src, /if \(senderAddress !== config\.accountKey\)/);
  assert.match(src, /from: senderAddress/);
  assert.doesNotMatch(src, /from: config\.accountKey/);
  assert.doesNotMatch(src, /from: "[^"]*@/, "geen hardcoded afzender");
});

test("signature: Gmail 'Send as' signature is appended exactly once, as multipart/alternative; threading headers untouched", async () => {
  const { buildGmailMime, signatureHtmlToText } = await client();
  const base = {
    from: "info@silvijnstudio.com",
    to: "klant@example.nl",
    subject: "Website voor uw bedrijf",
    body: "Goedendag,\n\nKorte tekst.\n\nMet vriendelijke groet,",
    messageIdHeader: "<outreach-1@silvijnstudio.com>",
    inReplyTo: "<klant-1@example.nl>",
    references: "<outreach-0@silvijnstudio.com> <klant-1@example.nl>",
  };
  const plain = buildGmailMime(base);
  assert.match(plain, /Content-Type: text\/plain; charset="UTF-8"/);
  assert.doesNotMatch(plain, /multipart/);

  const withSig = buildGmailMime({ ...base, signatureHtml: SIGNATURE_HTML });
  assert.match(withSig, /From: info@silvijnstudio\.com/);
  assert.match(withSig, /In-Reply-To: <klant-1@example\.nl>/);
  assert.match(withSig, /References: <outreach-0@silvijnstudio\.com> <klant-1@example\.nl>/);
  assert.match(withSig, /Content-Type: multipart\/alternative; boundary="sig_/);
  assert.equal((withSig.match(/Silvijn Verhouden/g) ?? []).length, 2, "één keer in text/plain, één keer in text/html");
  assert.ok(withSig.includes(SIGNATURE_HTML), "HTML-handtekening ongewijzigd behouden");
  assert.match(withSig, /Met vriendelijke groet,\n\nSilvijn Verhouden\nSilvijn Studio\nsilvijnstudio\.com \(https:\/\/silvijnstudio\.com\)/);
  assert.equal(signatureHtmlToText("<p>A&amp;B</p><br><p>C</p>"), "A&B\n\nC");
});

test("signature: never duplicated and never invented", async () => {
  const { resolveSenderSignature, signatureAlreadyPresent } = await send();
  const settingsScope = "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.settings.basic";
  assert.equal(signatureAlreadyPresent("Groet,\n\nSilvijn Verhouden\nSilvijn Studio", SIGNATURE_HTML), true);
  assert.equal(signatureAlreadyPresent("Groet,", SIGNATURE_HTML), false);
  // Zonder settings-scope: niets toevoegen (en zeker geen eigen handtekening verzinnen).
  const noScope = await resolveSenderSignature("t", "https://www.googleapis.com/auth/gmail.send", "info@silvijnstudio.com", "Groet,");
  assert.deepEqual(noScope, { html: null, reason: "scope_missing" });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ signature: SIGNATURE_HTML }), { status: 200 })) as typeof fetch;
    const applied = await resolveSenderSignature("t", settingsScope, "info@silvijnstudio.com", "Groet,");
    assert.equal(applied.reason, "applied");
    assert.equal(applied.html, SIGNATURE_HTML);
    const present = await resolveSenderSignature("t", settingsScope, "info@silvijnstudio.com", "Groet,\nSilvijn Verhouden");
    assert.deepEqual(present, { html: null, reason: "already_present" });
    globalThis.fetch = (async () => new Response(JSON.stringify({ signature: "" }), { status: 200 })) as typeof fetch;
    const none = await resolveSenderSignature("t", settingsScope, "info@silvijnstudio.com", "Groet,");
    assert.deepEqual(none, { html: null, reason: "none_configured" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("first mail: quality rules forbid demo/link/price/contact block and require the free-demo invitation and a bare greeting close", async () => {
  const { checkFirstOutreach, checkOutreachQuality } = await quality();
  const good =
    "Goedendag,\n\nIk kwam uw schildersbedrijf in Eindhoven tegen en dacht dat er mogelijk kansen liggen om de online presentatie te versterken.\n\nIk maak vrijblijvend en gratis een voorbeeld van hoe een moderne website voor uw bedrijf eruit zou kunnen zien. Als dat interessant is, laat het gerust weten.\n\nMet vriendelijke groet,";
  assert.deepEqual(checkFirstOutreach(good), []);
  const withLink = good.replace("laat het gerust weten", "bekijk de demo-website op https://demo.silvijnstudio.com/x");
  assert.ok(checkFirstOutreach(withLink).some((i) => /URL of link/.test(i)));
  const withPrice = good.replace("laat het gerust weten", "de prijs is 895 euro");
  assert.ok(checkFirstOutreach(withPrice).some((i) => /prijs/.test(i)));
  assert.ok(checkFirstOutreach(good.replace("laat het gerust weten", "dit kost u 895")).some((i) => /prijs/.test(i)));
  // Live-les 2026-09-25: "zonder kosten" is de gewenste formulering, geen prijsindicatie.
  assert.deepEqual(checkFirstOutreach(good.replace("vrijblijvend en gratis", "geheel vrijblijvend en zonder kosten")), []);
  const withName = `${good}\nSilvijn Verhouden\nSilvijn Studio | 06-12345678`;
  const nameIssues = checkFirstOutreach(withName);
  assert.ok(nameIssues.some((i) => /groetregel/.test(i)));
  assert.ok(nameIssues.some((i) => /contactgegevens/.test(i)));
  const noDemo = good.replace("een voorbeeld van hoe een moderne website", "graag een afspraak over een website");
  assert.ok(checkFirstOutreach(noDemo).some((i) => /uitnodiging/.test(i)));
  const long = `${"woord ".repeat(170)}\n\nMet vriendelijke groet,`;
  assert.ok(checkFirstOutreach(long).some((i) => /te lang/.test(i)));
  // Alleen voor firstOutreach; follow-ups/sales replies veranderen niet.
  const generic = checkOutreachQuality({ subject: "Website voor uw bedrijf", body: `${good}\nSilvijn Studio`, callToAction: "Laat gerust weten of het interessant is" });
  assert.equal(generic.passed, true);
  const first = checkOutreachQuality({ subject: "Website voor uw bedrijf", body: `${good}\nSilvijn Studio`, callToAction: "Laat gerust weten of het interessant is" }, { firstOutreach: true });
  assert.equal(first.passed, false);
});

test("first mail: Generate Outreach Draft never reads a demo for the initial mail and applies the first-mail rules", () => {
  const src = readFileSync("lib/outreach/service.ts", "utf8");
  assert.match(src, /const demo = purpose === "initial" \? null : await demoRepository\.findByLeadId\(leadId\)/);
  assert.match(src, /firstOutreach: purpose === "initial"/);
  assert.doesNotMatch(src, /generateDemo|createDemo|upsertThemeDemo|generateDemoForLead/, "Generate Outreach Draft genereert nooit een demo");
});

test("first mail: prompt asks for a short personal mail, free-demo offer as invitation only, no links/price, bare greeting close", async () => {
  await ai();
  const src = readFileSync("lib/ai/service.ts", "utf8");
  assert.match(src, /Schrijf de EERSTE outreach-e-mail \(koude kennismaking\)/);
  assert.match(src, /60-120 woorden/);
  assert.match(src, /stuur GEEN demo, link, preview of afbeelding mee/);
  assert.match(src, /Geen URL's in de tekst/);
  assert.match(src, /geen prijs/);
  assert.match(src, /Sluit af met uitsluitend een korte groetregel/);
  assert.match(src, /if \(input\.demo && kind !== "initial"\)/);
  // Mock-output volgt hetzelfde contract (tests/dashboard in mock-modus).
  const mock = readFileSync("lib/ai/mock-provider.ts", "utf8");
  assert.match(mock, /Met vriendelijke groet,"/);
  assert.doesNotMatch(mock, /Bekijk gerust of de stijl/);
});
