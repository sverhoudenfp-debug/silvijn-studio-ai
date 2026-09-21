/**
 * Regressietests — THEME CERTIFICATION (productie-preflight, 2026-09-21).
 *
 * Achtergrond: tien mislukte Shopify-imports leerden dat Shopify
 * structurele overtredingen (lege text-defaults, filters binnen
 * render-argumenten, ontbrekende locale-sleutels, dode nav-doelen)
 * STILLETJES laat vallen. De ZIP-generator certificeert zichzelf nu met
 * een volledige preflight vóór het artefact wordt opgeslagen, en QC
 * blokkeert READY_FOR_SILVIJN zonder gecertificeerd artefact.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  runDeterministicPreflight,
  runFullPreflight,
  certifyThemeFiles,
} from "../lib/websites/theme-zip/preflight";
import { selectDownloadableArtifact } from "../lib/websites/theme-zip/download";
import { getThemeZipArtifactRepository } from "../lib/websites/theme-zip/repository";
import type { ThemeZipArtifact } from "../lib/websites/theme-zip/repository";
import { builtTheme } from "./fixtures/theme";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function withFile(files: ReturnType<typeof builtTheme>, path: string, content: string) {
  return files.map((f) => (f.path === path ? { ...f, content } : f));
}

test("certification: de gegenereerde theme doorstaat de VOLLEDIGE preflight (extern Theme Check inbegrepen)", async () => {
  const result = await runFullPreflight(builtTheme(), { trustedClaims: [] });
  assert.ok(result.passed, `gegenereerde theme moet certificeren, critical: ${result.criticalErrors.join(" | ").slice(0, 400)}`);
  assert.equal(result.external?.ran ?? false, true, "extern Shopify Theme Check moet daadwerkelijk draaien");
  assert.equal(result.status, "THEME_CERTIFIED");
});

test("certification: v14-faalklasse lege text-default wordt gedetecteerd (schema_contract)", () => {
  const files = builtTheme();
  const cfg = files.find((f) => f.path === "config/settings_schema.json");
  assert.ok(cfg, "settings_schema bestaat");
  const mutated = withFile(
    files,
    "config/settings_schema.json",
    cfg!.content.replace(/("id": "brand_name",\s*"label": "[^"]*",\s*"default": )"[^"]*"/, '$1""')
  );
  assert.notEqual(
    mutated.find((f) => f.path === "config/settings_schema.json")!.content,
    cfg!.content,
    "mutatie moet aantoonbaar wijzigen"
  );
  const result = runDeterministicPreflight(mutated, { trustedClaims: [] });
  assert.equal(result.passed, false);
  assert.ok(
    result.criticalErrors.some((e) => e.includes("brand_name") && e.toLowerCase().includes("lege default")),
    `schema_contract moet de lege default benoemen: ${result.criticalErrors.join(" | ").slice(0, 300)}`
  );
});

test("certification: v14-faalklasse filter binnen render-argumenten wordt fail-loud gedetecteerd (render_args)", async () => {
  const files = builtTheme();
  const target = files.find((f) => f.path === "sections/services.liquid");
  assert.ok(target);
  assert.ok(target!.content.includes("{%- render 'section-background'"), "services gebruikt de section-background-snippet");
  const broken = withFile(
    files,
    "sections/services.liquid",
    target!.content.replace(
      "alt: section.settings.heading,",
      "alt: section.settings.heading | default: '',"
    )
  );
  assert.ok(
    broken.find((f) => f.path === "sections/services.liquid")!.content.includes("| default:"),
    "mutatie moet aantoonbaar wijzigen"
  );
  // Deterministische detectie
  const detected = runDeterministicPreflight(broken, { trustedClaims: [] });
  assert.equal(detected.passed, false);
  assert.ok(detected.criticalErrors.some((e) => e.includes("render")), "render-filter wordt benoemd");
  // Extern theme-check bevestigt de LiquidSyntaxError vóór reparatie
  const preExternal = await runFullPreflight(broken, { trustedClaims: [] });
  assert.equal(preExternal.passed, false);
  // Bewust géén automatische reparatie: het wijzigen van de filter-semantiek
  // is niet veilig te doen. De generator schrijft zelf al schone render-tags;
  // een overtreding hier is een generatorbug die fail-loud moet opvallen,
  // nooit een stil artefact.
  const certification = await certifyThemeFiles(broken, { trustedClaims: [] });
  assert.equal(certification.result.passed, false, "render-filter faalt de certificering");
  assert.equal(certification.repairs.length, 0, "geen onveilige automatische reparatie");
});

test("certification: dode nav-doelen (niet-bestaande pagina) worden gedetecteerd (nav_targets)", () => {
  const files = builtTheme();
  const group = files.find((f) => f.path === "sections/header-group.json");
  assert.ok(group, "header-group bestaat");
  const broken = withFile(
    files,
    "sections/header-group.json",
    group!.content.replace(/\/pages\/diensten/g, "/pages/bestaat-niet")
  );
  assert.ok(
    broken.find((f) => f.path === "sections/header-group.json")!.content.includes("/pages/bestaat-niet"),
    "mutatie moet aantoonbaar wijzigen"
  );
  const result = runDeterministicPreflight(broken, { trustedClaims: [] });
  assert.equal(result.passed, false);
  assert.ok(
    result.criticalErrors.some((e) => e.includes("bestaat-niet") && e.includes("zonder bijbehorend page-template")),
    `nav_targets moet het dode doel benoemen: ${result.criticalErrors.join(" | ").slice(0, 300)}`
  );
});

test("certification: ontbrekende locale-sleutel wordt gedetecteerd (locale_keys)", () => {
  const files = builtTheme();
  const locales = files.find((f) => f.path === "locales/nl.default.json");
  assert.ok(locales);
  // Verwijder een sleutel die secties actief gebruiken.
  const parsed = JSON.parse(locales!.content) as Record<string, { email?: string }>;
  const key = "newsletter";
  assert.ok(parsed[key], "newsletter-blok bestaat in de locale");
  delete parsed[key];
  const broken = withFile(files, "locales/nl.default.json", JSON.stringify(parsed, null, 2));
  const result = runDeterministicPreflight(broken, { trustedClaims: [] });
  assert.equal(result.passed, false);
  assert.ok(
    result.criticalErrors.some((e) => e.includes("newsletter.email")),
    `locale_keys moet de missende sleutel benoemen: ${result.criticalErrors.join(" | ").slice(0, 300)}`
  );
});

test("certification: certifyThemeFiles repareert een veilig herstelbaar theme tot certificering", async () => {
  const files = builtTheme();
  // Faalklasse "lege text-default": veilig deterministisch herstelbaar —
  // de lege default wordt verwijderd; de Liquid-fallback (| default/blank)
  // levert de waarde al correct, dus de semantiek verandert niet.
  const cfg = files.find((f) => f.path === "config/settings_schema.json");
  assert.ok(cfg, "settings_schema bestaat");
  const broken = withFile(
    files,
    "config/settings_schema.json",
    cfg!.content.replace(/("id": "brand_name",\s*"label": "[^"]*",\s*"default": )"[^"]*"/, '$1""')
  );
  assert.ok(broken.find((f) => f.path === "config/settings_schema.json")!.content.includes('"default": ""'), "mutatie moet aantoonbaar wijzigen");
  const certification = await certifyThemeFiles(broken, { trustedClaims: [] });
  assert.ok(certification.result.passed, `na reparatie certificeren: ${certification.result.criticalErrors.join(" | ").slice(0, 300)}`);
  assert.ok(certification.repairs.some((r) => r.id.includes("strip_empty_text_default")), "reparatie wordt gerapporteerd");
  const repairedCfg = certification.files.find((f) => f.path === "config/settings_schema.json")!;
  assert.ok(!repairedCfg.content.includes('"default": ""'), "de lege default is verdwenen");
});

test("certification: niet-herstelbaar thema faalt fail-loud (geen stil artefact)", async () => {
  const files = builtTheme();
  // Dode nav is deterministisch detecteerbaar maar niet veilig automatisch reparabel.
  const group = files.find((f) => f.path === "sections/header-group.json");
  assert.ok(group, "header-group bestaat");
  const broken = withFile(
    files,
    "sections/header-group.json",
    group!.content.replace(/\/pages\/diensten/g, "/pages/bestaat-niet")
  );
  assert.ok(
    broken.find((f) => f.path === "sections/header-group.json")!.content.includes("/pages/bestaat-niet"),
    "mutatie moet aantoonbaar wijzigen"
  );
  const certification = await certifyThemeFiles(broken, { trustedClaims: [] });
  assert.equal(certification.result.passed, false);
  assert.equal(certification.result.status, "THEME_PREFLIGHT_FAILED");
  assert.ok(certification.result.criticalErrors.length > 0);
});

test("certification: artefact-repository persisteert het preflight-rapport (duurzaam bewijs)", async () => {
  const repo = getThemeZipArtifactRepository();
  const files = builtTheme();
  const group = files.find((f) => f.path === "sections/header-group.json");
  assert.ok(group, "header-group bestaat");
  const broken = withFile(
    files,
    "sections/header-group.json",
    group!.content.replace(/\/pages\/diensten/g, "/pages/bestaat-niet")
  );
  assert.ok(
    broken.find((f) => f.path === "sections/header-group.json")!.content.includes("/pages/bestaat-niet"),
    "mutatie moet aantoonbaar wijzigen"
  );
  const certification = await certifyThemeFiles(broken, { trustedClaims: [] });

  const stored = await repo.create({
    websiteId: "website-cert-test",
    projectId: "project-cert-test",
    leadId: "lead-cert-test",
    version: 1,
    status: certification.result.passed ? "certified" : "preflight_failed",
    fileName: "test-theme-v1.zip",
    sizeBytes: 1234,
    fileCount: certification.result.fileCount,
    checksumSha256: "a".repeat(64),
    validationErrors: certification.result.criticalErrors,
    preflight: {
      status: certification.result.status,
      criticalErrors: certification.result.criticalErrors,
      warnings: certification.result.warnings,
      checks: certification.result.checks.map((c) => ({
        id: c.id,
        title: c.title,
        result: c.result,
        errors: c.errors,
        warnings: c.warnings,
      })),
      externalRan: certification.result.external?.ran ?? false,
      repairs: certification.repairs.map((r) => `${r.id}: ${r.description}`),
    },
  });
  assert.equal(stored.status, "preflight_failed");
  assert.ok(stored.preflight, "preflight-rapport is onderdeel van het artefact");
  assert.ok((stored.preflight?.checks.length ?? 0) > 5, "het rapport bevat de volledige checklist");
  const fetched = await repo.getById(stored.id);
  assert.ok(fetched?.preflight?.criticalErrors.length, "rapport overleeft de roundtrip");
});

const artifactFixture = (overrides: Partial<ThemeZipArtifact>): ThemeZipArtifact => ({
  id: "art-1",
  websiteId: "w1",
  projectId: "p1",
  leadId: "l1",
  version: 1,
  status: "certified",
  storageBucket: "theme-artifacts",
  storagePath: "p1/w1/theme-v1.zip",
  fileName: "theme-v1.zip",
  sizeBytes: 1000,
  fileCount: 60,
  checksumSha256: "a".repeat(64),
  validationErrors: [],
  preflight: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

test("certification: download selecteert certified artefacten", () => {
  const selected = selectDownloadableArtifact([
    artifactFixture({ id: "preflight-failed", status: "preflight_failed", version: 3 }),
    artifactFixture({ id: "certified-v2", status: "certified", version: 2 }),
  ]);
  assert.equal(selected?.id, "certified-v2", "certified wint van preflight_failed ondanks lagere versie");
});

test("certification: download accepteert legacy passed-artefacten (bewijsbehoud)", () => {
  const legacy = artifactFixture({ id: "legacy", status: "passed", version: 1 });
  const selected = selectDownloadableArtifact([legacy, artifactFixture({ id: "failed", status: "preflight_failed", version: 2 })]);
  assert.equal(selected?.id, "legacy");
});

test("certification: preflight_failed artefacten zijn nooit downloadbaar", () => {
  const selected = selectDownloadableArtifact([
    artifactFixture({ id: "pf1", status: "preflight_failed", storageBucket: "theme-artifacts", storagePath: "x" }),
  ]);
  assert.equal(selected, null);
});

test("certification: QC-gate blokkeert READY_FOR_SILVIJN zonder gecertificeerd artefact (broncontract)", () => {
  const qcSource = readFileSync(path.join(root, "lib/qc/service.ts"), "utf8");
  assert.ok(qcSource.includes("THEME_CERTIFICATION_REQUIRED"), "de gate rapporteert een deterministische regel-ID");
  assert.ok(
    qcSource.includes('certification?.certified ? "ready_for_silvijn" : "ready_for_qc"'),
    "pass zonder certificering blijft ready_for_qc"
  );
  assert.ok(qcSource.includes("checksum !== candidate.checksumSha256"), "de gate verifieert de checksum van de opgeslagen bytes");
  assert.ok(qcSource.includes("runFullPreflight"), "de gate draait de volledige preflight op de eindbytes");
});

test("certification: ZIP-service schrijft uitsluitend gecertificeerde bytes weg (broncontract)", () => {
  const serviceSource = readFileSync(path.join(root, "lib/websites/theme-zip/service.ts"), "utf8");
  assert.ok(serviceSource.includes("certifyThemeFiles(built.files"), "de ZIP wordt pas gebouwd na certificering");
  assert.ok(serviceSource.includes("createThemeZip(certification.files)"), "de ZIP-bytes komen uit de gecertificeerde bestanden");
  assert.ok(serviceSource.includes('status: "preflight_failed"'), "faalende preflight levert een fail-loud artefactstatus");
});

test("certification: migratie 0025 is additief (status-check + jsonb-kolom)", () => {
  const migration = readFileSync(path.join(root, "supabase/migrations/0025_theme_certification.sql"), "utf8");
  assert.ok(migration.includes("add column if not exists preflight jsonb"));
  assert.ok(migration.includes("'certified'"));
  assert.ok(migration.includes("'preflight_failed'"));
  assert.ok(!migration.includes("drop column"), "databehoudend: geen kolomverlies");
  assert.ok(migration.includes("'passed'"), "legacy-statussen blijven geldig");
});

test("certification: generateWebsite-flow accepteert een certified artefact (regressie v15-bug)", () => {
  const genSource = readFileSync(path.join(root, "lib/websites/service.ts"), "utf8");
  assert.ok(
    genSource.includes('zipArtifact.status === "certified" || zipArtifact.status === "passed"'),
    "de websiteflow moet certified (nieuwe code) én legacy passed accepteren als ZIP-succes"
  );
  assert.ok(
    !genSource.includes('zipArtifact.status !== "passed"'),
    "de oude !== passed-check markeerde een gecertificeerde ZIP ten onrechte als failed"
  );
  assert.ok(
    genSource.includes("preflight?.criticalErrors"),
    "een preflight_failed artefact moet zijn criticalErrors als foutdetails doorgeven"
  );
});
