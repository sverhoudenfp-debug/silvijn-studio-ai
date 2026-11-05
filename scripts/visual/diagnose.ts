import { chromium } from "playwright";
const file = "visual-output/fase1/html/home.html";
async function main() {
const browser = await chromium.launch();
for (const width of [1440, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto("file://" + process.cwd() + "/" + file);
  const rows = await page.evaluate(`(() => {
    const px = (v) => Number.parseFloat(v) || 0;
    return [...document.querySelectorAll("p")].filter(p => p.innerText.trim().length > 40).map(p => {
      const r = p.getBoundingClientRect();
      const lh = px(getComputedStyle(p).lineHeight) || px(getComputedStyle(p).fontSize) * 1.5;
      const lines = Math.max(1, Math.round(r.height / lh));
      return {
        chars: Math.round((r.width - 0) / (px(getComputedStyle(p).fontSize) * 0.5)),
        perLine: Math.round(p.innerText.replace(/\\s+/g, " ").trim().length / lines),
        width: Math.round(r.width),
        maxWidth: getComputedStyle(p).maxWidth,
        cls: p.className || p.parentElement.className,
        text: p.innerText.slice(0, 40),
      };
    });
  })()`);
  console.log(`\n=== ${width}px ===`);
  for (const r of rows as Array<Record<string, unknown>>) console.log(JSON.stringify(r));
  await page.close();
}
await browser.close();

}
main();
