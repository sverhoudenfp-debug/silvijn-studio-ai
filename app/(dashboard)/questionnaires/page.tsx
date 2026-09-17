import { requireStudioOwner } from "@/lib/auth/server";
import { getLeadRepository } from "@/lib/repositories/lead-repository";
import { getQuestionnaireRepository } from "@/lib/questionnaire/repository";
import { listQuestionnaires } from "@/lib/questionnaire/service";
import { QuestionnairesView } from "@/components/questionnaires/questionnaires-view";

/**
 * Questionnaires-overzicht — end-to-end beheer vanuit het dashboard:
 * status, completion, gekoppelde lead, publieke URL en voortgang.
 */
export default async function QuestionnairesPage() {
  await requireStudioOwner();
  const [questionnaires, leads] = await Promise.all([
    listQuestionnaires(),
    getLeadRepository().list(),
  ]);

  const leadNames: Record<string, string> = {};
  for (const lead of leads) leadNames[lead.id] = lead.businessName;

  const responseCounts: Record<string, number> = {};
  for (const questionnaire of questionnaires) {
    responseCounts[questionnaire.id] = (await getQuestionnaireRepository().listResponses(questionnaire.id)).length;
  }

  return <QuestionnairesView questionnaires={questionnaires} leadNames={leadNames} responseCounts={responseCounts} />;
}
