import { chromium } from "playwright";
import { join } from "node:path";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto("file://" + join(process.cwd(), "visual-output/w5a/html/home.html"));
  const out = await p.evaluate(`(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    const sections = Array.from(document.querySelectorAll("main#main-content > section, main#main-content > .d3-section"));
    return {
      heroMedia: pick(".hero__media"),
      heroThemeMedia: pick(".hero__media .theme-media"),
      heroImg: pick(".hero__media img"),
      bodyClass: document.body.className,
      sections: sections.map((s) => ({
        cls: (s.className || "").slice(0, 60),
        h: Math.round(s.getBoundingClientRect().height),
        content: Math.round((s.firstElementChild ? s.firstElementChild.getBoundingClientRect().height : 0)),
      })),
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
  await b.close();
})();
