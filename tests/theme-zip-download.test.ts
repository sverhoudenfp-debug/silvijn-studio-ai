/**
 * Regressietests — "Download Shopify Theme ZIP"-actie.
 *
 * Contract: de download gebruikt uitsluitend een bestaand, gevalideerd
 * (status "passed") artefact mét opgeslagen ZIP uit de privé-bucket, via
 * de bestaande signed-URL-infrastructuur. Er wordt NOOIT een nieuwe
 * website-/themegeneratie gestart en geen enkele QC-, payment-,
 * approval- of delivery-gate wordt aangeraakt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { selectDownloadableArtifact, toArtifactSummary } from "../lib/websites/theme-zip/download";
import type { ThemeZipArtifact } from "../lib/websites/theme-zip/repository";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function makeArtifact(overrides: Partial<ThemeZipArtifact> & { id: string; version: number }): ThemeZipArtifact {
  return {
    websiteId: "website-1",
    projectId: "project-1",
    leadId: "lead-1",
    status: "passed",
    storageBucket: "theme-artifacts",
    storagePath: `theme-artifacts/${overrides.id}.zip`,
    fileName: "theme.zip",
    sizeBytes: 29428,
    fileCount: 46,
    checksumSha256: "abc",
    validationErrors: [],
    createdAt: "2026-09-19T00:00:00Z",
    updatedAt: "2026-09-19T00:00:00Z",
    ...overrides,
  } as ThemeZipArtifact;
}

test("selectDownloadableArtifact: nieuwste passed artefact mét opgeslagen ZIP wint", () => {
  const v1 = makeArtifact({ id: "a1", version: 1 });
  const v2 = makeArtifact({ id: "a2", version: 2 });
  const selected = selectDownloadableArtifact([v1, v2]);
  assert.equal(selected?.id, "a2", "de nieuwste versie moet winnen");
});

test("selectDownloadableArtifact: failed artefacten worden nooit downloadbaar", () => {
  const failed = makeArtifact({ id: "a-fail", version: 3, status: "failed", validationErrors: ["structure"] });
  const passed = makeArtifact({ id: "a-pass", version: 1 });
  const selected = selectDownloadableArtifact([failed, passed]);
  assert.equal(selected?.id, "a-pass", "failed builds blijven onzichtbaar; oudere passed blijft geldig");
});

test("selectDownloadableArtifact: passed zónder opgeslagen ZIP is niet downloadbaar", () => {
  const noStorage = makeArtifact({ id: "a-nostorage", version: 2, storageBucket: null, storagePath: null });
  assert.equal(selectDownloadableArtifact([noStorage]), null);
  assert.equal(selectDownloadableArtifact([]), null);
});

test("toArtifactSummary: volledige samenvatting voor de UI-knop", () => {
  const artifact = makeArtifact({ id: "a1", version: 1, fileName: "studio-thema.zip", sizeBytes: 4096 });
  assert.deepEqual(toArtifactSummary(artifact), {
    id: "a1",
    version: 1,
    fileName: "studio-thema.zip",
    sizeBytes: 4096,
  });
});

// ---------------------------------------------------------------------
// Bron-contract voor de server action (imports next/navigation via
// auth/server — laadt niet buiten een React-runtime; zelfde patroon als
// security-pricing.test.ts).
// ---------------------------------------------------------------------

const actionSource = readFileSync(path.join(root, "app/actions/websites.ts"), "utf8");
const downloadActionMatch = actionSource.match(
  /export async function createThemeZipDownloadUrlAction[\s\S]*?\n\}/
);
assert.ok(downloadActionMatch, "createThemeZipDownloadUrlAction moet bestaan");
const downloadAction = downloadActionMatch![0];

test("Download-action: owner-only en start géén generatie", async (t) => {
  await t.test("vereist requireStudioOwner", () => {
    assert.match(downloadAction, /await requireStudioOwner\(\)/);
  });
  await t.test("gebruikt uitsluitend de bestaande signed-URL-infrastructuur", () => {
    assert.match(downloadAction, /createArtifactSignedUrl\(artifactId\)/);
  });
  await t.test("start nooit een nieuwe website-/themegeneratie", () => {
    assert.ok(!/generateForWebsite|generateWebsite\(|generateWebsiteAction\(/.test(downloadAction));
  });
  await t.test("geen enkele gate-aanroep in de download-action", () => {
    assert.ok(!/assertProductionAuthorized\(/.test(downloadAction));
  });
});

test("Download-action: weigert artefacten zonder opgeslagen, gevalideerde ZIP", () => {
  assert.match(downloadAction, /artifact\.status !== "passed"/);
  assert.match(downloadAction, /!artifact\.storagePath \|\| !artifact\.storageBucket/);
});
