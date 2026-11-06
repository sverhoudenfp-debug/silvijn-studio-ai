/**
 * VISUAL QC (W6, 6 november 2026).
 *
 * De bestaande kwaliteitscontrole keek naar structuur, contrast en tekstmaat.
 * Ze zag geen visuele fouten: overlappende titels, tekst die uit een container
 * loopt, lege secties of scheve kolomverhoudingen. Deze module opent de
 * gerenderde pagina in Chromium (Playwright) en meet die fouten in de echte
 * layout, op elke viewport.
 *
 * Uitgangspunten:
 * - Meten in de browser, niet in de markup: alleen de echte geometrie telt.
 * - Per pagina en per viewport, met selector en meetwaarden in het rapport.
 * - Alleen meetbare, reproduceerbare regels; een vision-LLM mag aanvullen,
 *   maar nooit het oordeel overnemen.
 */
import { chromium, type Browser } from "playwright";

export interface VisualQcViewport {
  name: string;
  width: number;
  height: number;
}

export const DEFAULT_VISUAL_VIEWPORTS: VisualQcViewport[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobiel", width: 390, height: 844 },
];

export type VisualIssueKind =
  | "overlap"
  | "overflow"
  | "clipped"
  | "empty_area"
  | "column_ratio"
  | "horizontal_scroll"
  | "hierarchy";

export interface VisualIssue {
  page: string;
  viewport: string;
  kind: VisualIssueKind;
  severity: "critical" | "warning";
  selector: string;
  detail: string;
}

export interface VisualPageReport {
  page: string;
  viewport: string;
  issues: VisualIssue[];
}

/** Meet de pagina in de browser. Retourneert ruwe issues (zonder page/viewport). */
const MEASURE_SCRIPT = `(() => {
  const issues = [];
  const textSelector = "h1,h2,h3,h4,p,li,a,figcaption,blockquote,dd,dt,button";
  const rectOf = (el) => el.getBoundingClientRect();
  // Zichtbaarheid moet de HELE keten bekijken: een dichte <details>, een
  // verborgen mobiel menu of een skip-link is zelf "groot", maar zijn inhoud
  // is niet in beeld. Zonder deze check levert de meting valse overlappen op.
  const visible = (el) => {
    if (el.closest(".skip-link, [aria-hidden='true'], template, noscript, details:not([open])")) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || parseFloat(style.opacity) === 0) return false;
    const r = rectOf(el);
    if (r.width <= 0 || r.height <= 0) return false;
    let node = el.parentElement;
    while (node && node !== document.body) {
      const parentStyle = getComputedStyle(node);
      if (parentStyle.display === "none" || parentStyle.visibility === "hidden" || parseFloat(parentStyle.opacity) === 0) return false;
      if (parentStyle.pointerEvents === "none" && parentStyle.position === "fixed") return false;
      const rp = node.getBoundingClientRect();
      if (rp.height <= 0 || rp.width <= 0) return false;
      node = node.parentElement;
    }
    return true;
  };
  const path = (el) => {
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      const cls = (node.className || "").toString().split(/\\s+/).filter(Boolean).slice(0, 2).join(".");
      parts.unshift(node.tagName.toLowerCase() + (cls ? "." + cls : ""));
      node = node.parentElement;
      depth += 1;
    }
    return parts.join(" > ");
  };

  const textEls = Array.from(document.querySelectorAll(textSelector)).filter(
    (el) => visible(el) && (el.textContent || "").trim().length > 2
  );

  // 1. Overlap tussen tekstblokken die niet in elkaar zitten.
  for (let i = 0; i < textEls.length; i += 1) {
    for (let j = i + 1; j < textEls.length; j += 1) {
      const a = textEls[i];
      const b = textEls[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = rectOf(a);
      const rb = rectOf(b);
      const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (overlapX <= 6 || overlapY <= 6) continue;
      const smaller = Math.min(ra.width * ra.height, rb.width * rb.height);
      if (smaller <= 0) continue;
      const ratio = (overlapX * overlapY) / smaller;
      if (ratio > 0.12) {
        issues.push({
          kind: "overlap",
          severity: "critical",
          selector: path(a) + " ⨯ " + path(b),
          detail: Math.round(ratio * 100) + "% overlap (" + Math.round(overlapX) + "×" + Math.round(overlapY) + "px)",
        });
      }
    }
  }

  // 2. Tekst die buiten de eigen sectie/container valt of afgekapt wordt.
  const containers = Array.from(document.querySelectorAll("section, main > div, .d3-section, .container"));
  for (const el of textEls) {
    const r = rectOf(el);
    const box = el.closest("section, .d3-section, .container") || document.body;
    const rb = rectOf(box);
    if (r.right > rb.right + 8 || r.left < rb.left - 8) {
      issues.push({
        kind: "overflow",
        severity: "critical",
        selector: path(el),
        detail: "valt " + Math.round(Math.max(r.right - rb.right, rb.left - r.left)) + "px buiten de container",
      });
    }
    if (el.scrollWidth > el.clientWidth + 4 || el.scrollHeight > el.clientHeight + 4) {
      const style = getComputedStyle(el);
      if (style.overflow !== "visible" || el.scrollWidth > el.clientWidth + 4) {
        issues.push({
          kind: "clipped",
          severity: "warning",
          selector: path(el),
          detail: "inhoud groter dan het element (" + el.scrollWidth + ">" + el.clientWidth + "px)",
        });
      }
    }
  }
  void containers;

  // 3. Lege secties: veel hoogte, weinig inhoud.
  for (const section of Array.from(document.querySelectorAll("main > section, main > .d3-section"))) {
    if (!visible(section)) continue;
    const box = rectOf(section);
    if (box.height < 320) continue;
    let contentTop = Infinity;
    let contentBottom = -Infinity;
    for (const child of Array.from(section.querySelectorAll("*"))) {
      if (!visible(child)) continue;
      if (!(child.textContent || "").trim() && child.tagName !== "IMG") continue;
      const rc = rectOf(child);
      contentTop = Math.min(contentTop, rc.top);
      contentBottom = Math.max(contentBottom, rc.bottom);
    }
    if (!isFinite(contentTop)) continue;
    const fill = (contentBottom - contentTop) / box.height;
    if (fill < 0.45) {
      issues.push({
        kind: "empty_area",
        severity: "warning",
        selector: path(section),
        detail: "inhoud vult " + Math.round(fill * 100) + "% van " + Math.round(box.height) + "px",
      });
    }
  }

  // 4. Scheve kolomverhoudingen in rasters met twee kolommen.
  for (const grid of Array.from(document.querySelectorAll("main *"))) {
    const style = getComputedStyle(grid);
    if (!style.display.includes("grid")) continue;
    const columns = style.gridTemplateColumns.split(" ").filter((value) => value && value !== "none");
    if (columns.length !== 2) continue;
    const children = Array.from(grid.children).filter(visible);
    if (children.length !== 2) continue;
    const widths = children.map((child) => rectOf(child).width).sort((x, y) => x - y);
    const [small, large] = widths;
    if (small <= 0 || large <= 0) continue;
    if (small < 240 && large / small > 2.4) {
      issues.push({
        kind: "column_ratio",
        severity: "warning",
        selector: path(grid),
        detail: Math.round(small) + "px naast " + Math.round(large) + "px",
      });
    }
  }

  // 5. Horizontaal scrollen (mobile-first fout).
  if (document.documentElement.scrollWidth > window.innerWidth + 2) {
    issues.push({
      kind: "horizontal_scroll",
      severity: "critical",
      selector: "html",
      detail: document.documentElement.scrollWidth + "px breed in " + window.innerWidth + "px viewport",
    });
  }

  // 6. Hiërarchie: precies één H1, en koppen die niet groter worden naarmate ze dieper staan.
  const h1s = Array.from(document.querySelectorAll("h1")).filter(visible);
  if (h1s.length !== 1) {
    issues.push({
      kind: "hierarchy",
      severity: "critical",
      selector: "h1",
      detail: h1s.length + " H1-elementen",
    });
  }
  // Hiërarchie: een H3 mag nooit groter zijn dan de dichtstbijzijnde H1/H2
  // erboven. Een H2 ná een H3 is normale documentorde (nieuwe sectie), dus die
  // vergelijking slaan we over — anders meldt de meter ruis.
  const headings = Array.from(document.querySelectorAll("h1,h2,h3")).filter(visible);
  let sectionSize = Infinity;
  for (const heading of headings) {
    const size = parseFloat(getComputedStyle(heading).fontSize);
    if (heading.tagName === "H3") {
      if (size > sectionSize + 0.5) {
        issues.push({
          kind: "hierarchy",
          severity: "warning",
          selector: path(heading),
          detail: "H3 is groter (" + Math.round(size) + "px) dan de sectiekop (" + Math.round(sectionSize) + "px)",
        });
      }
      continue;
    }
    sectionSize = size;
  }

  // Dedupliceer identieke meldingen (dezelfde selector + soort).
  const seen = new Set();
  return issues.filter((issue) => {
    const key = issue.kind + "|" + issue.selector + "|" + issue.detail;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
})()`;

export async function runVisualQc(options: {
  pages: { slug: string; fileUrl: string }[];
  viewports?: VisualQcViewport[];
  browser?: Browser;
}): Promise<VisualPageReport[]> {
  const browser = options.browser ?? (await chromium.launch());
  const ownsBrowser = !options.browser;
  const viewports = options.viewports ?? DEFAULT_VISUAL_VIEWPORTS;
  const reports: VisualPageReport[] = [];

  try {
    for (const page of options.pages) {
      for (const viewport of viewports) {
        const tab = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
        try {
          await tab.goto(page.fileUrl);
          await tab.waitForTimeout(120);
          const raw = (await tab.evaluate(MEASURE_SCRIPT)) as Omit<VisualIssue, "page" | "viewport">[];
          reports.push({
            page: page.slug,
            viewport: viewport.name,
            issues: raw.map((issue) => ({ ...issue, page: page.slug, viewport: viewport.name })),
          });
        } finally {
          await tab.close();
        }
      }
    }
  } finally {
    if (ownsBrowser) await browser.close();
  }

  return reports;
}

/** Samenvatting: aantal kritieke en waarschuwende meldingen per pagina. */
export function summarizeVisualQc(reports: VisualPageReport[]): {
  critical: number;
  warnings: number;
  failedPages: string[];
} {
  const critical = reports.reduce(
    (total, report) => total + report.issues.filter((issue) => issue.severity === "critical").length,
    0
  );
  const warnings = reports.reduce(
    (total, report) => total + report.issues.filter((issue) => issue.severity === "warning").length,
    0
  );
  const failedPages = [
    ...new Set(
      reports
        .filter((report) => report.issues.some((issue) => issue.severity === "critical"))
        .map((report) => report.page)
    ),
  ];
  return { critical, warnings, failedPages };
}
