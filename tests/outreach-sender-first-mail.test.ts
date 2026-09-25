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

const sendAs = () => import("../lib/gmail/send-as");

const SEND_AS_LIST = {
  sendAs: [
    { sendAsEmail: "silvijn@silvijnstudio.com", displayName: "Silvijn Verhouden", isPrimary: true, isDefault: false, signature: "" },
    {
      sendAsEmail: "Info@SilvijnStudio.com",
      displayName: "Silvijn Studio",
      isDefault: true,
      treatAsAlias: true,
      verificationStatus: "accepted",
      signature: SIGNATURE_HTML,
    },
  ],
};

test("send-as: primary OAuth account is silvijn@, outreach alias is info@ (both overridable via env, never hardcoded From)", async () => {
  const { DEFAULT_GMAIL_ACCOUNT_KEY, DEFAULT_GMAIL_SEND_AS, gmailSendAsEmail } = await import("../lib/gmail/config");
  assert.equal(DEFAULT_GMAIL_ACCOUNT_KEY, "silvijn@silvijnstudio.com");
  assert.equal(DEFAULT_GMAIL_SEND_AS, "info@silvijnstudio.com");
  const prev = process.env.GMAIL_SEND_AS;
  try {
    delete process.env.GMAIL_SEND_AS;
    assert.equal(gmailSendAsEmail(), "info@silvijnstudio.com");
    process.env.GMAIL_SEND_AS = " Sales@SilvijnStudio.com ";
    assert.equal(gmailSendAsEmail(), "sales@silvijnstudio.com");
  } finally {
    if (prev === undefined) delete process.env.GMAIL_SEND_AS;
    else process.env.GMAIL_SEND_AS = prev;
  }
});

test("send-as: settings.sendAs.list is parsed and the alias resolves only when present and verified", async () => {
  const { parseSendAsList, resolveSendAsAlias, buildFromHeader } = await sendAs();
  const aliases = parseSendAsList(SEND_AS_LIST);
  assert.equal(aliases.length, 2);
  assert.equal(aliases[1].sendAsEmail, "info@silvijnstudio.com", "adres genormaliseerd naar lowercase");
  assert.equal(aliases[1].signatureHtml, SIGNATURE_HTML);
  assert.equal(aliases[0].signatureHtml, null);
  assert.deepEqual(parseSendAsList({}), []);
  assert.deepEqual(parseSendAsList(null), []);

  const ok = resolveSendAsAlias(aliases, "info@silvijnstudio.com", "silvijn@silvijnstudio.com");
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.alias.displayName, "Silvijn Studio");
    assert.equal(buildFromHeader(ok.alias), '"Silvijn Studio" <info@silvijnstudio.com>');
  }
  // Primaire adres zelf telt altijd als geverifieerd (Gmail geeft er geen verificationStatus voor).
  assert.equal(resolveSendAsAlias(aliases, "silvijn@silvijnstudio.com", "silvijn@silvijnstudio.com").ok, true);
  // Weergavenaam zonder injectie van header-regels; zonder naam alleen het adres.
  assert.equal(buildFromHeader({ sendAsEmail: "info@silvijnstudio.com", displayName: 'X"\r\nBcc: a@b' }), '"XBcc: a@b" <info@silvijnstudio.com>');
  assert.equal(buildFromHeader({ sendAsEmail: "info@silvijnstudio.com", displayName: null }), "info@silvijnstudio.com");

  const notListed = resolveSendAsAlias(aliases.slice(0, 1), "info@silvijnstudio.com", "silvijn@silvijnstudio.com");
  assert.equal(notListed.ok, false);
  if (!notListed.ok) {
    assert.equal(notListed.status, "not_listed");
    assert.match(notListed.reason, /Accounts en import/);
    assert.match(notListed.reason, /Behandelen als alias/);
    assert.match(notListed.reason, /Google Workspace Admin/);
    assert.match(notListed.reason, /niets automatisch aangemaakt/);
  }
  const pending = resolveSendAsAlias(
    parseSendAsList({ sendAs: [{ ...SEND_AS_LIST.sendAs[1], verificationStatus: "pending" }] }),
    "info@silvijnstudio.com",
    "silvijn@silvijnstudio.com"
  );
  assert.equal(pending.ok, false);
  if (!pending.ok) {
    assert.equal(pending.status, "pending");
    assert.match(pending.reason, /verificationStatus=pending/);
  }
  const unspecified = resolveSendAsAlias(
    parseSendAsList({ sendAs: [{ ...SEND_AS_LIST.sendAs[1], verificationStatus: "verificationStatusUnspecified" }] }),
    "info@silvijnstudio.com",
    "silvijn@silvijnstudio.com"
  );
  assert.equal(unspecified.ok, false);
  if (!unspecified.ok) assert.equal(unspecified.status, "unknown");
});

test("send-as: the OAuth callback requires the primary account, checks the alias live and stores the outcome (never creates anything)", () => {
  const src = readFileSync("app/auth/gmail/callback/route.ts", "utf8");
  assert.match(src, /gmailGetProfile\(tokens\.accessToken\)/);
  assert.match(src, /if \(emailAddress !== config\.accountKey\)/);
  assert.match(src, /gmail_error: "wrong_account"/);
  assert.match(src, /resolveSendAsAlias\(await gmailListSendAs\(tokens\.accessToken\), config\.sendAsEmail, emailAddress\)/);
  assert.match(src, /accountKey: emailAddress/);
  assert.match(src, /sendAs: toSnapshot\(/);
  assert.doesNotMatch(src, /silvijn@silvijnstudio\.com|info@silvijnstudio\.com/, "geen hardcoded adressen in de callback");
  assert.doesNotMatch(src, /settings\/sendAs[^"]*method: "POST"|sendAs\.create|sendAs\.patch/, "nooit aliassen aanmaken of wijzigen");
});

test("send-as: sending validates the alias live via the Gmail API on every send and uses it as From; blocked with the exact reason otherwise", () => {
  const src = readFileSync("lib/gmail/send.ts", "utf8");
  assert.match(src, /getGmailAccessToken\(config\.accountKey\)/);
  assert.match(src, /if \(accountEmail !== config\.accountKey\)/);
  assert.match(src, /checkSendAsAlias\(\{[\s\S]*sendAsEmail: config\.sendAsEmail/);
  assert.match(src, /SEND_AS_ALIAS_UNAVAILABLE \(\$\{sendAs\.status\}\): \$\{sendAs\.reason\}/);
  assert.match(src, /const fromHeader = buildFromHeader\(sendAs\.alias\)/);
  assert.match(src, /from: fromHeader/);
  assert.match(src, /resolveAliasSignature\(sendAs\.alias\.signatureHtml, draft\.body\)/);
  assert.doesNotMatch(src, /from: config\./);
  assert.doesNotMatch(src, /from: "[^"]*@/, "geen hardcoded afzender");
  const check = readFileSync("lib/gmail/send-as-check.ts", "utf8");
  assert.match(check, /gmailListSendAs\(input\.accessToken\)/);
  assert.doesNotMatch(check, /method: "POST"|PATCH|PUT/, "puur lezen bij Google");
});

test("signature: Gmail 'Send as' signature is appended exactly once, as multipart/alternative; threading headers untouched", async () => {
  const { buildGmailMime, signatureHtmlToText } = await client();
  const base = {
    from: '"Silvijn Studio" <info@silvijnstudio.com>',
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
  assert.match(withSig, /From: "Silvijn Studio" <info@silvijnstudio\.com>/);
  assert.match(withSig, /In-Reply-To: <klant-1@example\.nl>/);
  assert.match(withSig, /References: <outreach-0@silvijnstudio\.com> <klant-1@example\.nl>/);
  assert.match(withSig, /Content-Type: multipart\/alternative; boundary="sig_/);
  assert.equal((withSig.match(/Silvijn Verhouden/g) ?? []).length, 2, "één keer in text/plain, één keer in text/html");
  assert.ok(withSig.includes(SIGNATURE_HTML), "HTML-handtekening ongewijzigd behouden");
  assert.match(withSig, /Met vriendelijke groet,\n\nSilvijn Verhouden\nSilvijn Studio\nsilvijnstudio\.com \(https:\/\/silvijnstudio\.com\)/);
  assert.equal(signatureHtmlToText("<p>A&amp;B</p><br><p>C</p>"), "A&B\n\nC");
});

test("signature: alias signature never duplicated and never invented", async () => {
  const { resolveAliasSignature, signatureAlreadyPresent } = await send();
  assert.equal(signatureAlreadyPresent("Groet,\n\nSilvijn Verhouden\nSilvijn Studio", SIGNATURE_HTML), true);
  assert.equal(signatureAlreadyPresent("Groet,", SIGNATURE_HTML), false);
  assert.deepEqual(resolveAliasSignature(SIGNATURE_HTML, "Groet,"), { html: SIGNATURE_HTML, reason: "applied" });
  assert.deepEqual(resolveAliasSignature(SIGNATURE_HTML, "Groet,\nSilvijn Verhouden"), { html: null, reason: "already_present" });
  assert.deepEqual(resolveAliasSignature(null, "Groet,"), { html: null, reason: "none_configured" });
  assert.deepEqual(resolveAliasSignature("  ", "Groet,"), { html: null, reason: "none_configured" });
});

test("send-as: settings card explains account, alias and status in the owner's words", () => {
  const src = readFileSync("components/settings/gmail-settings-card.tsx", "utf8");
  assert.match(src, /Verbonden Gmail-account:/);
  assert.match(src, /Outreach verzenden als:/);
  assert.match(src, /Send-as alias geverifieerd/);
  assert.match(src, /recheckGmailSendAs/);
  assert.doesNotMatch(src, /Google Workspace-gebruiker van/, "nooit meer adviseren een aparte gebruiker aan te maken");
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
