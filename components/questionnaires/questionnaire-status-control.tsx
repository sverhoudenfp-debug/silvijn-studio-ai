"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  closeQuestionnaireAction,
  publishQuestionnaireAction,
  reopenQuestionnaireAction,
} from "@/app/actions/questionnaires";
import { buttonClasses } from "@/components/ui/button";

/**
 * Statusbediening op de questionnaire-detailpagina (uitsluitend owner-acties:
 * publiceren, sluiten, heropenen). De AI voert geen van deze handelingen uit.
 */
export function QuestionnaireStatusControl({
  questionnaireId,
  status,
}: {
  questionnaireId: string;
  status: "draft" | "active" | "closed";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setPending(true);
    try {
      await action();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Actie mislukt");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => publishQuestionnaireAction(questionnaireId))}
          className={buttonClasses("primary", "text-xs")}
        >
          Publiceren
        </button>
      )}
      {status === "active" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => closeQuestionnaireAction(questionnaireId))}
          className={buttonClasses("secondary", "text-xs")}
        >
          Sluiten
        </button>
      )}
      {status === "closed" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => reopenQuestionnaireAction(questionnaireId))}
          className={buttonClasses("secondary", "text-xs")}
        >
          Opnieuw openen
        </button>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
