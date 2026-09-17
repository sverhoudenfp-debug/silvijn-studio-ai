"use client";

import { useActionState } from "react";
import { submitQuestionnaireResponseAction, type QuestionnaireSubmitState } from "../actions";
import type { QuestionnaireQuestion } from "@/lib/questionnaire/validation";

const inputClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500";

export function QuestionnaireForm({ slug, questions }: { slug: string; questions: QuestionnaireQuestion[] }) {
  const [state, formAction, pending] = useActionState<QuestionnaireSubmitState, FormData>(
    submitQuestionnaireResponseAction,
    { error: null }
  );

  return (
    <form action={formAction} className="mt-6 space-y-6">
      <input type="hidden" name="slug" value={slug} />
      {questions.map((question) => (
        <fieldset key={question.id} className="space-y-1.5">
          <label htmlFor={`q_${question.id}`} className="block text-sm font-medium text-zinc-200">
            {question.label}
            {question.required && <span className="ml-1 text-amber-400">*</span>}
          </label>
          {question.type === "textarea" ? (
            <textarea
              id={`q_${question.id}`}
              name={`q_${question.id}`}
              rows={4}
              required={question.required}
              maxLength={5000}
              className={inputClass}
            />
          ) : question.type === "select" ? (
            <select id={`q_${question.id}`} name={`q_${question.id}`} required={question.required} className={inputClass} defaultValue="">
              <option value="" disabled>
                Maak een keuze
              </option>
              {question.options?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`q_${question.id}`}
              name={`q_${question.id}`}
              type={question.type === "email" ? "email" : question.type === "tel" ? "tel" : "text"}
              required={question.required}
              maxLength={question.type === "text" ? 500 : question.type === "email" ? 320 : 30}
              className={inputClass}
            />
          )}
        </fieldset>
      ))}
      {state.error && (
        <p role="alert" className="break-words text-sm text-amber-400">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-60"
      >
        {pending ? "Versturen..." : "Verstuur antwoorden"}
      </button>
      <p className="text-xs text-zinc-500">
        Je antwoorden worden veilig opgeslagen bij Silvijn Studio en uitsluitend gebruikt voor jouw website-traject.
      </p>
    </form>
  );
}
