/**
 * W4-MEETLAT (5 november 2026): geometrie van de compositie.
 *
 * De visuele score zegt iets over contrast en maat, maar niet over de vraag
 * "voelt dit als maatwerk?". Deze probe meet de dingen die een ontwerper
 * beoordeelt: hoeveel regels een kop heeft, hoeveel tekens er per regel staan,
 * hoe tekst en beeld zich verhouden, of de merknaam op mobiel op één regel
 * past en of het sectieritme varieert.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

// Label meegeven: `tsx scripts/visual/probe-layout.ts --label w4a`
const labelIndex = process.argv.indexOf("--label");
const LABEL = labelIndex > -1 ? process.argv[labelIndex + 1] : "w4a";
const HTML_DIR = join(process.cwd(), `visual-output/${LABEL}/html`);
const PAGES = ["home", "over-ons", "diensten", "faq", "contact"];
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobiel", width: 390, height: 844 },
];

interface Probe {
  page: string;
  viewport: string;
  h1: { size: number; lines: number; charsPerLine: number; widthRatio: number };
  hero: { text: number; media: number; mediaShare: number } | null;
  header: { brandLines: number; brandWidth: number; cta: number; height: number };
  sections: { count: number; heights: number[] };
}

async function main() {
const browser = await chromium.launch();

async function probe(pageSlug: string, viewport: { name: string; width: number; height: number }): Promise<Probe> {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  await page.goto("file://" + join(HTML_DIR, `${pageSlug}.html`));
  await page.waitForTimeout(120);
  const metrics = await page.evaluate(() => {
    const h1 = document.querySelector("h1") as HTMLElement | null;
    const heroContent = document.querySelector(".hero__content") as HTMLElement | null;
    const heroMedia = (document.querySelector(".hero__media, .hero__band") as HTMLElement | null) ?? null;
    const brand = document.querySelector(".site-header__brand") as HTMLElement | null;
    const cta = document.querySelector(".site-header__cta") as HTMLElement | null;
    const header = document.querySelector(".site-header__inner") as HTMLElement | null;
    const sections = Array.from(document.querySelectorAll("main#main-content > section, main#main-content > .d3-section")) as HTMLElement[];

    const result: Record<string, unknown> = {};
    if (h1) {
      const style = getComputedStyle(h1);
      const lineHeight = parseFloat(style.lineHeight);
      const box = h1.getBoundingClientRect();
      const text = (h1.textContent ?? "").trim().replace(/\s+/g, " ");
      const lines = Math.max(1, Math.round(box.height / Math.max(1, lineHeight)));
      result.h1 = {
        size: parseFloat(style.fontSize),
        lines,
        charsPerLine: Math.round(text.length / lines),
        widthRatio: Number((box.width / window.innerWidth).toFixed(2)),
      };
    }
    if (heroContent && h1) {
      const contentBox = heroContent.getBoundingClientRect();
      const mediaBox = heroMedia?.getBoundingClientRect();
      const total = (mediaBox?.width ?? 0) + contentBox.width;
      result.hero = {
        text: Math.round(contentBox.width),
        media: Math.round(mediaBox?.width ?? 0),
        mediaShare: total > 0 ? Number((((mediaBox?.width ?? 0) / total) * 100).toFixed(0)) : 0,
      };
    } else {
      result.hero = { text: 0, media: 0, mediaShare: 0 };
    }
    if (brand) {
      const style = getComputedStyle(brand);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize);
      const brandBox = brand.getBoundingClientRect();
      result.header = {
        brandLines: Math.max(1, Math.round(brandBox.height / lineHeight)),
        brandWidth: Math.round(brandBox.width),
        cta: Math.round(cta?.getBoundingClientRect().width ?? 0),
        height: Math.round(header?.getBoundingClientRect().height ?? 0),
      };
    }
    result.sections = {
      count: sections.length,
      heights: sections.map((section) => Math.round(section.getBoundingClientRect().height)),
    };
    return result;
  });
  await page.close();
  return {
    page: pageSlug,
    viewport: viewport.name,
    ...(metrics as Omit<Probe, "page" | "viewport">),
  };
}

const rows: Probe[] = [];
for (const page of PAGES) {
  for (const viewport of VIEWPORTS) {
    rows.push(await probe(page, viewport));
  }
}
await browser.close();

const header = "| pagina | viewport | H1 | regels | tekens/regel | H1-breedte | tekst/beeld | beeld-aandeel | merklijnen | CTA | headerhoogte |";
const divider = "|---|---|---|---|---|---|---|---|---|---|---|";
console.log(header);
console.log(divider);
for (const row of rows) {
  console.log(
    `| ${row.page} | ${row.viewport} | ${row.h1.size}px | ${row.h1.lines} | ${row.h1.charsPerLine} | ${Math.round(row.h1.widthRatio * 100)}% | ${row.hero?.text ?? 0}/${row.hero?.media ?? 0} | ${row.hero?.mediaShare ?? 0}% | ${row.header.brandLines} | ${row.header.cta}px | ${row.header.height}px |`
  );
}

const sectionVariety = rows
  .filter((row) => row.viewport === "desktop")
  .map((row) => {
    const heights = row.sections.heights.filter((value) => value > 40);
    const unique = new Set(heights.map((value) => Math.round(value / 40))).size;
    return `| ${row.page} | ${row.sections.count} | ${unique} | ${heights.join(", ")} |`;
  });
console.log("\n## Sectieritme (desktop)\n\n| pagina | secties | unieke hoogteklassen | hoogtes |\n|---|---|---|---|");
console.log(sectionVariety.join("\n"));

const text = readFileSync(join(HTML_DIR, "home.html"), "utf8");
const missing = ["vandijk", "Van Dijk"].filter((needle) => text.includes(needle));
console.log(`\nIdentiteitscheck home.html: ${missing.length === 0 ? "schoon" : "LEK: " + missing.join(", ")}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
