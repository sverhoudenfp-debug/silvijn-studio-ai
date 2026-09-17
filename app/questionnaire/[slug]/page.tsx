import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicQuestionnaireBySlug } from "@/lib/questionnaire/service";
import { QuestionnaireForm } from "./questionnaire-form";

/**
 * Publieke questionnaire — questionnaire.silvijnstudio.com/{slug}.
 * GEEN login, GEEN dashboard-toegang: de pagina toont uitsluitend de
 * actieve questionnaire die bij deze slug hoort (titel, intro, vragen).
 * Lead-, project- of andere klantgegevens worden nooit getoond.
 * Onbekende, draft- of gesloten slugs → nette 404.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/questionnaire/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  try {
    const questionnaire = await getPublicQuestionnaireBySlug(slug);
    return { title: `${questionnaire.title} | Silvijn Studio` };
  } catch {
    return { title: "Vragenlijst niet gevonden | Silvijn Studio" };
  }
}

export default async function QuestionnairePage(props: PageProps<"/questionnaire/[slug]">) {
  const { slug } = await props.params;
  const { searchParams } = await props;
  const submitted = (await searchParams).submitted === "1";

  let questionnaire;
  try {
    questionnaire = await getPublicQuestionnaireBySlug(slug);
  } catch {
    notFound();
  }

  return (
    <main className="flex min-h-screen justify-center bg-zinc-950 px-4 py-16 text-zinc-100">
      <section className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 p-8">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Silvijn Studio</p>
        <h1 className="mt-2 text-2xl font-semibold">{questionnaire.title}</h1>
        {questionnaire.intro && <p className="mt-3 whitespace-pre-line text-sm text-zinc-400">{questionnaire.intro}</p>}

        {submitted ? (
          <div className="mt-8 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-5">
            <p className="text-sm font-medium text-emerald-300">Bedankt! Je antwoorden zijn ontvangen.</p>
            <p className="mt-1 text-sm text-zinc-400">
              Silvijn Studio neemt zo snel mogelijk contact met je op over de volgende stappen.
            </p>
          </div>
        ) : (
          <QuestionnaireForm slug={questionnaire.slug} questions={questionnaire.questions} />
        )}
      </section>
    </main>
  );
}
