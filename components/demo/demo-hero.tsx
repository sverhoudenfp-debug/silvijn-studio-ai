import type { DemoWebsite, Lead } from "@/lib/types";

export function DemoHero({
  demo,
  lead,
  hero,
}: {
  demo: DemoWebsite;
  lead: Lead;
  hero: string;
}) {
  return (
    <section className={`bg-gradient-to-br ${hero} text-white`}>
      <div className="mx-auto max-w-5xl px-6 py-20 text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-white/70">
          {demo.industry} · {demo.city}
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">{demo.headline}</h1>
        <p className="mx-auto mt-4 max-w-xl text-white/80">{demo.description}</p>
        {lead.googleRating ? (
          <p className="mt-4 text-sm text-white/80">
            ★ {lead.googleRating.toFixed(1)} · {lead.reviewCount} reviews
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {lead.email ? (
            <a
              href={`mailto:${lead.email}?subject=Offerte via de website`}
              className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 transition-opacity hover:opacity-90"
            >
              Vraag een offerte aan
            </a>
          ) : null}
          <a
            href="#diensten"
            className="rounded-lg border border-white/40 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            Bekijk onze diensten
          </a>
        </div>
      </div>
    </section>
  );
}
