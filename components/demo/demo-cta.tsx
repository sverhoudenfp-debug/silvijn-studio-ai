import type { DemoWebsite, Lead } from "@/lib/types";

export function DemoCta({
  demo,
  lead,
  accent,
}: {
  demo: DemoWebsite;
  lead: Lead;
  accent: string;
}) {
  return (
    <section className="bg-zinc-100">
      <div className="mx-auto max-w-5xl px-6 py-16 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900">{demo.ctaText}</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-500">
          Vrijblijvend en zonder verplichtingen — u ontvangt binnen een dag reactie.
        </p>
        {lead.email ? (
          <a
            href={`mailto:${lead.email}?subject=${encodeURIComponent(demo.ctaText)}`}
            className={`mt-6 inline-block rounded-lg ${accent} px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90`}
          >
            Neem contact op
          </a>
        ) : null}
      </div>
    </section>
  );
}
