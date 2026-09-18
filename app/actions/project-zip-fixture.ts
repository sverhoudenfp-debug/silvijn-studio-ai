"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioOwner, humanRpc } from "@/lib/auth/server";
import { transitionLead } from "@/lib/leads/service";
import { ProjectService } from "@/lib/projects/service";
import { evaluateRequirementsCompleteness } from "@/lib/projects/completeness";
import { getQuestionnaireRepository } from "@/lib/questionnaire/repository";
import {
  ZIP_FLOW_FIXTURE_REQUIREMENTS,
  ProjectZipFlowFixtureService,
  removeFixtureZipArtifactsFromStorage,
  type ZipFlowFixtureSummary,
} from "@/lib/testing/project-zip-fixture";

/**
 * Zip-flow fixture server actions — de ENIGE UI-entree naar de fixture.
 * Owner-only (requireStudioOwner), en de fixture gebruikt uitsluitend
 * bestaande, geauditeerde paden: transition_lead (wettige new→qualified,
 * geen reactie vereist), ProjectService, set_project_requirements_complete
 * en de opruim-RPC remove_zip_flow_test_fixture (migratie 0022, die de
 * dubbele markering herverifieert). Geen enkele productie-gate verandert.
 */

export async function listZipFlowFixturesAction(): Promise<ZipFlowFixtureSummary[]> {
  await requireStudioOwner();
  return new ProjectZipFlowFixtureService().listFixtures();
}

export type CreateZipFlowFixtureResult =
  | { success: true; leadId: string; projectId: string }
  | { error: string };

export async function createZipFlowFixtureAction(): Promise<CreateZipFlowFixtureResult> {
  await requireStudioOwner();
  try {
    const service = new ProjectZipFlowFixtureService();
    const lead = await service.createFixtureLead();

    // Wettige, geauditeerde owner-transition: new→qualified vraagt GEEN
    // prospect-reactie (de CONFIRMED_PROSPECT_REPLY_REQUIRED-guard geldt
    // alleen statussen met reactie-bewijs). De guard wordt niet gerond.
    await transitionLead({
      leadId: lead.id,
      expected: "new",
      next: "qualified",
      reason: "Testfixture (fictief): intern Project→ZIP-flow startpunt, geen echte klant.",
    });

    // Project + fixture-requirements via de bestaande ProjectService.
    const projectService = new ProjectService();
    const project = await projectService.createFromLead(lead.id);
    await projectService.updateRequirements(project.id, ZIP_FLOW_FIXTURE_REQUIREMENTS);

    // requirements_complete via de bestaande owner-RPC: herverifieert de
    // zes blokkerende checks in SQL en schrijft een audit-event.
    const updated = await projectService.get(project.id);
    const questionnaires = await getQuestionnaireRepository().findByLeadId(lead.id);
    const evaluation = evaluateRequirementsCompleteness(updated.requirements, questionnaires.map((q) => ({
      status: q.status,
      completionStatus: q.completionStatus,
    })));
    if (!evaluation.complete) {
      throw new Error(
        `Fixture-requirements onverwacht incompleet: ${evaluation.blockingMissing.join(", ")}`
      );
    }
    await humanRpc("set_project_requirements_complete", { p_project: project.id });

    // Garantie-check: de fixture heeft nooit inbound (reactie-)data.
    await service.assertNoProspectReply(lead.id);

    for (const route of ["/projects", "/leads", "/dashboard"]) revalidatePath(route);
    return { success: true as const, leadId: lead.id, projectId: project.id };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Fixture aanmaken mislukt" };
  }
}

export type RemoveZipFlowFixtureResult = { success: true; storageObjectsRemoved: number } | { error: string };

export async function removeZipFlowFixtureAction(leadId: string): Promise<RemoveZipFlowFixtureResult> {
  await requireStudioOwner();
  try {
    const id = z.uuid().parse(leadId);
    const service = new ProjectZipFlowFixtureService();
    const fixtures = await service.listFixtures();
    if (!fixtures.some((f) => f.leadId === id)) {
      throw new Error("Deze lead is geen gemarkeerde testfixture — verwijderen is geweigerd.");
    }

    // Privé ZIP-objecten uit storage opruimen vóór de rijen verdwijnen.
    const storageObjectsRemoved = await removeFixtureZipArtifactsFromStorage(id);

    // Transactuele opruiming in SQL: owner-only, dubbel gemarkeerd.
    await humanRpc("remove_zip_flow_test_fixture", { p_lead: id });

    for (const route of ["/projects", "/leads", "/dashboard"]) revalidatePath(route);
    return { success: true as const, storageObjectsRemoved };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Fixture verwijderen mislukt" };
  }
}
