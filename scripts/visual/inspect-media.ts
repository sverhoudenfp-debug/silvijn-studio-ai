import { chromium } from "playwright";
import { join } from "node:path";
(async () => {
  const b = await chromium.launch();
  for (const page of ["home","diensten"]) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } });
    await p.goto("file://" + join(process.cwd(), `visual-output/w9final/html/${page}.html`));
    await p.evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
    await p.waitForTimeout(600);
    const out = await p.evaluate(`(() => Array.from(document.querySelectorAll(".d3-item-media")).map((m) => {
      const img = m.querySelector("img");
      const r = m.getBoundingClientRect();
      return { alt: img ? img.alt : null, h: Math.round(r.height), w: Math.round(r.width),
        imgH: img ? Math.round(img.getBoundingClientRect().height) : 0,
        natural: img ? img.naturalWidth : 0, loading: img ? img.loading : null,
        display: getComputedStyle(m).display };
    }))()`);
    console.log(page, JSON.stringify(out));
    await p.close();
  }
  await b.close();
})();
