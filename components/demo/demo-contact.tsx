import type { DemoWebsite, Lead } from "@/lib/types";

export function DemoContact({ demo, lead }: { demo: DemoWebsite; lead: Lead }) {
  return (
    <section id="contact" className="mx-auto max-w-5xl scroll-mt-20 px-6 py-16">
      <h2 className="text-center text-2xl font-bold tracking-tight">Neem contact op</h2>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 text-sm text-zinc-600">
          <p>Bel of mail ons — wij reageren meestal binnen een dag.</p>
          {lead.phone ? (
            <p>
              Telefoon:{" "}
              <a href={`tel:${lead.phone.replace(/\s/g, "")}`} className="font-medium text-zinc-900 underline underline-offset-2">
                {lead.phone}
              </a>
            </p>
          ) : null}
          {lead.email ? (
            <p>
              E-mail:{" "}
              <a href={`mailto:${lead.email}`} className="font-medium text-zinc-900 underline underline-offset-2">
                {lead.email}
              </a>
            </p>
          ) : null}
          <p>
            {lead.address ? `${lead.address}, ` : ""}
            {demo.city}
          </p>
        </div>
        <div className="rounded-xl bg-zinc-50 p-6">
          <p className="text-sm font-semibold text-zinc-900">Waarom {demo.businessName}?</p>
          <ul className="mt-3 space-y-2 text-sm text-zinc-600">
            <li>✓ {lead.googleRating ?? "Hoge"} klantbeoordeling</li>
            <li>✓ {lead.reviewCount ?? "Veel"} tevreden klanten</li>
            <li>✓ Actief in {demo.city} en omgeving</li>
            <li>✓ Heldere prijzen en snelle reactie</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
