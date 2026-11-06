import { chromium } from "playwright";
import { join } from "node:path";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto("file://" + join(process.cwd(), "visual-output/w6c/html/over-ons.html"));
  const out = await p.evaluate(`(() => {
    const list = document.querySelector(".d3-horizontal_steps .d3-items");
    const items = Array.from(list.children);
    const info = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect();
      return { tag: el.tagName, h: Math.round(r.height), top: Math.round(r.top), sh: el.scrollHeight, ch: el.clientHeight,
        height: s.height, minHeight: s.minHeight, maxHeight: s.maxHeight, rows: s.gridTemplateRows, display: s.display, overflow: s.overflow, align: s.alignItems }; };
    return { list: info(list), items: items.map(info), inner: Array.from(items[0].children).map(info) };
  })()`);
  console.log(JSON.stringify(out, null, 2));
  await b.close();
})();
