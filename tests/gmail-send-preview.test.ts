import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const previewSrc = readFileSync(path.join(root, "lib/gmail/send-preview.ts"), "utf8");
const routeSrc = readFileSync(path.join(root, "app/api/outreach/send-preview/route.ts"), "utf8");

test("verzendvoorbeeld verzendt niets en schrijft niets (source-guard)", () => {
  // Geen Gmail-send, geen verzendclaim, geen statuswijziging: uitsluitend lezen + opbouwen.
  assert.ok(!/gmailSend\b/.test(previewSrc), "geen gmailSend in het voorbeeld");
  assert.ok(!/messages\/send/.test(previewSrc));
  assert.ok(!/\.update\(|\.insert\(|\.upsert\(|\.delete\(|\.rpc\(/.test(previewSrc), "geen schrijvende Supabase-calls");
  assert.ok(!/newOutreachMessageIdHeader/.test(previewSrc), "echte Message-ID wordt alleen bij verzending gegenereerd");
  assert.ok(/checkSendAsAlias\(/.test(previewSrc), "live alias-controle blijft verplicht");
  assert.ok(/resolveAliasSignature\(/.test(previewSrc), "alias-handtekening via dezelfde resolver als de echte verzending");
  assert.ok(/buildGmailMime\(/.test(previewSrc), "zelfde MIME-builder als de echte verzending");
});

test("verzendvoorbeeld-route vereist eigenaarssessie of CRON_SECRET", () => {
  assert.ok(/x-cron-secret/.test(routeSrc));
  assert.ok(/is_studio_owner/.test(routeSrc));
  assert.ok(/status: 401/.test(routeSrc));
});

test("splitAlternativeParts scheidt plain en html", async () => {
  const { splitAlternativeParts } = await import("../lib/gmail/send-preview");
  const mime = ['Content-Type: multipart/alternative; boundary="b1"', "", "--b1", 'Content-Type: text/plain; charset="UTF-8"', "", "Hallo\n\nGroet", "--b1", 'Content-Type: text/html; charset="UTF-8"', "", "<div>Hallo<br>Groet</div>", "--b1--"].join("\r\n");
  const [plain, html] = splitAlternativeParts(mime);
  assert.match(plain, /Hallo/);
  assert.ok(!/<div>/.test(plain));
  assert.match(html, /<div>/);
  const [single, none] = splitAlternativeParts("Content-Type: text/plain\r\n\r\nx");
  assert.equal(none, "");
  assert.match(single, /x/);
});
