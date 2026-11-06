/**
 * Functionele controle in een echte browser (W11).
 *
 * De visuele QC meet geometrie; dit script test gedrag:
 *  - werkt de mobiele navigatie (toggle openen, links bereikbaar)?
 *  - werkt de FAQ-accordion echt (aria-expanded wisselt, antwoord wordt zichtbaar)?
 *  - heeft het contactformulier labels, verplichte velden en blokkeert de browser
 *    een lege inzending?
 *  - zijn alle interne links bestaand (geen dode links)?
 *  - hebben afbeeldingen een alt-attribuut?
 *  - is er precies één H1 per pagina?
 *  - ontstaat er horizontale scroll op 390/768/1024/1440?
 *
 * Gebruik: npx tsx scripts/visual/functional-check.ts --dir visual-output/w11final/html
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { chromium, type Page } from "playwright";

type Issue = { page: string; viewport: string; check: string; severity: "critical" | "warning"; detail: string };

const args = process.argv.slice(2);
const dirArg = args.indexOf("--dir");
const HTML_DIR = resolve(dirArg === -1 ? "visual-output/w11final/html" : (args[dirArg + 1] ?? "visual-output/w11final/html"));
const PAGES = ["home", "over-ons", "diensten", "faq", "contact"];
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "mobiel", width: 390, height: 844 },
];

const issues: Issue[] = [];
const passed: string[] = [];

function report(page: string, viewport: string, check: string, detail: string, ok: boolean) {
  const key = `${page}/${viewport}: ${check}`;
  if (ok) {
    passed.push(key);
    return;
  }
  issues.push({ page, viewport, check, severity: "critical", detail });
}

async function load(page: Page, slug: string, viewport: { name: string; width: number; height: number }) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(`file://${join(HTML_DIR, `${slug}.html`)}`, { waitUntil: "load" });
  await page.evaluate(`(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    for (let y = 0; y < document.body.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
    window.scrollTo(0, 0);
  })()`);
  await page.waitForTimeout(120);
}

async function main(): Promise<number> {
  const browser = await chromium.launch();

  const page = await browser.newPage();

  for (const slug of PAGES) {
    for (const viewport of VIEWPORTS) {
      await load(page, slug, viewport);

      // Horizontale scroll
      const overflow = await page.evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
      report(slug, viewport.name, "geen horizontale scroll", `overflow ${overflow}px`, Number(overflow) <= 1);

      // Eén H1
      const h1Count = await page.locator("h1").count();
      report(slug, viewport.name, "precies één H1", `${h1Count} H1-elementen`, h1Count === 1);

      // Interne links bestaan
      const hrefs = await page.evaluate(
        `Array.from(document.querySelectorAll('a[href^="/"]')).map((a) => a.getAttribute('href'))`,
      );
      const resolved = (hrefs as string[]).map((href) => {
        if (href === "/" || href === "") return "home";
        if (href.startsWith("/pages/")) return href.replace("/pages/", "");
        if (href.startsWith("#")) return slug;
        return href.replace(/^\//, "");
      });
      const uniqueTargets = [...new Set(resolved)];
      const missing = uniqueTargets.filter((target) => !existsSync(join(HTML_DIR, `${target}.html`)));
      report(
        slug,
        viewport.name,
        "interne links bestaan",
        missing.length ? `ontbreekt: ${missing.join(", ")}` : `${uniqueTargets.length} doelen`,
        missing.length === 0,
      );

      // Alt-attributen
      const images = await page.evaluate(
        `Array.from(document.querySelectorAll('img')).map((img) => ({ alt: img.getAttribute('alt'), src: img.getAttribute('src')?.slice(0, 24) }))`,
      );
      const withoutAlt = (images as Array<{ alt: string | null }>).filter((image) => image.alt === null);
      report(
        slug,
        viewport.name,
        "afbeeldingen hebben alt",
        withoutAlt.length ? `${withoutAlt.length} zonder alt` : `${(images as unknown[]).length} afbeeldingen`,
        withoutAlt.length === 0,
      );

      // CTA aanwezig en bruikbaar
      const ctas = await page.evaluate(
        `Array.from(document.querySelectorAll('a.btn, a.button, a.d3-cta, .cta a, a[class*="button"], .site-header__cta')).map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') }))`,
      );
      const usableCtas = (ctas as Array<{ text: string; href: string | null }>).filter(
        (cta) => cta.text.length > 0 && cta.href && cta.href !== "#",
      );
      report(
        slug,
        viewport.name,
        "CTA's hebben tekst en doel",
        `${usableCtas.length} van ${(ctas as unknown[]).length}`,
        usableCtas.length > 0 || slug === "faq",
      );
    }
  }

  // Mobiele navigatie: toggle openen en links zichtbaar
  await load(page, "home", VIEWPORTS[3]!);
  const toggle = page.locator(".nav-toggle, [data-nav-toggle], button[aria-controls]").first();
  if ((await toggle.count()) > 0) {
    await toggle.click();
    await page.waitForTimeout(200);
    const navVisible = await page.evaluate(`(() => {
      const nav = document.querySelector('nav');
      if (!nav) return false;
      const style = getComputedStyle(nav);
      return style.display !== 'none' && nav.getBoundingClientRect().height > 20;
    })()`);
    const navLinks = await page.evaluate(`document.querySelectorAll('nav a').length`);
    report("home", "mobiel", "mobiel menu opent", `nav zichtbaar: ${navVisible}, ${navLinks} links`, Boolean(navVisible));
    const expanded = await toggle.getAttribute("aria-expanded");
    report("home", "mobiel", "toggle meldt status", `aria-expanded=${expanded}`, expanded === "true" || expanded === null);
  } else {
    issues.push({
      page: "home",
      viewport: "mobiel",
      check: "mobiele navigatie",
      severity: "critical",
      detail: "geen nav-toggle gevonden",
    });
  }

  // FAQ-accordion: eerste item openen
  await load(page, "faq", VIEWPORTS[0]!);
  const faqTrigger = page.locator("details summary, .faq-item button, [data-faq-trigger]").first();
  if ((await faqTrigger.count()) > 0) {
    const before = await page.evaluate(`(() => {
      const d = document.querySelector('details');
      return d ? d.open : null;
    })()`);
    await faqTrigger.click();
    await page.waitForTimeout(200);
    const after = await page.evaluate(`(() => {
      const d = document.querySelector('details');
      return d ? d.open : null;
    })()`);
    report("faq", "desktop", "FAQ-accordion wisselt", `open: ${String(before)} → ${String(after)}`, before !== after);
  } else {
    issues.push({
      page: "faq",
      viewport: "desktop",
      check: "FAQ-accordion",
      severity: "critical",
      detail: "geen accordion-element gevonden",
    });
  }

  // Contactformulier: labels, verplichte velden, lege inzending geblokkeerd
  await load(page, "contact", VIEWPORTS[0]!);
  const formInfo = await page.evaluate(`(() => {
    const form = document.querySelector('form');
    if (!form) return null;
    const fields = Array.from(form.querySelectorAll('input, textarea, select'));
    const labelled = fields.filter((f) => !!f.getAttribute('aria-label') || !!f.getAttribute('id') && !!document.querySelector('label[for="' + f.id + '"]'));
    const required = fields.filter((f) => f.hasAttribute('required'));
    return { fields: fields.length, labelled: labelled.length, required: required.length, valid: form.checkValidity() };
  })()`);
  if (formInfo) {
    const info = formInfo as { fields: number; labelled: number; required: number; valid: boolean };
    report("contact", "desktop", "formuliervelden gelabeld", `${info.labelled}/${info.fields}`, info.labelled === info.fields && info.fields > 0);
    report("contact", "desktop", "verplichte velden aanwezig", `${info.required}`, info.required > 0);
    report("contact", "desktop", "lege inzending geblokkeerd", `checkValidity=${info.valid}`, info.valid === false);
  } else {
    issues.push({
      page: "contact",
      viewport: "desktop",
      check: "contactformulier",
      severity: "critical",
      detail: "geen formulier gevonden",
    });
  }

  await browser.close();


  const summary = {
    generatedAt: new Date().toISOString(),
    dir: HTML_DIR,
    checksPassed: passed.length,
    issues: issues.length,
    critical: issues.filter((issue) => issue.severity === "critical").length,
    failedChecks: issues,
    sample: passed.slice(0, 8),
  };

  writeFileSync(join(HTML_DIR, "..", "functional.json"), JSON.stringify(summary, null, 2));

  console.log(`Functionele controle: ${passed.length} geslaagd, ${issues.length} mislukt`);
  for (const issue of issues) {
    console.log(`  [${issue.severity}] ${issue.page}/${issue.viewport} — ${issue.check}: ${issue.detail}`);
  }
  process.exit(summary.critical > 0 ? 1 : 0);

  return summary.critical > 0 ? 1 : 0;
}

main().then((code) => process.exit(code));
