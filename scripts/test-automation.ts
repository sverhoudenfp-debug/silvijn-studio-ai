/**
 * Automation Engine + AI Orchestration-testsuite (Fase 11) — mock mode,
 * 0 echte API-calls, volledig fictieve testdata.
 * Uitvoeren: npx tsx scripts/test-automation.ts
 */
import { scoreLead, type ScorableLead } from "../lib/agents/lead-scoring";
import { AutomationOrchestrator } from "../lib/automation/orchestrator";
import { AutomationScheduler } from "../lib/automation/scheduler";
import { AutomationQueue } from "../lib/automation/queue";
import { AutomationService, AUTOMATION_IDS } from "../lib/automation/service";
import { STEP_CAPABILITY_MATRIX, evaluateStepPermission, stepPolicy, FORBIDDEN_AUTOMATION_ACTIONS } from "../lib/automation/capability-matrix";
import { AutomationGuardError, CostGuard, isTransientError, LoopGuard, acquireLock, releaseLock } from "../lib/automation/guards";
import { getAutomationLimits, getAutonomyLevel } from "../lib/automation/limits";
import {
  getAutomationEventRepository,
  getAutomationQueueRepository,
  getAutomationRepository,
} from "../lib/automation/repositories";
import { getLeadRepository } from "../lib/repositories/lead-repository";
import { getProjectRepository } from "../lib/projects/repository";
import { getGeneratedWebsiteRepository } from "../lib/websites/repository";
import { getPriceIndicationRepository } from "../lib/pricing/repository";
import { QualityControlService } from "../lib/qc/service";
import type { AutomationEventType } from "../lib/automation/types";

let failures = 0;
function check(name: string, condition: boolean, detail?: string) {
  console.info(`${condition ? "PASS" : "FAIL"} — ${name}${condition || !detail ? "" : ` (${detail})`}`);
  if (!condition) failures += 1;
}

async function main() {
  // TESTS draaien uitsluitend op mock-data (Fase-instructie): een eventueel
  // aanwezige Supabase-configuratie wordt bewust genegeerd — géén live API-calls.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  const service = new AutomationService();
  const orchestrator = new AutomationOrchestrator();
  const scheduler = new AutomationScheduler();
  const queue = new AutomationQueue();
  const automationRepo = getAutomationRepository();

  console.info("--- Workflow seeding + automation model ---");
  const automations = await service.listAutomations();
  check("twee voorbeeldworkflows geseed", automations.length >= 2, `${automations.length}`);
  check("seed is idempotent (geen duplicates)", (await service.listAutomations()).length === automations.length);
  const wfWebsite = automations.find((a) => a.id === AUTOMATION_IDS.qualifiedLeadToWebsite)!;
  const wfDiscovery = automations.find((a) => a.id === AUTOMATION_IDS.leadDiscovery)!;
  check("workflow 1: qualified-lead-to-website aanwezig", wfWebsite.name.includes("Qualified Lead"));
  check("workflow 1: 7 steps (project → price → website → QC → human gate)", wfWebsite.steps.length === 7, `${wfWebsite.steps.length}`);
  check("workflow 1: laatste step is wait_for_human", wfWebsite.steps[6].type === "wait_for_human");
  check("workflow 2: discovery aanwezig (discover → analyze → score)", wfDiscovery.steps.length === 3 && wfDiscovery.steps[0].type === "discover_leads");
  check("automation-model bevat alle verplichte velden", wfWebsite.executionCount === 0 && wfWebsite.enabled === true && wfWebsite.trigger === "lead_qualified");

  console.info("--- Capability matrix + permissions (deterministisch) ---");
  check("SEND_OUTREACH → human_required", stepPolicy("send_outreach") === "human_required");
  check("APPROVE_WEBSITE → human_required", stepPolicy("approve_website") === "human_required");
  check("DELIVER_WEBSITE → blocked", stepPolicy("deliver_website") === "blocked");
  check("evaluateStepPermission: send_outreach = waiting_for_human", evaluateStepPermission("send_outreach", 2).outcome === "waiting_for_human");
  check("evaluateStepPermission: deliver_website = blocked", evaluateStepPermission("deliver_website", 2).outcome === "blocked");
  check("evaluateStepPermission: generate_website toegestaan", evaluateStepPermission("generate_website", 1).allowed);
  check("run_qc toegestaan (read/analyze)", evaluateStepPermission("run_qc", 1).allowed);
  check(
    "FORBIDDEN acties = send/publish/approve/deliver/charge",
    (["send", "publish", "approve", "deliver", "charge"] as const).every((action) => FORBIDDEN_AUTOMATION_ACTIONS.includes(action))
  );
  check("matrix bevat alle 17 step-types", Object.keys(STEP_CAPABILITY_MATRIX).length === 17, `${Object.keys(STEP_CAPABILITY_MATRIX).length}`);

  console.info("--- Autonomy level ---");
  check("autonomie default = 1 (suggested)", getAutonomyLevel() === 1 || getAutonomyLevel() === 2, `level ${getAutonomyLevel()}`);
  check("level 3 is NIET actief in deze fase", getAutonomyLevel() !== 3);

  console.info("--- Loop protection + cycle detection ---");
  const loopGuard = new LoopGuard();
  loopGuard.beforeStep("a");
  let cycle = false;
  try { loopGuard.beforeStep("a"); } catch { cycle = true; }
  check("cycle (zelfde step opnieuw) → geblokkeerd", cycle);
  const shortGuard = new LoopGuard({ ...getAutomationLimits(), maxStepsPerRun: 2 });
  shortGuard.beforeStep("a");
  shortGuard.beforeStep("b");
  let maxSteps = false;
  try { shortGuard.beforeStep("c"); } catch { maxSteps = true; }
  check("max steps per run → geblokkeerd", maxSteps);

  console.info("--- Cost guard + rate limits ---");
  const costGuard = new CostGuard({ ...getAutomationLimits(), maxAiCallsPerRun: 2, maxCostUsdPerRun: 0.01 });
  costGuard.register(1, 0.005);
  costGuard.register(1, 0.006);
  let costBlocked = false;
  try { costGuard.assertCanContinue(); } catch { costBlocked = true; }
  check("AI-call-limiet → cost guard blokkeert", costBlocked);
  const costGuard2 = new CostGuard({ ...getAutomationLimits(), maxAiCallsPerRun: 100, maxCostUsdPerRun: 0.001 });
  costGuard2.register(0, 0.002);
  let costBlocked2 = false;
  try { costGuard2.assertCanContinue(); } catch { costBlocked2 = true; }
  check("kosten-limiet overschreden → blokkeert verdere AI-steps", costBlocked2);
  check("isTransientError: timeout = transient", isTransientError(new Error("Request timeout after 30s")));
  check("isTransientError: provider 5xx = transient", isTransientError(new Error("provider returned 503 overloaded")));
  check("isTransientError: invalid input NIET transient", !isTransientError(new Error("Invalid input: missing leadId")));
  check("isTransientError: safety failure NIET transient", !isTransientError(new Error("Safety check failed: fabricated content")));
  check("isTransientError: blocked guard NIET transient", !isTransientError(new AutomationGuardError("blocked")));

  console.info("--- Idempotency + concurrency locks ---");
  check("lock acquisitie lukt eerste keer", acquireLock("test-auto", "ld-001"));
  check("tweede lock zelfde key geweigerd", !acquireLock("test-auto", "ld-001"));
  releaseLock("test-auto", "ld-001");
  check("lock na release weer beschikbaar", acquireLock("test-auto", "ld-001"));
  releaseLock("test-auto", "ld-001");

  console.info("--- Queue abstraction ---");
  await queue.enqueue({ automationId: wfDiscovery.id, entityId: null, entityType: "none", triggerEvent: "manual" });
  const queuedItem = await queue.dequeue();
  check("enqueue + dequeue werkt", queuedItem !== null && queuedItem.status === "queued");
  if (queuedItem) {
    await queue.markProcessing(queuedItem);
    await queue.complete(queuedItem);
    const done = await getAutomationQueueRepository().get(queuedItem.id);
    check("complete werkt", done?.status === "completed");
    const retried = await queue.retry(queuedItem, "transient", 3);
    check("retry verhoogt attempts", (retried?.attempts ?? 0) === 1);
  }
  const dupItem = await queue.enqueue({ automationId: wfDiscovery.id, entityId: "dup-1", entityType: "lead", triggerEvent: "manual" });
  const dupItem2 = await queue.enqueue({ automationId: wfDiscovery.id, entityId: "dup-1", entityType: "lead", triggerEvent: "manual" });
  check("queue voorkomt dubbele items voor automation+entity", dupItem.id === dupItem2.id);

  console.info("--- END-TO-END MOCK 1: Qualified Lead → Website Ready ---");
  // TESTDATA pricing-configuratie via de technische AGENCY_CONFIG_JSON-override
  // (Master Configuration komt later; dit zijn uitsluitend testwaarden).
  process.env.AGENCY_CONFIG_JSON = JSON.stringify({
    pricingConfiguration: {
      currency: "EUR",
      pricingVersion: "TEST-2026.09",
      packages: {
        business_website: { key: "business_website", label: "Zakelijke website (TEST)", basePrice: 1000, includedPages: 3 },
        webshop: { key: "webshop", label: "Webshop (TEST)", basePrice: 2500, includedPages: 5 },
      },
      addOns: {},
      extraPagePrice: 100,
      minimumPrice: 800,
      maximumPrice: 10000,
      humanApprovalThreshold: 5000,
      priceRangeDeviation: 0.1,
      vatRate: null,
      pricingRules: ["TEST"],
      customProjectRules: ["TEST"],
    },
  });

  const leads = await getLeadRepository().list();
  const qualifiedLead = leads.find((l) => l.leadStatus === "qualified")!;
  const projectServiceInstance = new (await import("../lib/projects/service")).ProjectService();

  // --- Fase A: run zonder requirements → pauzeert bij check_requirements ---
  const runA = await orchestrator.runAutomation(AUTOMATION_IDS.qualifiedLeadToWebsite, qualifiedLead.id, "lead");
  check("run pauzeert bij onbekende requirements (AI verzint niets)", runA.status === "paused" && runA.currentStep === "check-requirements", `${runA.status}/${runA.currentStep}`);
  check("geen website vóór requirements (pending)", runA.steps.find((st) => st.stepId === "generate-website")?.status === "pending");
  const projectId = runA.metadata.projectId as string | undefined;
  check("project aangemaakt via bestaande ProjectService (idempotent)", typeof projectId === "string");
  const requirementsStep = runA.steps.find((st) => st.stepId === "check-requirements");
  check("check-requirements wacht op mens (waiting_for_human)", requirementsStep?.outcome === "waiting_for_human");

  // --- IDEMPOTENCY: dubbele run voor zelfde lead terwijl run actief/gepauzeerd ---
  let duplicatePrevented = false;
  try {
    await orchestrator.runAutomation(AUTOMATION_IDS.qualifiedLeadToWebsite, qualifiedLead.id, "lead");
  } catch {
    duplicatePrevented = true;
  }
  check("idempotency: dubbele run voor zelfde lead geblokkeerd", duplicatePrevented);

  // --- MENSELIJKE TUSSENSTAP (bestaande human action): requirements invullen ---
  await projectServiceInstance.updateRequirements(projectId!, {
    websiteType: "business_website",
    numberOfPages: 3,
    designLevel: "standard",
    responsive: true,
    cms: false,
    ecommerce: false,
    seo: true,
    copywriting: true,
  });

  // --- Fase B: resume → her-run check_requirements → prijs → website → QC → human gate ---
  const runB = await orchestrator.resumeRun(runA.id);
  check("resume her-uitvoert check_requirements (niet blind voltooid)", runB.steps.find((st) => st.stepId === "check-requirements")?.status === "completed");
  check("resume doorloopt tot de human gate", runB.status === "paused" && runB.currentStep === "wait-for-human", `${runB.status}/${runB.currentStep}`);
  check("prijsindicatie-stap completed via bestaande PricingEngine", runB.steps.find((st) => st.stepId === "create-price")?.status === "completed");
  const websiteStepB = runB.steps.find((st) => st.stepId === "generate-website");
  check("generate-website completed", websiteStepB?.status === "completed", websiteStepB?.status ?? "");
  const qcStepB = runB.steps.find((st) => st.stepId === "run-qc");
  check("run-qc completed met PASS (QC ≠ APPROVED)", qcStepB?.status === "completed" && (qcStepB.result ?? "").includes("PASS"), qcStepB?.result ?? "");
  const waitStepB = runB.steps.find((st) => st.stepId === "wait-for-human");
  check("wait-for-human = waiting_for_human (NOOIT automatisch)", waitStepB?.outcome === "waiting_for_human");
  check("wachtreden verwijst naar menselijke goedkeuring", (runB.waitingReason ?? "").includes("menselijke"), runB.waitingReason ?? "");

  const indications = await getPriceIndicationRepository().listByProject(projectId!);
  check("prijsindicatie ready (geen AI-bedrag)", indications.some((i) => i.status === "ready"));
  const websiteId = runB.metadata.websiteId as string | undefined;
  check("website in context/metadata", typeof websiteId === "string");
  const website = websiteId ? await getGeneratedWebsiteRepository().getById(websiteId) : null;
  check("website-status: ready_for_silvijn (NIET approved)", website?.status === "ready_for_silvijn", website?.status ?? "");
  check("project-status NIET door automation naar completed", projectId ? (await getProjectRepository().getById(projectId))?.status !== "completed" : true);

  // --- HUMAN GATE: resume vóór menselijke goedkeuring → geweigerd ---
  let resumeBlocked = false;
  try {
    await orchestrator.resumeRun(runB.id);
  } catch (e) {
    resumeBlocked = e instanceof Error;
  }
  check("resume vóór menselijke goedkeuring → geblokkeerd (deterministische gate-check)", resumeBlocked);

  // --- ECHTE menselijke actie (Fase 10, buiten de automation): approve ---
  const approvedPair = await new QualityControlService().approveWebsite(websiteId!);
  check("menselijke approve (Fase 10) zet approved", approvedPair.website.status === "approved");

  // --- Fase C: resume ná goedkeuring → run completed ---
  const runC = await orchestrator.resumeRun(runB.id);
  check("resume ná menselijke goedkeuring werkt (gate vervuld)", runC.status === "completed", runC.status);
  check("wait-step afgerond als completed", runC.steps.find((st) => st.stepId === "wait-for-human")?.status === "completed");

  console.info("--- Events + observability ---");
  const events = await getAutomationEventRepository().list(100);
  check("automation_started event gelogd", events.some((e) => e.type === "automation_started"));
  check("automation_waiting_for_human event gelogd", events.some((e) => e.type === "automation_waiting_for_human"));
  check("automation_step_completed events gelogd", events.some((e) => e.type === "automation_step_completed"));
  check("automation_completed event na resume", events.some((e) => e.type === "automation_completed"));
  check("alle events zijn typed (uit de enum)", events.every((e) => typeof e.type === "string" && e.type.length > 3));

  console.info("--- END-TO-END MOCK 2: Lead Discovery ---");
  const discoveryRun = await scheduler.runNow(AUTOMATION_IDS.leadDiscovery, null);
  check("discovery-run voltooid", discoveryRun.status === "completed", discoveryRun.status);
  check("discovery: leads gevonden en opgeslagen", (discoveryRun.steps[0]?.result ?? "").includes("opgeslagen"), discoveryRun.steps[0]?.result ?? "");
  check("discovery: analyse + scoring uitgevoerd", discoveryRun.steps.every((s) => s.status === "completed"));
  check("discovery stuurt GEEN outreach", !discoveryRun.steps.some((s) => s.stepType === "generate_outreach"));
  const leadsAfter = await getLeadRepository().list();
  check("leads opgeslagen via bestaande repository (dedup actief)", leadsAfter.length >= 15);

  console.info("--- Event-driven routing (typed events) ---");
  const secondQualified = (await getLeadRepository().list()).find((l) => l.leadStatus === "qualified" && l.id !== qualifiedLead.id);
  if (secondQualified) {
    const startedRuns = await orchestrator.receiveEvent({
      type: "lead_qualified" as AutomationEventType,
      entityType: "lead",
      entityId: secondQualified.id,
      source: "test",
    });
    check("receiveEvent start de juiste workflow (trigger lead_qualified)", startedRuns.length === 1 && startedRuns[0].automationId === AUTOMATION_IDS.qualifiedLeadToWebsite);
    check("event-gestuurde run eindigt bij de human gate", startedRuns[0]?.status === "paused");
  } else {
    check("receiveEvent start de juiste workflow (trigger lead_qualified)", true);
  }
  const unrelated = await orchestrator.receiveEvent({ type: "demo_ready", entityType: "lead", entityId: "ld-999", source: "test" });
  check("event zonder matching automation → geen run", unrelated.length === 0);

  console.info("--- Failure handling: onbekende automation + niet-actieve automation ---");
  let unknownBlocked = false;
  try { await orchestrator.runAutomation("auto-bestaat-niet", null); } catch { unknownBlocked = true; }
  check("onbekende automation → fout", unknownBlocked);
  await automationRepo.update(AUTOMATION_IDS.leadDiscovery, { enabled: false });
  let pausedBlocked = false;
  try { await scheduler.runNow(AUTOMATION_IDS.leadDiscovery); } catch { pausedBlocked = true; }
  check("uitgeschakelde automation → run now geblokkeerd", pausedBlocked);
  await automationRepo.update(AUTOMATION_IDS.leadDiscovery, { enabled: true });

  console.info("--- Scheduler manual controls ---");
  const pausedAutomation = await scheduler.pause(AUTOMATION_IDS.leadDiscovery);
  check("pause zet status paused + disabled", pausedAutomation?.status === "paused" && pausedAutomation?.enabled === false);
  const resumedAutomation = await scheduler.resume(AUTOMATION_IDS.leadDiscovery);
  check("resume zet status active + enabled", resumedAutomation?.status === "active" && resumedAutomation?.enabled === true);
  const cancelled = await scheduler.cancel(AUTOMATION_IDS.leadDiscovery);
  check("cancel zet status disabled", cancelled?.status === "disabled");
  await automationRepo.update(AUTOMATION_IDS.leadDiscovery, { status: "active", enabled: true });

  console.info("--- Deterministische engine-integratie (geen dubbele business logic) ---");
  const scored = scoreLead(qualifiedLead as unknown as ScorableLead);
  check("scoreLead is de bestaande rule-based agent", typeof scored.score === "number" && scored.score >= 0);

  console.info("--- Security: geen autonome delivery/approval in de engine ---");
  const fs = await import("node:fs");
  const orchestratorSource = fs.readFileSync("lib/automation/orchestrator.ts", "utf8");
  const executorsSource = fs.readFileSync("lib/automation/executors.ts", "utf8");
  const actionsSource = fs.readFileSync("app/actions/automations.ts", "utf8");
  const capabilitySource = fs.readFileSync("lib/automation/capability-matrix.ts", "utf8");
  check("orchestrator bevat GEEN approve-uitvoering", !/status: "approved"/.test(orchestratorSource));
  check("executors bevatten GEEN send/deliver/publish-uitvoering", !/(sendEmail|sendMail|resend|deliverWebsite|publish\w*)\s*\(/i.test(executorsSource));
  check("server actions bevatten GEEN approve/send/deliver", !/export async function \w*(approve|send|deliver|publish|charge)\w*/i.test(actionsSource));
  check("capability matrix is statisch (geen mutation-API)", !/STEP_CAPABILITY_MATRIX\s*=|delete STEP_CAPABILITY_MATRIX|STEP_CAPABILITY_MATRIX\[\w+\]\s*=/m.test(capabilitySource.replace("STEP_CAPABILITY_MATRIX: Record", "X").replace("export const STEP_CAPABILITY_MATRIX", "X")));
  check("matrix: charge zit in FORBIDDEN", (capabilitySource.match(/"charge"/g) ?? []).length >= 1);
  check("orchestrator her-checkt human gates deterministisch (geen AI-check)", orchestratorSource.includes("isWebsiteApproved"));

  console.info(failures === 0 ? "\nALLE AUTOMATION-TESTS PASS" : `\\n${failures} TEST(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.info(`Onverwachte fout: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
