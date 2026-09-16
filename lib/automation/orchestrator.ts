import { getAIActivityRepository } from "@/lib/repositories/ai-activity-repository";
import { getGeneratedWebsiteRepository } from "@/lib/websites/repository";
import {
  evaluateStepPermission,
  stepPolicy,
} from "./capability-matrix";
import {
  executeAnalyzeLead,
  executeCheckPrice,
  executeCheckRequirements,
  executeCreatePriceIndication,
  executeCreateProject,
  executeDiscoverLeads,
  executeGenerateOutreach,
  executeGenerateWebsite,
  executeProcessReply,
  executeRunQc,
  executeScoreLead,
  StepExecutionBlockedError,
  type StepContext,
} from "./executors";
import { emitEvent } from "./events";
import {
  acquireLock,
  assertNoActiveDuplicate,
  assertRateLimits,
  AutomationGuardError,
  CostGuard,
  isTransientError,
  LoopGuard,
  releaseLock,
} from "./guards";
import { getAutomationLimits, getAutonomyLevel } from "./limits";
import {
  getAutomationRepository,
  getAutomationRunRepository,
} from "./repositories";
import type {
  Automation,
  AutomationEventType,
  AutomationRun,
  AutomationStepDefinition,
  StepExecutionResult,
} from "./types";

/**
 * AutomationOrchestrator (Fase 11) — bestuurt de bestaande engines.
 *
 * Event → guard/policy → één step → bestaande engine → result/event →
 * volgende step → human gate indien nodig. De orchestrator bevat GEEN
 * business logic; hij routeert naar executors die de bestaande services
 * aanroepen. Safety gates (capability matrix, cost guard, loop
 * protection, idempotency, rate limits) zijn deterministisch.
 */

export interface IncomingEvent {
  type: AutomationEventType;
  entityType: AutomationRun["entityType"];
  entityId: string | null;
  payload?: Record<string, unknown>;
  source: string;
}

export class AutomationOrchestrator {
  private limits = getAutomationLimits();

  /** Event ontvangen: opslaan + matching automations starten. */
  async receiveEvent(event: IncomingEvent): Promise<AutomationRun[]> {
    const stored = await emitEvent(event);
    const automations = await getAutomationRepository().listByTrigger(stored.type);
    const started: AutomationRun[] = [];
    for (const automation of automations) {
      if (!automation.enabled || automation.status !== "active") continue;
      try {
        started.push(await this.runAutomation(automation.id, event.entityId, event.entityType));
      } catch {
        // Guards (idempotency/rate/lock) slaan terecht af — niet crashen op
        // het hele event; de afwijking wordt per-automation gelogd via de run.
      }
    }
    return started;
  }

  /** Expliciete start (server action / scheduler): "run now". */
  async runAutomation(
    automationId: string,
    entityId: string | null,
    entityType: AutomationRun["entityType"] = entityId ? "lead" : "none"
  ): Promise<AutomationRun> {
    const automation = await getAutomationRepository().getById(automationId);
    if (!automation) throw new AutomationGuardError(`Automation "${automationId}" bestaat niet.`);
    if (!automation.enabled || automation.status !== "active") {
      throw new AutomationGuardError(
        `Automation "${automation.name}" is niet actief (status ${automation.status}, enabled ${automation.enabled}) — "run now" geblokkeerd.`
      );
    }

    // GUARDS: idempotency, rate limits, concurrency-lock
    await assertNoActiveDuplicate(automationId, entityId);
    await assertRateLimits(automationId, this.limits);
    if (!acquireLock(automationId, entityId)) {
      throw new AutomationGuardError("Er draait al een run voor deze automation + entity (lock).");
    }

    const runRepo = getAutomationRunRepository();
    let run = await runRepo.create({
      id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      automationId,
      status: "running",
      entityType,
      entityId,
      currentStep: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      retryCount: 0,
      waitingReason: null,
      steps: automation.steps.map((step) => ({
        stepId: step.id,
        stepType: step.type,
        status: "pending",
        startedAt: null,
        completedAt: null,
        outcome: null,
        error: null,
        retryCount: 0,
        result: null,
        aiCalls: 0,
        estimatedCostUsd: 0,
      })),
      metadata: { autonomyLevel: getAutonomyLevel() },
      warnings: [],
      aiCalls: 0,
      estimatedCostUsd: 0,
    });

    try {
      await getAutomationRepository().update(automationId, {
        executionCount: automation.executionCount + 1,
        lastRunAt: run.startedAt,
        currentStep: null,
      });
      await emitEvent({
        type: "automation_started",
        entityType,
        entityId,
        payload: { automationId, automationName: automation.name, runId: run.id },
        source: "orchestrator",
      });
      await this.logActivity(automation, `Automation gestart: ${automation.name}`, "started", entityId);

      run = await this.executeSteps(run, automation);
      return run;
    } catch (error) {
      // Guard-fouten (rate/lock) komen hier terecht vóór er steps draaiden:
      const message = error instanceof Error ? error.message : String(error);
      const failed = await runRepo.update(run.id, {
        status: "failed",
        error: message,
        completedAt: new Date().toISOString(),
      });
      await getAutomationRepository().update(automationId, { failureCount: automation.failureCount + 1 });
      await emitEvent({
        type: "automation_failed",
        entityType,
        entityId,
        payload: { automationId, runId: run.id, reason: message },
        source: "orchestrator",
      });
      return failed ?? run;
    } finally {
      releaseLock(automationId, entityId);
    }
  }

  /** Steps sequentieel uitvoeren met alle guards. */
  private async executeSteps(run: AutomationRun, automation: Automation): Promise<AutomationRun> {
    const runRepo = getAutomationRunRepository();
    const loopGuard = new LoopGuard(this.limits);
    const costGuard = new CostGuard(this.limits);
    // Context van eerdere steps (ook ná een resume) uit de run-metadata:
    const context: Record<string, unknown> = { ...run.metadata };
    const entityId = run.entityId;

    for (const step of automation.steps) {
      const execution = run.steps.find((s) => s.stepId === step.id);
      if (!execution) continue;
      if (execution.status === "completed" || execution.status === "skipped") continue;

      // ---- LOOP PROTECTION (eerste poging registreert; retries niet) ----
      loopGuard.beforeStep(step.id);

      // ---- CAPABILITY MATRIX (deterministische permissies) ----
      const permission = evaluateStepPermission(step.type, getAutonomyLevel());
      if (!permission.allowed) {
        const waiting = permission.outcome === "waiting_for_human";
        execution.status = waiting ? "blocked" : "blocked";
        execution.outcome = waiting ? "waiting_for_human" : "blocked";
        execution.error = permission.reason;
        execution.completedAt = new Date().toISOString();
        const updated = await runRepo.update(run.id, {
          steps: run.steps,
          status: waiting ? "paused" : "blocked",
          currentStep: step.id,
          waitingReason: permission.reason,
        });
        await emitEvent({
          type: waiting ? "automation_waiting_for_human" : "automation_step_blocked",
          entityType: run.entityType,
          entityId,
          payload: { automationId: automation.id, runId: run.id, step: step.id, reason: permission.reason },
          source: "orchestrator",
        });
        await this.logActivity(automation, permission.reason, "blocked", entityId);
        return updated ?? run;
      }

      // ---- HUMAN GATE: wait_for_human stopt ALWAYS (voert niets uit) ----
      if (step.type === "wait_for_human") {
        const reason =
          step.gate === "website_approval"
            ? "Website wacht op menselijke goedkeuring (QC is voltooid: READY FOR SILVIJN). Goedkeuren kan alléén via de approve-actie in het QC-rapport; automation voert dit NOOIT uit."
            : "Automation wacht op een menselijke beslissing. Hervatten is een expliciete menselijke actie.";
        execution.status = "blocked";
        execution.outcome = "waiting_for_human";
        execution.error = reason;
        execution.completedAt = new Date().toISOString();
        const updated = await runRepo.update(run.id, {
          steps: run.steps,
          status: "paused",
          currentStep: step.id,
          waitingReason: reason,
        });
        await emitEvent({
          type: "automation_waiting_for_human",
          entityType: run.entityType,
          entityId,
          payload: { automationId: automation.id, runId: run.id, step: step.id, gate: step.gate ?? "manual", reason },
          source: "orchestrator",
        });
        await this.logActivity(automation, `Automation gepauzeerd — human gate: ${step.name}`, "completed", entityId);
        return updated ?? run;
      }

      // ---- COST GUARD vóór elke step ----
      costGuard.assertCanContinue();

      // ---- EXECUTE met timeout + retries ----
      execution.status = "running";
      execution.startedAt = new Date().toISOString();
      await runRepo.update(run.id, { steps: run.steps, currentStep: step.id, status: "running" });
      await emitEvent({
        type: "automation_step_started",
        entityType: run.entityType,
        entityId,
        payload: { automationId: automation.id, runId: run.id, step: step.id, stepType: step.type },
        source: "orchestrator",
      });

      let result: StepExecutionResult;
      try {
        result = await this.executeWithRetries(step, { entityId, context }, execution);
      } catch (error) {
        if (error instanceof StepFailedError) {
          const updated = await runRepo.update(run.id, {
            steps: run.steps,
            status: "failed",
            currentStep: step.id,
            error: error.message,
            aiCalls: costGuard.totals.aiCalls,
            estimatedCostUsd: costGuard.totals.estimatedCostUsd,
            completedAt: new Date().toISOString(),
          });
          const updatedAutomation = await getAutomationRepository().getById(automation.id);
          if (updatedAutomation) {
            await getAutomationRepository().update(automation.id, { failureCount: updatedAutomation.failureCount + 1 });
          }
          await emitEvent({
            type: "automation_step_failed",
            entityType: run.entityType,
            entityId,
            payload: { automationId: automation.id, runId: run.id, step: step.id, reason: error.message, retries: error.retries },
            source: "orchestrator",
          });
          await emitEvent({
            type: "automation_failed",
            entityType: run.entityType,
            entityId,
            payload: { automationId: automation.id, runId: run.id, reason: error.message },
            source: "orchestrator",
          });
          await this.logActivity(automation, error.message, "failed", entityId);
          return updated ?? run;
        }
        throw error;
      }
      costGuard.register(result.aiCalls ?? 0, result.estimatedCostUsd ?? 0);

      // ---- RESULTAAT ----
      if (result.outcome === "success") {
        execution.status = "completed";
        execution.outcome = "success";
        execution.result = result.result;
        execution.completedAt = new Date().toISOString();
        execution.aiCalls = result.aiCalls ?? 0;
        execution.estimatedCostUsd = result.estimatedCostUsd ?? 0;
        Object.assign(context, result.context ?? {});
        await runRepo.update(run.id, {
          steps: run.steps,
          metadata: { ...run.metadata, ...result.context },
          aiCalls: costGuard.totals.aiCalls,
          estimatedCostUsd: costGuard.totals.estimatedCostUsd,
        });
        Object.assign(run.metadata, result.context);
        for (const event of result.events ?? []) {
          await emitEvent({
            type: event.type,
            entityType: run.entityType,
            entityId,
            payload: event.payload ?? { runId: run.id },
            source: "automation",
          });
        }
        await emitEvent({
          type: "automation_step_completed",
          entityType: run.entityType,
          entityId,
          payload: { automationId: automation.id, runId: run.id, step: step.id, result: result.result },
          source: "orchestrator",
        });
      } else if (result.outcome === "waiting_for_human") {
        execution.status = "blocked";
        execution.outcome = "waiting_for_human";
        execution.error = result.result;
        execution.completedAt = new Date().toISOString();
        const updated = await runRepo.update(run.id, {
          steps: run.steps,
          status: "paused",
          currentStep: step.id,
          waitingReason: result.result,
        });
        await emitEvent({
          type: "automation_waiting_for_human",
          entityType: run.entityType,
          entityId,
          payload: { automationId: automation.id, runId: run.id, step: step.id, reason: result.result },
          source: "orchestrator",
        });
        await this.logActivity(automation, `Automation gepauzeerd: ${result.result}`, "completed", entityId);
        return updated ?? run;
      } else {
        // blocked
        execution.status = "blocked";
        execution.outcome = "blocked";
        execution.error = result.result;
        execution.completedAt = new Date().toISOString();
        const updated = await runRepo.update(run.id, {
          steps: run.steps,
          status: "blocked",
          currentStep: step.id,
          waitingReason: result.result,
        });
        await emitEvent({
          type: "automation_step_blocked",
          entityType: run.entityType,
          entityId,
          payload: { automationId: automation.id, runId: run.id, step: step.id, reason: result.result },
          source: "orchestrator",
        });
        await this.logActivity(automation, result.result, "failed", entityId);
        return updated ?? run;
      }
    }

    // ---- ALLE STEPS VOLTOOID ----
    const completed = await runRepo.update(run.id, {
      status: "completed",
      currentStep: null,
      completedAt: new Date().toISOString(),
      aiCalls: costGuard.totals.aiCalls,
      estimatedCostUsd: costGuard.totals.estimatedCostUsd,
    });
    const updatedAutomation = await getAutomationRepository().getById(automation.id);
    if (updatedAutomation) {
      await getAutomationRepository().update(automation.id, {
        successCount: updatedAutomation.successCount + 1,
        currentStep: null,
      });
    }
    await emitEvent({
      type: "automation_completed",
      entityType: run.entityType,
      entityId,
      payload: {
        automationId: automation.id,
        runId: run.id,
        aiCalls: costGuard.totals.aiCalls,
        estimatedCostUsd: costGuard.totals.estimatedCostUsd,
      },
      source: "orchestrator",
    });
    await this.logActivity(automation, `Automation voltooid: ${automation.name}`, "completed", entityId);
    return completed ?? run;
  }

  /** Eén step met timeout + gecontroleerde retries (alléén tijdelijke fouten). */
  private async executeWithRetries(
    step: AutomationStepDefinition,
    context: StepContext,
    execution: AutomationRun["steps"][number]
  ): Promise<StepExecutionResult> {
    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        const promise = this.dispatchStep(step.type, context);
        const timeoutMs = step.timeoutMs;
        const result = await Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Step "${step.name}" overschreed de timeout (${timeoutMs}ms)`)), timeoutMs);
          }),
        ]);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // Human gates / blocks: NOOIT automatisch retryen.
        if (error instanceof StepExecutionBlockedError) {
          return { outcome: error.outcome, result: message };
        }
        if (error instanceof AutomationGuardError) {
          return { outcome: "blocked", result: message };
        }

        // Alleen tijdelijke fouten → retry met backoff; anders FAILED.
        const retriesAllowed = attempt <= step.maxRetries && isTransientError(error);
        if (!retriesAllowed) {
          execution.status = "failed";
          execution.outcome = "failed";
          execution.error = message;
          execution.retryCount = attempt - 1;
          execution.completedAt = new Date().toISOString();
          throw new StepFailedError(step, message, attempt - 1);
        }
        execution.retryCount = attempt;
        await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 500 * 2 ** (attempt - 1))));
      }
    }
  }

  /** Routeert naar de bestaande executor (dunne dispatch, geen logic). */
  private async dispatchStep(stepType: AutomationStepDefinition["type"], context: StepContext): Promise<StepExecutionResult> {
    switch (stepType) {
      case "discover_leads":
        return executeDiscoverLeads(context);
      case "analyze_lead":
        return executeAnalyzeLead(context);
      case "score_lead":
        return executeScoreLead(context);
      case "create_project":
        return executeCreateProject(context);
      case "check_requirements":
        return executeCheckRequirements(context);
      case "create_price_indication":
        return executeCreatePriceIndication(context);
      case "check_price":
        return executeCheckPrice(context);
      case "generate_website":
        return executeGenerateWebsite(context);
      case "run_qc":
        return executeRunQc(context);
      case "generate_outreach":
        return executeGenerateOutreach(context);
      case "process_reply":
        return executeProcessReply(context);
      // send_outreach/approve_website/deliver_website worden vóór dispatch
      // door de capability matrix geblokkeerd — ze kunnen hier nooit aankomen.
      default:
        throw new StepExecutionBlockedError(`Step-type "${stepType}" heeft geen executor — geblokkeerd.`, "blocked");
    }
  }

  /**
   * Hervatten van een gepauzeerde run — expliciete menselijke server action.
   * De human-gate-voorwaarde wordt deterministisch her-verifieerd: een
   * website_approval-gate hervat alléén als de website daadwerkelijk is
   * goedgekeurd door de mens (via de bestaande approve-actie).
   */
  async resumeRun(runId: string): Promise<AutomationRun> {
    const runRepo = getAutomationRunRepository();
    const run = await runRepo.getById(runId);
    if (!run) throw new AutomationGuardError(`Run "${runId}" bestaat niet.`);
    if (run.status !== "paused") {
      throw new AutomationGuardError(`Run "${runId}" is niet gepauzeerd (status ${run.status}) — hervatten niet mogelijk.`);
    }

    const automation = await getAutomationRepository().getById(run.automationId);
    if (!automation) throw new AutomationGuardError("Automation van deze run bestaat niet meer.");
    if (!automation.enabled || automation.status !== "active") {
      throw new AutomationGuardError(`Automation "${automation.name}" is niet actief — hervatten geblokkeerd.`);
    }

    // Human-gate her-checken (deterministisch, NIET via AI):
    const pendingStep = run.steps.find((s) => s.status === "blocked" && s.outcome === "waiting_for_human");
    if (pendingStep) {
      const definition = automation.steps.find((s) => s.id === pendingStep.stepId);
      const isHumanGateStep = definition?.type === "wait_for_human";
      if (definition?.gate === "website_approval") {
        const gateOk = await this.isWebsiteApproved(run, run.steps);
        if (!gateOk) {
          throw new AutomationGuardError(
            "Human gate niet vervuld: de website is nog niet goedgekeurd. Keur de website eerst goed via het QC-rapport (menselijke actie) — automation kan dit niet voor je doen."
          );
        }
        pendingStep.status = "completed";
        pendingStep.outcome = "success";
        pendingStep.error = null;
        pendingStep.result = "Human gate vervuld: website is door Silvijn goedgekeurd (menselijke actie).";
        pendingStep.completedAt = new Date().toISOString();
      } else if (isHumanGateStep) {
        // wait_for_human met manual gate: expliciete menselijke hervatting = beslissing
        pendingStep.status = "completed";
        pendingStep.outcome = "success";
        pendingStep.result = "Human gate vervuld door expliciete menselijke hervatting (manual gate).";
        pendingStep.completedAt = new Date().toISOString();
      } else {
        // Andere gestopte steps (bijv. check_requirements) worden HER-UITGEVOERD
        // na de menselijke tussenstap — niet blind als voltooid gemarkeerd:
        pendingStep.status = "pending";
        pendingStep.outcome = null;
        pendingStep.error = null;
        pendingStep.startedAt = null;
        pendingStep.completedAt = null;
        pendingStep.result = null;
      }
    }

    await runRepo.update(run.id, {
      steps: run.steps,
      status: "running",
      waitingReason: null,
    });
    return this.executeSteps(run, automation);
  }

  /** Deterministische gate-check: is de website van deze run al goedgekeurd? */
  private async isWebsiteApproved(run: AutomationRun, steps: AutomationRun["steps"]): Promise<boolean> {
    const generateStep = steps.find((s) => s.stepType === "generate_website" && s.status === "completed");
    if (!generateStep) return false;
    const websiteId = run.metadata.websiteId;
    if (typeof websiteId !== "string" || !websiteId) return false;
    const website = await getGeneratedWebsiteRepository().getById(websiteId);
    return website?.status === "approved";
  }

  private async logActivity(
    automation: Automation,
    message: string,
    status: "started" | "completed" | "failed" | "blocked",
    entityId: string | null
  ): Promise<void> {
    await getAIActivityRepository().log({
      leadId: entityId && entityId.startsWith("ld-") ? entityId : null,
      type: "automation",
      status,
      message: `[AUTOMATION ${automation.name}] ${message}`,
      metadata: { automationId: automation.id },
    });
  }
}

/** Step-fout die na retries definitief is — zet de run op FAILED. */
export class StepFailedError extends Error {
  constructor(
    step: AutomationStepDefinition,
    message: string,
    public readonly retries: number
  ) {
    super(`Step "${step.name}" faalde definitief na ${retries} retry(s): ${message}`);
    this.name = "StepFailedError";
  }
}

export { stepPolicy };
