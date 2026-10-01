import { requireStudioOwner } from "@/lib/auth/server";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getQuestionnaireRepository } from "@/lib/questionnaire/repository";
import { listQuestionnaires } from "@/lib/questionnaire/service";
import { QuestionnairesView } from "@/components/questionnaires/questionnaires-view";
import { isTestLead, isTestLeadLinked, resolveShowTestData, testLeadIdSet } from "@/lib/leads/test-data";

/**
 * Questionnaires-overzicht — end-to-end beheer vanuit het dashboard:
 * status, completion, gekoppelde lead, publieke URL en voortgang.
 */
export default async function QuestionnairesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStudioOwner();
  const showTestData = resolveShowTestData(await searchParams);
  const [allQuestionnaires, allLeads] = await Promise.all([
    listQuestionnaires(),
    getLeadRepository().list(),
  ]);
  // Testdata-scheiding (2026-10-01): fixture-vragenlijsten zijn verborgen in
  // het normale overzicht; ?test=1 toont expliciet (regressietests/opruimen).
  const testIds = testLeadIdSet(allLeads);
  const questionnaires = showTestData ? allQuestionnaires : allQuestionnaires.filter((q) => !isTestLeadLinked(testIds, q.leadId));
  const leads = showTestData ? allLeads : allLeads.filter((l) => !isTestLead(l));

  const leadNames: Record<string, string> = {};
  for (const lead of leads) leadNames[lead.id] = lead.businessName;

  const responseCounts: Record<string, number> = {};
  for (const questionnaire of questionnaires) {
    responseCounts[questionnaire.id] = (await getQuestionnaireRepository().listResponses(questionnaire.id)).length;
  }

  return <QuestionnairesView questionnaires={questionnaires} leadNames={leadNames} responseCounts={responseCounts} />;
}
