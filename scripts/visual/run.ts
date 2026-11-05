import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { chromium } from "playwright";
import axe from "axe-core";
import { buildShopifyTheme, type ThemeImage } from "../../lib/websites/theme-zip/theme-builder";
import { goldenContentPlan } from "../../tests/fixtures/golden-content";
import { veldEnVormBrief } from "./veld-en-vorm-brief";
import { findIdentityLeaks } from "../../lib/websites/identity-isolation";
import { renderThemePageHtml } from "../../lib/websites/theme-zip/html-preview";
import {
  GOLDEN_PAGES,
  goldenContact,
  goldenDesignPlan,
  goldenSpecification,
} from "../../tests/fixtures/golden-hovenier";
import type { DesignPlan } from "../../lib/websites/design-plan";
import type { ContentPlan } from "../../lib/websites/content/content-plan";

/**
 * Bron van de meting:
 *  - golden (standaard): de bevroren hovenierscase uit fase 0.
 *  - veld: de ECHTE AI-uitkomst van scripts/visual/veld-gen.ts
 *    (specificatie + design plan + contentplan van Veld & Vorm).
 */
const sourceIndex = process.argv.indexOf("--source");
const source = sourceIndex >= 0 ? (process.argv[sourceIndex + 1] ?? "golden") : "golden";
const VELD_DIR = join(process.cwd(), "visual-output", "veld-en-vorm", "plans");

function loadVeldPlans() {
  const read = (name: string) => JSON.parse(readFileSync(join(VELD_DIR, name), "utf8"));
  const designPlan = read("design-plan.json") as DesignPlan;
  const blueprint = designPlan.blueprint;
  if (!blueprint) throw new Error("Design plan zonder blueprint");
  const pages = blueprint.pages.map((page) => ({
    template: page.key === "home" ? "index" : `page.${page.key}`,
    slug: page.key,
  }));
  return {
    specification: read("specification.json"),
    designPlan,
    contentPlan: read("content-plan.json") as ContentPlan,
    pages,
  };
}

/**
 * VISUELE MEETLAT (fase 0, 2026-11-05) — één commando, één cijfer.
 *
 * Bouwt de bevroren hovenierscase met de ECHTE engine, schiet screenshots op
 * desktop en mobiel, meet tien ontwerpcriteria in de browser en telt de
 * WCAG-contrastfouten met axe-core. Dezelfde input moet altijd dezelfde
 * output geven; alleen de engine mag het verschil maken.
 *
 * Gebruik: npm run visual -- --label fase1
 * Output: visual-output/<label>/{theme,html,shots,score.json,score.md}
 */

const label = (() => {
  const i = process.argv.indexOf("--label");
  return i >= 0 ? (process.argv[i + 1] ?? "run") : "run";
})();

const OUT = join(process.cwd(), "visual-output", label);
const HTML_DIR = join(OUT, "html");
const THEME_DIR = join(OUT, "theme");
const SHOT_DIR = join(OUT, "shots");

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobiel", width: 390, height: 844 },
] as const;

async function main() {
/** Inhoudelijk identiek aan de nulmeting: alleen de engine verandert. */
/**
 * Beelden: alleen als ze écht in visual-output/images staan (CC0, opgehaald
 * met scripts/media/fetch-cc0.ts). Zonder bestanden blijft het placeholder-pad
 * exact zoals in de nulmeting.
 */
function loadImages(): ThemeImage[] {
  const dir = join(process.cwd(), "visual-output/images");
  const metaPath = join(dir, "meta.json");
  if (!existsSync(metaPath)) return [];
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, { file: string; width: number; height: number; license?: string; title?: string | null; landing?: string | null }>;
  const images: ThemeImage[] = [];
  const slotsByKey = ["hero", "about", "services_1", "services_2", "services_3", "services_4", "gallery_1", "gallery_2"];
  for (const key of slotsByKey) {
    const entry = meta[key];
    if (!entry) continue;
    const file = join(dir, entry.file);
    if (!existsSync(file)) continue;
    const slot = key.startsWith("services") ? "services" : key.startsWith("gallery") ? "gallery" : (key as "hero" | "about");
    images.push({
      slot,
      file: entry.file,
      bytes: readFileSync(file),
      width: entry.width,
      height: entry.height,
      alt: entry.title ?? null,
      license: {
        provider: "Openverse (CC0)",
        licenseName: entry.license === "cc0" ? "CC0 1.0" : String(entry.license ?? "CC0 1.0"),
        commercialUse: true,
        attributionText: null,
        evidenceUrl: entry.landing ?? "https://docs.openverse.org/",
      },
    });
  }
  return images;
}

const veld = source === "veld" ? loadVeldPlans() : null;
// W4-DATALEK (2026-11-05): hier stond `contact: goldenContact` voor ELKE bron.
// Daardoor droeg de Veld & Vorm-site het e-mailadres van de oude testcase
// Van Dijk Hoveniers. Contact hoort per case te komen, nooit uit een andere.
const contact = veld
  ? {
      phone: veldEnVormBrief.phone,
      email: veldEnVormBrief.email,
      address: null,
      city: veldEnVormBrief.city,
      province: veldEnVormBrief.province,
    }
  : goldenContact;
const built = buildShopifyTheme({
  specification: (veld ? veld.specification : goldenSpecification) as never,
  designPlan: veld ? veld.designPlan : goldenDesignPlan,
  contact,
  images: loadImages(),
  // W2: de contentpass levert de teksten; zonder plan valt de compositie
  // terug op de (dunne) specificatie.
  contentPlan: veld ? veld.contentPlan : goldenContentPlan,
});

// W4: dezelfde identiteitspoort als productie, nu op het harnas zelf. Zo kan
// een meetcase nooit stilletjes andermans contactgegevens meedragen.
const identity = {
  businessName: (veld ? veld.specification.business.businessName : goldenSpecification.business.businessName) as string,
  email: contact.email,
  phone: contact.phone,
  website: null,
  city: contact.city,
};
const leaks = built.files.flatMap((file) => {
  const content = file.content ?? file.bytes?.toString() ?? "";
  if (!content || file.path.startsWith("assets/")) return [];
  return findIdentityLeaks(content, identity, file.path);
});
if (leaks.length > 0) {
  for (const leak of leaks.slice(0, 10)) {
    console.error(`   ✗ identiteitslek in ${leak.location}: ${leak.kind} "${leak.value}"`);
  }
  throw new Error(`Identiteitsisolatie faalde: ${leaks.length} vreemde gegevens in de output`);
}

// W3-LES (2026-11-05): nooit de hele outputmap wissen. De gegenereerde
// plannen (visual-output/<case>/plans) staan naast de meting en zijn betaald
// AI-werk; een rmSync op OUT gooide ze weg. Alleen de meetartefacten zelf
// worden opgeruimd.
for (const dir of [THEME_DIR, HTML_DIR, SHOT_DIR]) rmSync(dir, { recursive: true, force: true });
for (const file of built.files) {
  const target = join(THEME_DIR, file.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.bytes?.length ? file.bytes : file.content);
}
mkdirSync(HTML_DIR, { recursive: true });

const pages: Array<{ slug: string; file: string; bytes: number }> = [];
for (const page of veld ? veld.pages : GOLDEN_PAGES) {
  const rendered = await renderThemePageHtml(built.files, {
    template: page.template as never,
  });
  const file = join(HTML_DIR, `${page.slug}.html`);
  writeFileSync(file, rendered.html);
  pages.push({ slug: page.slug, file, bytes: rendered.html.length });
}

type Metrics = {
  viewport: string;
  pageSlug: string;
  h1: number;
  h1MobileSafe: boolean;
  h2: number;
  typeRange: number;
  words: number;
  sections: number;
  distinctLayouts: number;
  sectionHeightVariation: number;
  pageScreens: number;
  measureChars: number;
  measureOutOfRange: number;
  measureSamples: number;
  imageAreaPct: number;
  realImages: number;
  placeholders: number;
  colorCount: number;
  contrastViolations: number;
  contrastNodes: string[];
};

/**
 * De meting draait IN de browser. Als string doorgegeven: esbuild voorziet
 * functies van een __name-helper die in de browsercontext niet bestaat, en
 * een string wordt niet getransformeerd.
 */
const MEASURE_SCRIPT = `(() => {
  const px = (v) => Number.parseFloat(v) || 0;
  const cs = (el) => getComputedStyle(el);
  const pageHeight = document.documentElement.scrollHeight;
  const vw = window.innerWidth;
  const h1 = document.querySelector("h1");
  const h2s = [...document.querySelectorAll("h2")];
  const paras = [...document.querySelectorAll("p")].filter((p) => p.innerText.trim().length >= 60);
  // Regellengte in tekens: kolombreedte / (fontgrootte x 0,5), de
  // standaardbenadering van de ch-maat. Onafhankelijk van de tekstlengte,
  // dus ook bruikbaar bij korte alinea's (waar 'tekens per regel' uit
  // tekstlengte/regels onbetrouwbaar is).
  const measureChars = paras.map((p) => {
    const width = p.getBoundingClientRect().width;
    const size = px(cs(p).fontSize) || 16;
    return Math.round(width / (size * 0.5));
  });
  const sections = [...document.querySelectorAll("section")];
  const heights = sections.map((s) => Math.round(s.getBoundingClientRect().height));
  const mean = heights.reduce((a, c) => a + c, 0) / (heights.length || 1);
  const sd = Math.sqrt(heights.reduce((a, c) => a + (c - mean) ** 2, 0) / (heights.length || 1));
  const images = [...document.images];
  const real = images.filter((i) => i.naturalWidth > 0 && !i.src.startsWith("data:image/svg"));
  const placeholders = images.filter((i) => i.src.startsWith("data:image/svg") || /placeholder/.test(i.src));
  const imageArea = real.reduce((a, i) => a + i.getBoundingClientRect().width * i.getBoundingClientRect().height, 0);
  const textEls = [...document.querySelectorAll("h1,h2,h3,p,li,a,span")].filter((e) => e.innerText.trim());
  const sizes = textEls.map((e) => px(cs(e).fontSize));
  const layouts = sections.map((s) => [...s.classList].filter((c) => !/^(section|motion)/.test(c)).join("."));
  const h1Px = h1 ? Math.round(px(cs(h1).fontSize) * 10) / 10 : 0;
  return {
    viewport: vw + "px",
    h1: h1Px,
    h1MobileSafe: vw > 500 ? true : h1Px <= 46,
    h2: h2s.length ? Math.round(Math.max(...h2s.map((h) => px(cs(h).fontSize))) * 10) / 10 : 0,
    typeRange: sizes.length ? Math.round((Math.max(...sizes) / Math.min(...sizes)) * 10) / 10 : 0,
    // textContent i.p.v. innerText: FAQ-antwoorden in dichte accordeons tellen
    // mee — anders lijkt een gevulde FAQ leeg in de meetlat.
    words: (document.body.textContent ?? '').trim().split(/\\s+/).filter(Boolean).length,
    sections: sections.length,
    distinctLayouts: new Set(layouts).size,
    sectionHeightVariation: Math.round(sd),
    pageScreens: Math.round((pageHeight / 900) * 10) / 10,
    measureChars: measureChars.length ? Math.round(measureChars.reduce((a, c) => a + c, 0) / measureChars.length) : 0,
    measureOutOfRange: measureChars.filter((m) => m < (vw < 600 ? 25 : 40) || m > (vw < 600 ? 50 : 90)).length,
    measureSamples: measureChars.length,
    imageAreaPct: Math.round((imageArea / (vw * pageHeight)) * 100),
    realImages: real.length,
    placeholders: placeholders.length,
    colorCount: new Set(textEls.map((e) => cs(e).color)).size,
    contrastViolations: 0,
    contrastNodes: [],
  };
})()`;

const browser = await chromium.launch();
const results: Metrics[] = [];

for (const viewport of VIEWPORTS) {
  for (const page of pages) {
    const tab = await browser.newPage({ viewport });
    await tab.goto("file://" + page.file);
    await tab.waitForTimeout(300);

    const metrics = (await tab.evaluate(MEASURE_SCRIPT)) as Metrics;
    metrics.contrastNodes = [];

    // Contrast meten met de echte axe-core-regel (WCAG AA, kleine tekst).
    if (viewport.name === "desktop") {
      await tab.addScriptTag({ content: axe.source });
      const axeResult = await tab.evaluate(async () => {
        const res = await (window as unknown as {
          axe: { run: (o: unknown) => Promise<{ violations: Array<{ id: string; nodes: Array<{ target: string[]; html: string; failureSummary?: string }> }> }> };
        }).axe.run({ runOnly: { type: "tag", values: ["wcag2aa"] } });
        const color = res.violations.find((v) => v.id === "color-contrast");
        return color ? color.nodes.map((n) => `${n.target.join(" ")} :: ${n.failureSummary ?? ""}`) : [];
      });
      metrics.contrastViolations = axeResult.length;
      metrics.contrastNodes = axeResult.slice(0, 12);
    }

    results.push({ ...metrics, pageSlug: page.slug, viewport: `${viewport.name} ${viewport.width}` });

    mkdirSync(SHOT_DIR, { recursive: true });
    await tab.screenshot({
      path: join(SHOT_DIR, `${page.slug}-${viewport.name}.png`),
      fullPage: true,
    });
    await tab.close();
  }
}
await browser.close();

writeFileSync(join(OUT, "score.json"), JSON.stringify({ label, pages, results }, null, 2));

const desktop = results.find((r) => r.viewport.startsWith("desktop") && r.pageSlug === "home")!;
const mobile = results.find((r) => r.viewport.startsWith("mobiel") && r.pageSlug === "home")!;

const md = [
  `# Visuele score — ${label}`,
  "",
  `Bestanden: ${built.files.length} · HTML: ${pages.map((p) => `${p.slug} ${p.bytes}B`).join(", ")}`,
  "",
  "| criterium | desktop | mobiel |",
  "|---|---|---|",
  `| H1 | ${desktop.h1}px | ${mobile.h1}px |`,
  `| H1 mobiel veilig (≤46px) | ${desktop.h1MobileSafe} | ${mobile.h1MobileSafe} |`,
  `| grootste H2 | ${desktop.h2}px | ${mobile.h2}px |`,
  `| typebereik | ${desktop.typeRange}× | ${mobile.typeRange}× |`,
  `| woorden | ${desktop.words} | ${mobile.words} |`,
  `| secties / layouts | ${desktop.sections} / ${desktop.distinctLayouts} | ${mobile.sections} / ${mobile.distinctLayouts} |`,
  `| sectiehoogte-variatie | ${desktop.sectionHeightVariation} | ${mobile.sectionHeightVariation} |`,
  `| paginahoogte (schermen) | ${desktop.pageScreens} | ${mobile.pageScreens} |`,
  `| regellengte (tekens, ${desktop.measureSamples} paragrafen) | ${desktop.measureChars} | ${mobile.measureChars} |`,
  `| regellengte buiten bandbreedte | ${desktop.measureOutOfRange} | ${mobile.measureOutOfRange} |`,
  `| beeldarea | ${desktop.imageAreaPct}% | ${mobile.imageAreaPct}% |`,
  `| echte beelden / placeholders | ${desktop.realImages} / ${desktop.placeholders} | ${mobile.realImages} / ${mobile.placeholders} |`,
  `| tekstkleuren | ${desktop.colorCount} | ${mobile.colorCount} |`,
  `| contrastfouten (axe, home) | ${desktop.contrastViolations} | - |`,
  "",
  "## Per pagina (desktop)",
  "",
  "| pagina | secties | H1 | woorden | regellengte | beeldarea | contrastfouten |",
  "|---|---|---|---|---|---|---|",
  ...pages.map((page) => {
    const row = results.find((r) => r.viewport.startsWith("desktop") && r.pageSlug === page.slug);
    return row
      ? `| ${page.slug} | ${row.sections} | ${row.h1}px | ${row.words} | ${row.measureChars} | ${row.imageAreaPct}% | ${row.contrastViolations} |`
      : `| ${page.slug} | - | - | - | - | - | - |`;
  }),
  "",
  // W3-LES (2026-11-05): de samenvatting keek alleen naar de home-desktopmeting
  // en meldde "Geen" terwijl de per-paginatabel wél contrastfouten toonde.
  // Nu over alle pagina's en viewports, met herkomst erbij.
  ...(() => {
    const offenders = results.flatMap((r) =>
      r.contrastNodes.map((node) => `- ${r.pageSlug} (${r.viewport}): ${node.split("\n")[0] ?? node}`)
    );
    return ["## Contrastfouten", offenders.length ? `Totaal ${offenders.length}.` : "Geen.", ...offenders];
  })(),
  "",
].join("\n");

writeFileSync(join(OUT, "score.md"), md);
console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
