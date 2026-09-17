import Link from "next/link";
import { requireStudioOwner } from "@/lib/auth/server";
import { notFound } from "next/navigation";
import { getQuestionnaireDashboardData } from "@/lib/questionnaire/service";
import { createUploadSignedUrl } from "@/lib/questionnaire/uploads";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { CopyableUrl } from "@/components/questionnaires/copyable-url";
import { QuestionnaireStatusControl } from "@/components/questionnaires/questionnaire-status-control";
import type { QuestionnaireResponse } from "@/lib/questionnaire/repository";

/**
 * Questionnaire-detail — status, koppelingen, publieke URL, AI-context,
 * antwoorden inclusief privé-uploads (tijdelijke signed URLs), completion-
 * beoordeling, ontbrekende informatie en follow-upvragen.
 */

export async function generateMetadata(props: PageProps<"/questionnaires/[id]">) {
  await requireStudioOwner();
  const { id } = await props.params;
  const data = await getQuestionnaireDashboardData(id).catch(() => null);
  return { title: data ? `${data.questionnaire.title} | Silvijn Studio` : "Questionnaire | Silvijn Studio" };
}

const statusMeta: Record<string, { label: string; variant: "neutral" | "info" | "warning" }> = {
  draft: { label: "Draft — nog niet publiek", variant: "neutral" },
  active: { label: "Actief", variant: "info" },
  closed: { label: "Gesloten", variant: "warning" },
};

const completionMeta: Record<string, { label: string; variant: "neutral" | "info" | "success" | "danger" }> = {
  QUESTIONNAIRE_FOLLOW_UP: { label: "Follow-up gesteld aan klant", variant: "info" },
  QUESTIONNAIRE_COMPLETE: { label: "QUESTIONNAIRE_COMPLETE", variant: "success" },
  QUESTIONNAIRE_ATTENTION: { label: "Aandachtspunt voor Silvijn", variant: "danger" },
};

async function uploadLink(response: QuestionnaireResponse, path: string, filename: string) {
  const url = await createUploadSignedUrl(path, 300);
  return (
    <a key={path} href={url} className="text-xs text-indigo-300 hover:text-indigo-200" target="_blank" rel="noreferrer">
      {filename}
    </a>
  );
}

export default async function QuestionnaireDetailPage(props: PageProps<"/questionnaires/[id]">) {
  await requireStudioOwner();
  const { id } = await props.params;
  const data = await getQuestionnaireDashboardData(id).catch(() => null);
  if (!data) notFound();

  const { questionnaire, responses, lead, project } = data;
  const status = statusMeta[questionnaire.status];
  const completion = questionnaire.completionStatus ? completionMeta[questionnaire.completionStatus] : null;
  const analysis = questionnaire.completionAnalysis ?? {};

  const roundOne = responses.filter((r) => r.round === 1);
  const roundTwo = responses.filter((r) => r.round === 2);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-zinc-100">{questionnaire.title}</h1>
            <Badge variant={status.variant}>{status.label}</Badge>
            {completion && <Badge variant={completion.variant}>{completion.label}</Badge>}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Gekoppeld aan lead{" "}
            <Link href={`/leads/${lead.id}`} className="text-indigo-300 hover:text-indigo-200">
              {lead.businessName}
            </Link>
            {project && (
              <>
                {" "}
                · project{" "}
                <Link href={`/projects/${project.id}`} className="text-indigo-300 hover:text-indigo-200">
                  {project.name}
                </Link>
              </>
            )}
          </p>
        </div>
        <QuestionnaireStatusControl questionnaireId={questionnaire.id} status={questionnaire.status} />
      </div>

      <Card>
        <CardHeader title="Publieke URL" subtitle="Deelbaar met de klant — geen login nodig." />
        {questionnaire.status === "draft" ? (
          <p className="text-sm text-zinc-400">Publiceer de questionnaire om de link actief te maken.</p>
        ) : (
          <CopyableUrl url={`https://questionnaire.silvijnstudio.com/${questionnaire.slug}`} />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Vragen (ronde 1)" subtitle={`${questionnaire.questions.length} AI-gegenereerde vragen`} />
          <ol className="space-y-2 text-sm">
            {questionnaire.questions.map((question, index) => (
              <li key={question.id} className="flex gap-2">
                <span className="text-zinc-500">{index + 1}.</span>
                <div>
                  <p className="text-zinc-200">{question.label}</p>
                  <p className="text-xs text-zinc-500">
                    {question.type}
                    {question.required ? " · verplicht" : " · optioneel"}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card>
          <CardHeader
            title="Completion-beoordeling (AI)"
            subtitle="Automatische beoordeling na verzending door de klant."
          />
          {analysis.assessmentError ? (
            <p className="text-sm text-red-300">
              Beoordeling mislukt: {String(analysis.assessmentError)} — Silvijn beoordeelt de antwoorden handmatig.
            </p>
          ) : questionnaire.completionStatus ? (
            <div className="space-y-3 text-sm">
              <p className="text-zinc-300">{String(analysis.summary ?? "")}</p>
              {Array.isArray(analysis.resolvedInformation) && analysis.resolvedInformation.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Veig herleid uit context</p>
                  <ul className="mt-1 space-y-1 text-xs text-zinc-400">
                    {(analysis.resolvedInformation as { key: string; value: string }[]).map((item) => (
                      <li key={item.key}>
                        <span className="text-zinc-300">{item.key}:</span> {item.value}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {Array.isArray(analysis.missingInformation) && analysis.missingInformation.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Ontbrekende informatie</p>
                  <ul className="mt-1 list-inside list-disc text-xs text-amber-300">
                    {(analysis.missingInformation as string[]).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-zinc-400">Nog geen antwoorden ontvangen; de beoordeling start automatisch na de eerste verzending.</p>
          )}
          {questionnaire.followUpQuestions.length > 0 && (
            <div className="mt-4 border-t border-zinc-800 pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Follow-upvragen (ronde 2, max 3)</p>
              <ol className="mt-1 space-y-1 text-xs text-zinc-300">
                {questionnaire.followUpQuestions.map((question, index) => (
                  <li key={question.id}>
                    {index + 1}. {question.label}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Antwoorden"
          subtitle={
            responses.length === 0
              ? "De klant heeft nog niets ingevuld."
              : `${roundOne.length} verzending(en) ronde 1${roundTwo.length > 0 ? ` · ${roundTwo.length} ronde 2` : ""}`
          }
        />
        {responses.length === 0 ? (
          <p className="text-sm text-zinc-500">Voortgang: 0 van 1 ronden ontvangen.</p>
        ) : (
          <div className="space-y-4">
            {responses.map((response) => (
              <div key={response.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                <p className="text-xs font-medium text-zinc-400">
                  Ronde {response.round} · ontvangen {new Date(response.createdAt).toLocaleString("nl-NL")}
                </p>
                <dl className="mt-2 space-y-2 text-sm">
                  {(roundOne.includes(response) ? questionnaire.questions : questionnaire.followUpQuestions).map((question) => {
                    const value = response.answers[question.id];
                    return (
                      <div key={question.id} className="grid gap-0.5">
                        <dt className="text-xs text-zinc-500">{question.label}</dt>
                        <dd className="whitespace-pre-line text-zinc-200">{value ? value : <span className="text-zinc-600">(niet ingevuld)</span>}</dd>
                      </div>
                    );
                  })}
                </dl>
                {response.uploads.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {response.uploads.map((upload) => uploadLink(response, upload.path, `${upload.filename} (${Math.round(upload.size / 1024)} kB)`))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {questionnaire.completionStatus === "QUESTIONNAIRE_ATTENTION" && (
        <Card className="border-red-900/60">
          <CardHeader title="Aandachtspunt voor Silvijn" subtitle="Ook na de follow-upronde is onvoldoende informatie." />
          <p className="text-sm text-zinc-300">
            Beoordeel de antwoorden hierboven en neem contact op met de klant voor de ontbrekende informatie. Na
            QUESTIONNAIRE_COMPLETE loopt de bestaande workflow verder richting requirements → pricing → websitegeneratie.
          </p>
        </Card>
      )}
    </div>
  );
}
