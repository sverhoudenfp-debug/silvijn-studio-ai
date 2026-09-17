import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CopyableUrl } from "./copyable-url";
import type { Questionnaire } from "@/lib/questionnaire/repository";

/**
 * Questionnaires-overzicht (dashboard). Toont per questionnaire: status,
 * completion, gekoppelde lead, publieke URL en voortgang. Alle mutaties
 * verlopen via de detailpagina.
 */

const statusMeta: Record<string, { label: string; variant: "neutral" | "info" | "warning" | "success" | "danger" }> = {
  draft: { label: "Draft", variant: "neutral" },
  active: { label: "Actief", variant: "info" },
  closed: { label: "Gesloten", variant: "warning" },
};

const completionMeta: Record<string, { label: string; variant: "neutral" | "info" | "success" | "danger" }> = {
  null: { label: "Nog geen antwoorden", variant: "neutral" },
  QUESTIONNAIRE_FOLLOW_UP: { label: "Follow-up gesteld", variant: "info" },
  QUESTIONNAIRE_COMPLETE: { label: "QUESTIONNAIRE_COMPLETE", variant: "success" },
  QUESTIONNAIRE_ATTENTION: { label: "Aandachtspunt Silvijn", variant: "danger" },
};

export function QuestionnairesView({
  questionnaires,
  leadNames,
  responseCounts,
}: {
  questionnaires: Questionnaire[];
  leadNames: Record<string, string>;
  responseCounts: Record<string, number>;
}) {
  if (questionnaires.length === 0) {
    return (
      <EmptyState
        title="Nog geen questionnaires"
        description="Open een lead en start daar een questionnaire; de AI stelt de vragen samen uit alles wat al bekend is."
      />
    );
  }

  return (
    <Card className="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-5 py-3 font-medium">Vragenlijst</th>
              <th className="px-5 py-3 font-medium">Lead</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Completion</th>
              <th className="px-5 py-3 font-medium">Antwoorden</th>
              <th className="px-5 py-3 font-medium">Publieke URL</th>
            </tr>
          </thead>
          <tbody>
            {questionnaires.map((questionnaire) => {
              const status = statusMeta[questionnaire.status] ?? statusMeta.draft;
              const completion = completionMeta[questionnaire.completionStatus ?? "null"] ?? completionMeta.null;
              return (
                <tr key={questionnaire.id} className="border-b border-zinc-800/60 last:border-0">
                  <td className="px-5 py-3">
                    <Link href={`/questionnaires/${questionnaire.id}`} className="font-medium text-zinc-100 hover:text-indigo-300">
                      {questionnaire.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {questionnaire.questions.length} vragen · {questionnaire.projectId ? "project gekoppeld" : "los van project"}
                    </p>
                  </td>
                  <td className="px-5 py-3">
                    <Link href={`/leads/${questionnaire.leadId}`} className="text-zinc-300 hover:text-indigo-300">
                      {leadNames[questionnaire.leadId] ?? "Onbekende lead"}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant={completion.variant}>{completion.label}</Badge>
                  </td>
                  <td className="px-5 py-3 text-zinc-300">{responseCounts[questionnaire.id] ?? 0}</td>
                  <td className="px-5 py-3">
                    {questionnaire.status === "draft" ? (
                      <span className="text-xs text-zinc-500">Nog niet gepubliceerd</span>
                    ) : (
                      <CopyableUrl url={`https://questionnaire.silvijnstudio.com/${questionnaire.slug}`} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
