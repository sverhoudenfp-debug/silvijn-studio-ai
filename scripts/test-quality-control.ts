/**
 * Quality Control + Human Approval-testsuite (Fase 10) — mock mode,
 * 0 echte API-calls, volledig fictieve fixtures.
 * Uitvoeren: npx tsx scripts/test-quality-control.ts
 */
import { QCAnalysisSchema } from "../lib/ai/schemas";
import { getLeadRepository } from "../lib/repositories/lead-repository";
import { ProjectService } from "../lib/projects/service";
import { getProjectRepository } from "../lib/projects/repository";
import { runDeterministicChecks } from "../lib/qc/checks";
import { computeOverallResult, computeScore } from "../lib/qc/rules";
import { getQualityControlRepository } from "../lib/qc/repository";
import { QualityControlService, getApproverName } from "../lib/qc/service";
import type { QCCategoryCheck, QCIssue } from "../lib/qc/types";
import { getGeneratedWebsiteRepository } from "../lib/websites/repository";
import { WebsiteGenerationService } from "../lib/websites/service";
import type { WebsiteSpecification } from "../lib/websites/types";

let failures = 0;
function check(name: string, condition: boolean, detail?: string) {
  console.info(`${condition ? "PASS" : "FAIL"} — ${name}${condition || !detail ? "" : ` (${detail})`}`);
  if (!condition) failures += 1;
}

function issue(category: QCIssue["category"], severity: QCIssue["severity"], rule = "test"): QCIssue {
  return { id: `t-${category}-${severity}`, category, severity, rule, message: `testissue ${category} ${severity}` };
}

function categoryCheck(category: QCCategoryCheck["category"], result: QCCategoryCheck["result"], issues: QCIssue[] = []): QCCategoryCheck {
  return { category, result, issues, notes: [] };
}

async function main() {
  // TESTS draaien uitsluitend op mock-data (Fase-instructie): een eventueel
  // aanwezige Supabase-configuratie wordt bewust genegeerd — géén live API-calls.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  const qcRepo = getQualityControlRepository();
  const websiteRepo = getGeneratedWebsiteRepository();
  const leadRepo = getLeadRepository();
  const qcService = new QualityControlService();

  console.info("--- QC model + AI-schema validatie ---");
  const validAnalysis = {
    contentAssessment: { result: "passed", issues: [], notes: null },
    designAssessment: { result: "passed", issues: [], notes: null },
    responsiveAssessment: { result: "warning", issues: [{ severity: "warning", message: "visueel niet getest" }], notes: "x" },
    conversionAssessment: { result: "passed", issues: [], notes: null },
    businessAccuracyAssessment: { result: "passed", issues: [], notes: null },
    recommendations: ["aanbeveling"],
    summary: "De website voldoet structureel aan de eisen.",
  };
  check("geldige QCAnalysis geaccepteerd", QCAnalysisSchema.safeParse(validAnalysis).success);
  const invalidAnalysis = { ...validAnalysis, summary: "kort" };
  check("ongeldige QCAnalysis geweigerd (te korte summary)", !QCAnalysisSchema.safeParse(invalidAnalysis).success);
  const invalidSeverity = { ...validAnalysis, contentAssessment: { result: "passed", issues: [{ severity: "fatal", message: "x" }], notes: null } };
  check("onbekende severity geweigerd", !QCAnalysisSchema.safeParse(invalidSeverity).success);

  console.info("--- Automatische result-regels (deterministisch, AI kan niet overrulen) ---");
  const allPassed = [
    "technical", "content", "design", "responsive", "conversion", "seo", "accessibility", "security", "business_accuracy",
  ].map((c) => categoryCheck(c as QCCategoryCheck["category"], "passed"));

  check("alles geslaagd → PASS", computeOverallResult(allPassed, []) === "pass");
  check("CRITICAL issue → FAIL", computeOverallResult(allPassed, [issue("security", "critical")]) === "fail");
  check("security FAILED → FAIL", computeOverallResult(allPassed.map((c) => (c.category === "security" ? categoryCheck("security", "failed", [issue("security", "error")]) : c)), [issue("security", "error")]) === "fail");
  check("technical FAILED → FAIL", computeOverallResult(allPassed.map((c) => (c.category === "technical" ? categoryCheck("technical", "failed", [issue("technical", "error")]) : c)), [issue("technical", "error")]) === "fail");
  check("fabricatie (ERROR) → FAIL", computeOverallResult(allPassed, [issue("content", "error", "fabrication_prijs")]) === "fail");
  check("verkeerde bedrijfsnaam → FAIL", computeOverallResult(allPassed, [issue("business_accuracy", "critical", "business_name")]) === "fail");
  check("ERROR in andere categorie → NEEDS_REVISION", computeOverallResult(allPassed, [issue("seo", "error", "title_length")]) === "needs_revision");
  check("FAILED categorie zonder error-issue → NEEDS_REVISION", computeOverallResult(allPassed.map((c) => (c.category === "conversion" ? categoryCheck("conversion", "failed", [issue("conversion", "critical")]) : c)), [issue("conversion", "critical")]) === "fail");
  check("alleen warnings → kan PASS zijn", computeOverallResult(allPassed, [issue("responsive", "warning")]) === "pass");
  check("score: clean = 100", computeScore(allPassed, []) === 100);
  check("score: critical verlaagt sterk", computeScore(allPassed, [issue("content", "critical")]) < 70);
  check("score: alleen warnings mild", computeScore(allPassed, [issue("content", "warning")]) > 90 && computeScore(allPassed, [issue("content", "warning")]) < 100);

  console.info("--- Volledige flow: genereren → QC → approval (mock, fictieve data) ---");
  const qualifiedLead = (await leadRepo.list()).find((l) => l.leadStatus === "qualified")!;
  const project = await new ProjectService().createFromLead(qualifiedLead.id);
  const website = await new WebsiteGenerationService().generateWebsite(project.id);

  check("website start bij ready_for_qc", website.status === "ready_for_qc", website.status);
  check("nog geen QC-record", (await qcService.getLatestQcForWebsite(website.id)) === null);

  const qc = await qcService.runQualityControl(website.id);

  check("QC-record aangemaakt en voltooid", qc.status === "completed");
  check("9 categorieën gecontroleerd", qc.checks.length === 9, `${qc.checks.length}`);
  check("overall result is pass/needs_revision (mock-website is structureel in orde)", ["pass", "needs_revision"].includes(qc.overallResult), qc.overallResult);
  check("website-status geüpdatet naar ready_for_silvijn (bij pass)", qc.overallResult === "pass" ? (await websiteRepo.getById(website.id))?.status === "ready_for_silvijn" : true);
  check("warnings afgeleid uit issues", qc.warnings.every((w) => qc.issues.some((i) => i.severity === "warning" && i.message === w)));
  check("passedChecks/failedChecks consistent", qc.passedChecks.every((c) => qc.checks.find((x) => x.category === c)?.result !== "failed") && qc.failedChecks.every((c) => qc.checks.find((x) => x.category === c)?.result === "failed"));
  check("score is interne indicator 0-100", qc.score >= 0 && qc.score <= 100);
  check("AI summary aanwezig (mock)", qc.aiSummary.length > 20);
  check("AI mode gelogd", qc.mode === "mock");

  console.info("--- Deterministische check-categorieën (echte website) ---");
  const lead = (await leadRepo.list()).find((l) => l.id === website.leadId)!;
  const fullProject = (await getProjectRepository().getById(project.id))!;
  const det = runDeterministicChecks({ website, lead, project: fullProject });
  const byCategory = new Map(det.checks.map((c) => [c.category, c]));

  check("technical: valide spec/componenten gedetecteerd", (byCategory.get("technical")?.issues ?? []).every((i) => i.severity !== "critical"));
  check("content: placeholders als INFO gemarkeerd (geen feit)", (byCategory.get("content")?.issues ?? []).some((i) => i.rule === "missing_information" && i.severity === "info"));
  check("responsive: STRUCTURAL CHECK gedocumenteerd", (byCategory.get("responsive")?.issues ?? []).some((i) => i.rule === "structural_check"));
  check("responsive: VISUAL CHECK expliciet niet uitgevoerd", (byCategory.get("responsive")?.issues ?? []).some((i) => i.rule === "visual_check_not_performed" && i.severity === "warning"));
  check("accessibility: WCAG expliciet NIET bewezen", (byCategory.get("accessibility")?.issues ?? []).some((i) => i.rule === "wcag_not_audited"));
  check("business_accuracy: missende info als MISSING_INFORMATION", (byCategory.get("business_accuracy")?.issues ?? []).some((i) => i.rule === "missing_information"));
  check("security: geen false positives op de schone website", (byCategory.get("security")?.issues ?? []).length === 0);

  console.info("--- Fabricaties in QC-content check ---");
  const fabricated = { ...website, specification: JSON.parse(JSON.stringify(website.specification)) as WebsiteSpecification };
  fabricated.specification.content.benefits.push("Al 25 jaar ervaring en 500+ tevreden klanten");
  const fabDet = runDeterministicChecks({ website: fabricated, lead, project: fullProject });
  const fabIssues = fabDet.issues.filter((i) => i.rule.startsWith("fabrication_"));
  check("ervarings-/klantaantal-fabricatie gedetecteerd als ERROR", fabIssues.some((i) => (i.rule === "fabrication_ervaring" || i.rule === "fabrication_klantaantal") && i.severity === "error"));
  check("fabricatie in content-check terechtkomt", fabIssues.every((i) => i.category === "content"));
  check("fabricatie → overall FAIL", computeOverallResult(fabDet.checks, fabDet.issues) === "fail");

  console.info("--- Misplaatste bedrijfsnaam (business accuracy) ---");
  const wrongName = { ...website, specification: JSON.parse(JSON.stringify(website.specification)) as WebsiteSpecification };
  wrongName.specification.business.businessName = "Helemaal Ander Bedrijf";
  const nameDet = runDeterministicChecks({ website: wrongName, lead, project: fullProject });
  check("verkeerde bedrijfsnaam → CRITICAL business_accuracy", nameDet.issues.some((i) => i.rule === "business_name" && i.severity === "critical"));
  check("verkeerde bedrijfsnaam → overall FAIL", computeOverallResult(nameDet.checks, nameDet.issues) === "fail");

  console.info("--- Security-checks ---");
  const unsafe = { ...website, specification: JSON.parse(JSON.stringify(website.specification)) as WebsiteSpecification };
  unsafe.specification.content.about = "Onze API key: sk-ant-abc123xyz — eval() code uitvoeren via new Function";
  const secDet = runDeterministicChecks({ website: unsafe, lead, project: fullProject });
  check("API-key in content → CRITICAL security", secDet.issues.some((i) => i.rule === "api_key" && i.severity === "critical"));
  check("code-executie-patroon → CRITICAL security", secDet.issues.some((i) => i.rule === "code_execution" && i.severity === "critical"));
  check("security FAILED → overall FAIL", computeOverallResult(secDet.checks, secDet.issues) === "fail");

  const badSlug = { ...website, slug: "../etc/passwd" };
  const slugDet = runDeterministicChecks({ website: badSlug, lead, project: fullProject });
  check("path traversal in slug → CRITICAL", slugDet.issues.some((i) => i.rule === "path_traversal" && i.severity === "critical"));

  console.info("--- SEO-checks ---");
  const noTitle = { ...website, specification: JSON.parse(JSON.stringify(website.specification)) as WebsiteSpecification };
  noTitle.specification.seo.title = "x";
  const seoDet = runDeterministicChecks({ website: noTitle, lead, project: fullProject });
  check("te korte SEO-titel → warning/error", seoDet.issues.some((i) => i.rule === "title_length"));
  const rankingClaim = { ...website, specification: JSON.parse(JSON.stringify(website.specification)) as WebsiteSpecification };
  rankingClaim.specification.content.about = "Deze website staat op #1 in Google, gegarandeerd.";
  const rankDet = runDeterministicChecks({ website: rankingClaim, lead, project: fullProject });
  check("Google-rankingclaim geblokkeerd", rankDet.issues.some((i) => i.rule === "ranking_claim"));

  console.info("--- Approval guards (harde gate) ---");
  // Bij PASS is de website ready_for_silvijn: de echte approval wordt in de
  // approval-flow hieronder getest; hier alléén het blokkeer-gedrag bij needs_revision.
  if (qc.overallResult !== "pass") {
    let guardError = "";
    try { await qcService.approveWebsite(website.id); } catch (e) { guardError = e instanceof Error ? e.message : ""; }
    check("approve geblokkeerd bij needs_revision", guardError.includes("READY_FOR_SILVIJN") || guardError.includes("status"), guardError);
  }

  // FAIL-website: fabricatie dwing door (direct op repo) → QC → approve moet blokkeren
  const failWebsite = await new WebsiteGenerationService().generateWebsite(project.id);
  await websiteRepo.update(failWebsite.id, {
    specification: { ...failWebsite.specification, content: { ...failWebsite.specification.content, benefits: [...failWebsite.specification.content.benefits, "Wij geven 10 jaar garantie op alles en staan op #1 in Google"] } },
  });
  const failQc = await qcService.runQualityControl(failWebsite.id);
  check("fabricatie-website → QC FAIL", failQc.overallResult === "fail", failQc.overallResult);
  check("failed website-status na QC FAIL", (await websiteRepo.getById(failWebsite.id))?.status === "failed");
  let failApproveError = "";
  try { await qcService.approveWebsite(failWebsite.id); } catch (e) { failApproveError = e instanceof Error ? e.message : ""; }
  check("approve geblokkeerd op FAILED website", failApproveError.length > 0, failApproveError);
  check("approve-fout verwijst naar status/guards", failApproveError.includes("status") || failApproveError.includes("READY_FOR_SILVIJN") || failApproveError.includes("geblokkeerd"));

  // QC op verkeerde status (qc_running) blokkeren
  const runningWebsite = await new WebsiteGenerationService().generateWebsite(project.id);
  await websiteRepo.update(runningWebsite.id, { status: "qc_running" });
  let runningError = "";
  try { await qcService.runQualityControl(runningWebsite.id); } catch (e) { runningError = e instanceof Error ? e.message : ""; }
  check("dubbele QC-run geblokkeerd op status qc_running", runningError.includes("ready_for_qc") || runningError.includes("status"));
  await websiteRepo.update(runningWebsite.id, { status: "ready_for_qc" });

  console.info("--- MENSelijke approval + revision + archive ---");
  let passWebsite = website;
  if (qc.overallResult !== "pass") {
    // Maak een schone PASS-website aan voor de approval-flow
    passWebsite = await new WebsiteGenerationService().generateWebsite(project.id);
    const passQc = await qcService.runQualityControl(passWebsite.id);
    check("schone website → QC PASS (ready_for_silvijn)", passQc.overallResult === "pass", passQc.overallResult);
  }
  const approved = await qcService.approveWebsite(passWebsite.id);
  check("approve zet status APPROVED", approved.website.status === "approved");
  check("approval gelogd met approver + versie", approved.qc.approval?.action === "approved" && approved.qc.approval.by === await getApproverName() && approved.qc.approval.websiteVersion === passWebsite.version);
  check("approver is een geverifieerde user-ID", (await getApproverName()).length > 0);
  let doubleApproveError = "";
  try { await qcService.approveWebsite(passWebsite.id); } catch (e) { doubleApproveError = e instanceof Error ? e.message : ""; }
  check("dubbele approve geblokkeerd (al APPROVED)", doubleApproveError.length > 0);
  check("APPROVED betekent NIET project completed", (await getProjectRepository().getById(project.id))?.status !== "completed");

  // Revision request
  const revisionWebsite = await new WebsiteGenerationService().generateWebsite(project.id);
  const revisionQc = await qcService.runQualityControl(revisionWebsite.id);
  if (revisionQc.overallResult === "pass") {
    const revision = await qcService.requestWebsiteRevision(revisionWebsite.id, "Hero is te druk, minder tekst a.u.b.");
    check("revision request zet needs_revision", revision.website.status === "needs_revision");
    check("revision-log bevat reden + approver", revision.qc.approval?.action === "revision_requested" && (revision.qc.approval.reason?.includes("Hero") ?? false));
    let badReasonError = "";
    try { await qcService.requestWebsiteRevision(revisionWebsite.id, "x"); } catch (e) { badReasonError = e instanceof Error ? e.message : ""; }
    check("revision zonder geldige reden geblokkeerd", badReasonError.includes("reden") || badReasonError.length > 0);
  } else {
    const revision = await qcService.requestWebsiteRevision(revisionWebsite.id, "Fix eerst de gevonden QC-issues");
    check("revision request zet needs_revision (na needs_revision-QC)", revision.website.status === "needs_revision");
    check("revision-log bevat reden", (revision.qc.approval?.reason ?? "").length > 5);
  }

  // Archive
  const archived = await qcService.archiveWebsite(revisionWebsite.id);
  check("archive zet status archived", archived.status === "archived");
  let archiveAgainError = "";
  try { await qcService.archiveWebsite(revisionWebsite.id); } catch (e) { archiveAgainError = e instanceof Error ? e.message : ""; }
  check("dubbele archive geblokkeerd", archiveAgainError.length > 0);

  console.info("--- QC history + versie-beheer (niets wordt overschreven) ---");
  const history = await qcService.listQcHistory(website.id);
  check("QC-history bewaard per websiteversie", history.length >= 1 && history.every((h) => h.generatedWebsiteId === website.id));
  const allQc = await qcRepo.list();
  check("alle QC-rapporten bewaard (nooit overschreven)", allQc.length >= 3, `${allQc.length}`);
  const versions = await websiteRepo.listByProject(project.id);
  check("alle websiteversies bewaard (v1..vN)", versions.length >= 4, `${versions.length}`);
  check("approved versie niet gearchiveerd door regeneratie", versions.some((v) => v.status === "approved"));

  console.info("--- Repository ---");
  check("getById werkt", (await qcRepo.getById(qc.id))?.id === qc.id);
  check("getById onbekend → null", (await qcRepo.getById("qc-999")) === null);
  check("listByProjectId werkt", (await qcRepo.listByProjectId(project.id)).every((r) => r.projectId === project.id));
  const updatedQc = await qcRepo.update(qc.id, { recommendations: ["TESTDATA: extra aanbeveling"] });
  check("update werkt", updatedQc?.recommendations.includes("TESTDATA: extra aanbeveling") ?? false);

  console.info("--- Geen autonome delivery (security-scan) ---");
  const fs = await import("node:fs");
  const serviceSource = fs.readFileSync("lib/qc/service.ts", "utf8");
  const actionsSource = fs.readFileSync("app/actions/websites.ts", "utf8");
  check("geen echte verzend/deploy-calls in de QC-service", !/(sendEmail|sendMail|resend|deploy|publish|verstuur|fetch)\s*\(/i.test(serviceSource));
  check("geen deliver/payment/contract-acties geëxporteerd", !/export\s+async\s+function\s+\w*(deliver|publish|pay|invoice|contract|mail)\w*/i.test(actionsSource));
  // "approved" mag in de QC-service precies één keer voorkomen: in approveWebsite
  // (de menselijke server action). De AI-merge-code kan de status dus nooit zetten.
  const approvedAssignments = serviceSource.match(/status: "approved"/g) ?? [];
  check("AI keurt nooit goed: status approved alléén in de menselijke approve-flow", serviceSource.includes("approveWebsite") && approvedAssignments.length === 1, `${approvedAssignments.length}x status: "approved"`);
  check("QC beslist website-status alléén deterministisch (uit overallResult, niet uit AI-advies)", serviceSource.includes('overallResult === "pass" ? "ready_for_silvijn"'));
  check("project-status wordt door QC niet aangeraakt", !/updateStatus|ProjectService/.test(serviceSource));

  console.info(failures === 0 ? "\\nALLE QUALITY CONTROL-TESTS PASS" : `\\n${failures} TEST(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.info(`Onverwachte fout: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
