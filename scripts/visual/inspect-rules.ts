import { chromium } from "playwright";
import { join } from "node:path";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 768, height: 900 } });
  await p.goto("file://" + join(process.cwd(), "visual-output/w4a/html/home.html"));
  const out = await p.evaluate(() => {
    const h1 = document.querySelector("h1") as HTMLElement;
    const brand = document.querySelector(".site-header__brand") as HTMLElement;
    const rules: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules) as CSSStyleRule[]) {
        if (rule.selectorText && h1.matches(rule.selectorText) && rule.style.fontSize) rules.push(rule.selectorText + " => " + rule.style.fontSize);
      }
    }
    return {
      computed: getComputedStyle(h1).fontSize,
      rules,
      brandWhiteSpace: getComputedStyle(brand!).whiteSpace,
      brandFont: getComputedStyle(brand!).fontSize,
      bodyClass: document.body.className,
    };
  });
  console.log(JSON.stringify(out, null, 2));
  await b.close();
})();
