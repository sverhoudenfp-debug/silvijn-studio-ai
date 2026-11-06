import { chromium } from "playwright";
import { join } from "node:path";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto("file://" + join(process.cwd(), "visual-output/w8c/html/home.html"));
  const out = await p.evaluate(`(() => {
    const el = document.querySelector(".usp-row");
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const rules = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let list; try { list = Array.from(sheet.cssRules); } catch (e) { continue; }
      for (const rule of list) {
        if (rule.cssRules) { for (const inner of Array.from(rule.cssRules)) { if (inner.selectorText && el.matches(inner.selectorText) && inner.style.gridTemplateColumns) rules.push(rule.conditionText + " | " + inner.selectorText + " => " + inner.style.gridTemplateColumns); } }
        else if (rule.selectorText && el.matches(rule.selectorText) && rule.style.gridTemplateColumns) rules.push(rule.selectorText + " => " + rule.style.gridTemplateColumns);
      }
    }
    return { width: Math.round(r.width), cols: s.gridTemplateColumns, display: s.display, rules };
  })()`);
  console.log(JSON.stringify(out, null, 2));
  await b.close();
})();
