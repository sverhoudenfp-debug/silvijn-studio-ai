import type { DemoWebsite, Lead } from "@/lib/types";

export function DemoAbout({ demo, lead }: { demo: DemoWebsite; lead: Lead }) {
  return (
    <section id="over-ons" className="scroll-mt-20 border-y border-zinc-200 bg-zinc-50">
      <div className="mx-auto max-w-5xl px-6 py-16 text-center">
        <h2 className="text-2xl font-bold tracking-tight">Over {demo.businessName}</h2>
        <div className="mx-auto mt-6 grid max-w-2xl grid-cols-3 gap-4">
          <div>
            <p className="text-2xl font-bold text-zinc-900">{lead.googleRating ? lead.googleRating.toFixed(1) : "—"}</p>
            <p className="mt-1 text-xs text-zinc-500">gemiddelde beoordeling</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-zinc-900">{lead.reviewCount ?? 0}</p>
            <p className="mt-1 text-xs text-zinc-500">tevreden klanten</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-zinc-900">{demo.city}</p>
            <p className="mt-1 text-xs text-zinc-500">actief in en omstreken</p>
          </div>
        </div>
        <p className="mx-auto mt-6 max-w-xl text-sm leading-relaxed text-zinc-600">
          Onze klanten waarderen ons om kwaliteit, betrouwbaarheid en service. Wij zijn trots op
          onze reputatie in {demo.city} en omstreken.
        </p>
      </div>
    </section>
  );
}
