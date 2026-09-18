"use client";

import Link from "next/link";
import { useState } from "react";
import { createQuestionnaireAction } from "@/app/actions/questionnaires";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import type { Questionnaire } from "@/lib/questionnaire/repository";

/**
 * Questionnaire-sectie op de lead-detailpagina. De eigenaar start hier een
 * AI-gegenereerde questionnaire voor deze lead (eventueel gekoppeld aan het
 * project); de vragen worden pas publiek na expliciete publicatie.
 */

const statusMeta: Record<string, { label: string; variant: "neutral" | "info" | "warning" }> = {
  draft: { label: "Draft", variant: "neutral" },
  active: { label: "Actief", variant: "info" },
  closed: { label: "Gesloten", variant: "warning" },
};

const completionMeta: Record<string, { label: string; variant: "neutral" | "success" | "info" | "danger" }> = {
  QUESTIONNAIRE_FOLLOW_UP: { label: "Follow-up gesteld", variant: "info" },
  QUESTIONNAIRE_COMPLETE: { label: "Complete", variant: "success" },
  QUESTIONNAIRE_ATTENTION: { label: "Aandachtspunt", variant: "danger" },
};

export function QuestionnaireSection({
  leadId,
  leadBusinessName,
  projectId,
  questionnaires,
}: {
  leadId: string;
  leadBusinessName: string;
  projectId: string | null;
  questionnaires: Questionnaire[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function create() {
    setError(null);
    setPending(true);
    try {
      await createQuestionnaireAction(leadId, projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Questionnaire aanmaken mislukt");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Questionnaire"
        subtitle={questionnaires.length > 0 ? "Bestaande vragenlijsten voor deze lead" : `Dynamische vragenlijst voor ${leadBusinessName}`}
        action={
          <button type="button" disabled={pending} onClick={create} className={buttonClasses("secondary", "text-xs")}>
            {pending ? "AI genereert..." : "Nieuwe questionnaire (AI)"}
          </button>
        }
      />
      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
      {questionnaires.length === 0 ? (
        <p className="text-sm text-zinc-400">
          Nog geen questionnaire. De AI stelt de vragen samen uit alle bekende lead- en projectinformatie, zodat de
          klant niets onnodig opnieuw invult.
        </p>
      ) : (
        <div className="space-y-2">
          {questionnaires.map((questionnaire) => {
            const status = statusMeta[questionnaire.status] ?? statusMeta.draft;
            const completion = questionnaire.completionStatus ? completionMeta[questionnaire.completionStatus] : null;
            return (
              <div key={questionnaire.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/questionnaires/${questionnaire.id}`} className="text-sm font-medium text-zinc-100 hover:text-indigo-300">
                    {questionnaire.title}
                  </Link>
                  <Badge variant={status.variant}>{status.label}</Badge>
                  {completion && <Badge variant={completion.variant}>{completion.label}</Badge>}
                </div>
                {questionnaire.status !== "draft" && (
                  <span className="truncate text-xs text-zinc-500">questionnaire.silvijnstudio.com/{questionnaire.slug}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
