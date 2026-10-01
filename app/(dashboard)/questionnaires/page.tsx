import { requireStudioOwner } from "@/lib/auth/server";
import { getQuestionnaireRepository } from "@/lib/questionnaire/repository";
import { listQuestionnaires } from "@/lib/questionnaire/service";
import { cachedListLeads } from "@/lib/dashboard/cached-reads";
import { QuestionnairesView } from "@/components/questionnaires/questionnaires-view";
import { isTestLead, isTestLeadLinked, resolveShowTestData, testLeadIdSet } from "@/lib/leads/test-data";

/**
 * Questionnaires-overzicht — end-to-end beheer vanuit het dashboard:
 * status, completion, gekoppelde lead, publieke URL en voortgang.
 */
export default async function QuestionnairesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStudioOwner();
  const showTestData = resolveShowTestData(await searchParams);
  const [allQuestionnaires, allLeads, responseCounts] = await Promise.all([
    listQuestionnaires(),
    cachedListLeads(),
    // N+1-fix: alle reactietellingen in één batch-query i.p.v. per vragenlijst.
    getQuestionnaireRepository().countResponsesByQuestionnaire(),
  ]);
  // Testdata-scheiding (2026-10-01): fixture-vragenlijsten zijn verborgen in
  // het normale overzicht; ?test=1 toont expliciet (regressietests/opruimen).
  const testIds = testLeadIdSet(allLeads);
  const questionnaires = showTestData ? allQuestionnaires : allQuestionnaires.filter((q) => !isTestLeadLinked(testIds, q.leadId));
  const leads = showTestData ? allLeads : allLeads.filter((l) => !isTestLead(l));

  const leadNames: Record<string, string> = {};
  for (const lead of leads) leadNames[lead.id] = lead.businessName;

  return <QuestionnairesView questionnaires={questionnaires} leadNames={leadNames} responseCounts={responseCounts} />;
}
