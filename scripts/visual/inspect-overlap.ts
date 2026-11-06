import { chromium } from "playwright";
import { join } from "node:path";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto("file://" + join(process.cwd(), "visual-output/w6c/html/over-ons.html"));
  const out = await p.evaluate(`(() => {
    const els = Array.from(document.querySelectorAll("h1,h2,h3,h4,p"));
    const res = [];
    for (let i=0;i<els.length;i++) for (let j=i+1;j<els.length;j++) {
      const a=els[i], b=els[j];
      if (a.contains(b)||b.contains(a)) continue;
      const ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect();
      const ox=Math.min(ra.right,rb.right)-Math.max(ra.left,rb.left);
      const oy=Math.min(ra.bottom,rb.bottom)-Math.max(ra.top,rb.top);
      if (ox<=6||oy<=6) continue;
      const smaller=Math.min(ra.width*ra.height, rb.width*rb.height);
      if ((ox*oy)/smaller <= 0.12) continue;
      const sec = a.closest("section"); const h2 = sec ? sec.querySelector("h1,h2") : null;
      res.push({ section: h2 ? h2.textContent.trim().slice(0,40) : "?", a: a.tagName+": "+a.textContent.trim().slice(0,40), aBox:[Math.round(ra.left),Math.round(ra.top),Math.round(ra.width),Math.round(ra.height)], b: b.tagName+": "+b.textContent.trim().slice(0,40), bBox:[Math.round(rb.left),Math.round(rb.top),Math.round(rb.width),Math.round(rb.height)] });
    }
    return res.slice(0,6);
  })()`);
  console.log(JSON.stringify(out, null, 2));
  await b.close();
})();
