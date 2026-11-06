/**
 * CLI: visuele kwaliteitscontrole op de gegenereerde HTML.
 * Gebruik: tsx scripts/visual/visual-qc.ts --label w6a
 */
import { join } from "node:path";
import { runVisualQc, summarizeVisualQc } from "../../lib/qc/visual-qc";

const labelIndex = process.argv.indexOf("--label");
const label = labelIndex > -1 ? process.argv[labelIndex + 1] : "w6a";
const dir = join(process.cwd(), `visual-output/${label}/html`);
const slugs = ["home", "over-ons", "diensten", "faq", "contact"];

(async () => {
  const reports = await runVisualQc({
    pages: slugs.map((slug) => ({ slug, fileUrl: "file://" + join(dir, `${slug}.html`) })),
  });
  for (const report of reports) {
    if (report.issues.length === 0) continue;
    console.log(`\n## ${report.page} — ${report.viewport}`);
    for (const issue of report.issues.slice(0, 12)) {
      console.log(`- [${issue.severity}] ${issue.kind}: ${issue.selector} — ${issue.detail}`);
    }
  }
  const summary = summarizeVisualQc(reports);
  console.log(
    `\nSamenvatting: ${summary.critical} kritiek, ${summary.warnings} waarschuwingen` +
      (summary.failedPages.length > 0 ? ` | faalt op: ${summary.failedPages.join(", ")}` : " | geen kritieke fouten")
  );
})();
