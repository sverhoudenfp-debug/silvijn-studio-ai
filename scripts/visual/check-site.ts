import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

/**
 * STRUCTUURCONTROLE (W3, 2026-11-05)
 *
 * De meetlat beoordeelt ontwerp; dit script beoordeelt of de site als site
 * werkt: navigatie, interne links, koppenstructuur, contentweergave en of er
 * op mobiel niets buiten het scherm valt. Draait tegen de gerenderde HTML van
 * de echte AI-output.
 *
 * Gebruik: npx tsx scripts/visual/check-site.ts --dir visual-output/<case>/html
 */

const dirIndex = process.argv.indexOf("--dir");
const dir = dirIndex >= 0 ? process.argv[dirIndex + 1]! : "visual-output/veld-en-vorm/html";
const files = readdirSync(dir).filter((f) => f.endsWith(".html"));
const slugs = new Set(files.map((f) => f.replace(/\.html$/, "")));

type PageReport = {
  slug: string;
  title: string;
  h1Count: number;
  h1: string;
  headings: string[];
  navLinks: string[];
  internalLinks: string[];
  deadLinks: string[];
  emptySections: number;
  placeholderTexts: string[];
  paragraphs: number;
  words: number;
  overflowMobile: number;
  overflowDesktop: number;
  imageCount: number;
  imageWithoutAlt: number;
  formsWithLabels: string;
};

async function main() {
const browser = await chromium.launch();
const reports: PageReport[] = [];
const mobileIssues: string[] = [];

for (const file of files) {
  const slug = file.replace(/\.html$/, "");
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`file://${join(process.cwd(), dir, file)}`, { waitUntil: "load" });

  // esbuild voorziet functies van een __name-helper die in de browsercontext
  // niet bestaat; daarom als string doorgeven (zelfde les als run.ts).
  const data = (await page.evaluate(`(() => {
    const text = (el) => (el ? (el.textContent || "").replace(/\\s+/g, " ").trim() : "");
    const hrefs = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") || "");
    const nav = [...document.querySelectorAll("header a[href], nav a[href]")].map((a) => a.getAttribute("href") || "");
    const headings = [...document.querySelectorAll("h1,h2,h3")].map((h) => h.tagName + ":" + text(h));
    const sections = [...document.querySelectorAll("section, .section, [class*='section']")];
    const placeholderHit = [...document.querySelectorAll("body *")].map((el) => text(el))
      .filter((t) => /voorbeeldtekst|lorem ipsum|placeholder|\\[\\[|\\{\\{/i.test(t));
    const paras = [...document.querySelectorAll("p")].filter((p) => text(p).length >= 40);
    const visible = document.body.innerText.replace(/\\s+/g, " ");
    return {
      title: document.title,
      h1Count: document.querySelectorAll("h1").length,
      h1: text(document.querySelector("h1")),
      headings,
      nav,
      hrefs,
      emptySections: sections.filter((s) => text(s).length < 12).length,
      placeholderHit,
      paragraphs: paras.length,
      words: visible.trim() ? visible.trim().split(/\\s+/).length : 0,
      images: [...document.querySelectorAll("img")].map((i) => ({ src: i.getAttribute("src") || "", alt: i.getAttribute("alt") })),
      labelledInputs: [...document.querySelectorAll("input,textarea,select")].filter((el) => !!(el.getAttribute("aria-label") || document.querySelector('label[for="' + el.getAttribute("id") + '"]'))).length,
      inputs: document.querySelectorAll("input,textarea,select").length,
    };
  })()`)) as {
    title: string; h1: string; h1Count: number; headings: string[]; nav: string[]; hrefs: string[];
    emptySections: number; placeholderHit: string[]; paragraphs: number; words: number;
    images: { src: string; alt: string | null }[]; labelledInputs: number; inputs: number;
  };

  const internal = data.hrefs.filter((h) => h && !/^(https?:|mailto:|tel:|#)/.test(h));
  const dead = internal.filter((h) => {
    // Shopify-schema: /pages/<slug> hoort bij template page.<slug>.
    const clean = h.split("#")[0]!.replace(/^\/|\/$/g, "");
    if (!clean || clean === "") return false; // home
    const candidate = clean.replace(/^pages\//, "").replace(/\.html$/, "");
    return !slugs.has(candidate);
  });

  // Mobiel: alles breder dan het scherm is een layoutfout.
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(`file://${join(process.cwd(), dir, file)}`, { waitUntil: "load" });
  const overflowMobile = (await mobile.evaluate(`(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("body *")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > vw + 1.5;
    }).length;
  })()`)) as number;
  if (overflowMobile > 0) mobileIssues.push(`${slug}: ${overflowMobile} elementen buiten 390px`);

  const overflowDesktop = (await page.evaluate(`(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("body *")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > vw + 1.5;
    }).length;
  })()`)) as number;

  reports.push({
    slug,
    title: data.title,
    h1Count: data.h1Count,
    h1: data.h1,
    headings: data.headings,
    navLinks: [...new Set(data.nav)],
    internalLinks: [...new Set(internal)],
    deadLinks: [...new Set(dead)],
    emptySections: data.emptySections,
    placeholderTexts: data.placeholderHit.slice(0, 5),
    paragraphs: data.paragraphs,
    words: data.words,
    overflowMobile,
    overflowDesktop,
    imageCount: data.images.length,
    imageWithoutAlt: data.images.filter((i) => !i.alt).length,
    formsWithLabels: `${data.labelledInputs}/${data.inputs}`,
  });
  await page.close();
  await mobile.close();
  void errors;
}

await browser.close();

const problems: string[] = [];
for (const r of reports) {
  if (r.h1Count !== 1) problems.push(`${r.slug}: ${r.h1Count} H1's (verwacht 1)`);
  if (r.deadLinks.length) problems.push(`${r.slug}: dode interne links ${r.deadLinks.join(", ")}`);
  if (r.emptySections) problems.push(`${r.slug}: ${r.emptySections} lege secties`);
  if (r.placeholderTexts.length) problems.push(`${r.slug}: placeholdertekst "${r.placeholderTexts[0]}"`);
  if (r.overflowMobile > 0) problems.push(`${r.slug}: ${r.overflowMobile} elementen buiten het mobiele scherm`);
  if (r.imageCount && r.imageWithoutAlt) problems.push(`${r.slug}: ${r.imageWithoutAlt} afbeeldingen zonder alt`);
  if (r.paragraphs < 3) problems.push(`${r.slug}: ${r.paragraphs} echte alinea's (dun)`);
}

console.log(`\n# Structuurcontrole — ${reports.length} pagina's\n`);
for (const r of reports) {
  console.log(`## ${r.slug}`);
  console.log(`- titel: ${r.title}`);
  console.log(`- H1: ${r.h1} (aantal ${r.h1Count})`);
  console.log(`- koppen: ${r.headings.length}, alinea's: ${r.paragraphs}, woorden: ${r.words}`);
  console.log(`- navigatie: ${r.navLinks.join(" | ") || "(geen)"}`);
  console.log(`- interne links: ${r.internalLinks.join(" | ") || "(geen)"}`);
  console.log(`- beelden: ${r.imageCount} (zonder alt: ${r.imageWithoutAlt}), formulierlabels: ${r.formsWithLabels}`);
  console.log(`- buiten scherm: mobiel ${r.overflowMobile}, desktop ${r.overflowDesktop}`);
  if (r.emptySections) console.log(`- lege secties: ${r.emptySections}`);
}
console.log(`\n## Bevindingen`);
if (!problems.length) console.log("Geen structurele fouten.");
for (const p of problems) console.log(`- ${p}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
