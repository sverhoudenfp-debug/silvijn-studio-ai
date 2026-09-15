import type { DemoWebsite } from "@/lib/types";

export function DemoServices({ demo, accent }: { demo: DemoWebsite; accent: string }) {
  return (
    <section id="diensten" className="mx-auto max-w-5xl scroll-mt-20 px-6 py-16">
      <h2 className="text-center text-2xl font-bold tracking-tight">Onze diensten</h2>
      <p className="mx-auto mt-2 max-w-lg text-center text-sm text-zinc-500">
        Professioneel uitgevoerd in {demo.city} en omgeving.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {demo.services.map((service) => (
          <div key={service} className="rounded-xl border border-zinc-200 p-5 transition-colors hover:border-zinc-400">
            <span className={`block h-8 w-8 rounded-lg ${accent}`} />
            <p className="mt-3 text-sm font-semibold">{service}</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Vakkundig werk met garantie en heldere afspraken.
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
